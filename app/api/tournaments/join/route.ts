import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";

// A team buys into a tournament (open_matches, match_type='tournament').
// The full per-team buy-in is debited from the joining team's credit here. Where the
// money goes then depends on who hosts the tournament:
//   - Venue-hosted (organiser_team_id null): the client fires /api/connect/venue-transfer
//     to move the buy-in to the venue's Stripe account (hostType 'venue').
//   - Team-hosted (organiser_team_id set): the buy-in reimburses the ORGANISER team's
//     credit here, server-side, since they fronted the whole pitch fee (hostType 'team').
//
// After the debit we pre-create pending 'replenish' player_payments for the joining
// team's squad so each player later refills their team's credit off their saved card —
// the same settle model used for matches (PAYMENT_PLAN §10).
export async function POST(req: NextRequest) {
  try {
    const { openMatchId, teamId, teamName, userId } = await req.json();
    if (!openMatchId || !teamId || !userId) {
      return NextResponse.json({ error: "Missing openMatchId, teamId or userId" }, { status: 400 });
    }

    // 1) Load the tournament listing.
    const { data: om } = await adminSupabase
      .from("open_matches")
      .select("id, pitch_id, price_per_team_pence, max_teams, status, booking_id, title, organiser_team_id")
      .eq("id", openMatchId)
      .maybeSingle();
    if (!om) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    if (om.status === "cancelled") {
      return NextResponse.json({ error: "This tournament has been cancelled." }, { status: 409 });
    }

    // 2) Capacity + duplicate checks.
    const { data: joined } = await adminSupabase
      .from("open_match_teams")
      .select("team_id")
      .eq("open_match_id", openMatchId);
    const joinedTeams = joined ?? [];
    if (joinedTeams.some((t) => t.team_id === teamId)) {
      return NextResponse.json({ error: "Your team has already entered this tournament." }, { status: 409 });
    }
    if (joinedTeams.length >= om.max_teams) {
      return NextResponse.json({ error: "This tournament is full." }, { status: 409 });
    }

    // Apply a pending invitation's discount, if this team was invited. The
    // discount is authoritative here (client only displays it).
    const { data: invite } = await adminSupabase
      .from("tournament_invitations")
      .select("id, discount_pence, status")
      .eq("open_match_id", openMatchId)
      .eq("team_id", teamId)
      .maybeSingle();
    const discount = invite && invite.status === "pending" ? Math.round(invite.discount_pence ?? 0) : 0;
    const buyIn = Math.max(0, Math.round(om.price_per_team_pence ?? 0) - discount);

    // 3) Credit check + guarded debit (buy-in comes out of the team pot).
    if (buyIn > 0) {
      const { data: credit } = await adminSupabase
        .from("team_credits")
        .select("balance_pence, reserved_pence")
        .eq("team_id", teamId)
        .maybeSingle();
      if (!credit) {
        return NextResponse.json({ error: "No credit account for this team." }, { status: 409 });
      }
      const available = credit.balance_pence - (credit.reserved_pence ?? 0);
      if (available < buyIn) {
        return NextResponse.json({ error: "INSUFFICIENT_CREDIT", available, need: buyIn }, { status: 409 });
      }

      const { data: updated, error: upErr } = await adminSupabase
        .from("team_credits")
        .update({ balance_pence: credit.balance_pence - buyIn, updated_at: new Date().toISOString() })
        .eq("team_id", teamId)
        .eq("balance_pence", credit.balance_pence) // best-effort concurrency guard
        .select("balance_pence")
        .maybeSingle();
      if (upErr || !updated) {
        return NextResponse.json({ error: "Credit changed, please retry." }, { status: 409 });
      }

      await adminSupabase.from("team_credit_transactions").insert({
        team_id: teamId,
        type: "booking_capture",
        amount_pence: -buyIn,
        open_match_id: openMatchId,
      });
    }

    // 4) Record the entry.
    const { error: joinErr } = await adminSupabase.from("open_match_teams").insert({
      open_match_id: openMatchId,
      team_id: teamId,
      team_name: teamName ?? "",
      joined_by: userId,
      payment_status: "paid",
    });
    if (joinErr) {
      // Refund the debit we just took so the team isn't charged for a failed join.
      if (buyIn > 0) {
        await adminSupabase.rpc("add_credit", { p_team_id: teamId, p_amount_pence: buyIn, p_player_id: userId });
      }
      return NextResponse.json({ error: `Couldn't enter the tournament: ${joinErr.message}` }, { status: 500 });
    }

    // 5) Team-hosted: reimburse the organiser team's credit with this buy-in
    //    (they fronted the whole pitch fee). Venue-hosted tournaments skip this —
    //    the client sends the buy-in to the venue via /api/connect/venue-transfer.
    const isTeamHosted = Boolean(om.organiser_team_id) && om.organiser_team_id !== teamId;
    if (buyIn > 0 && isTeamHosted) {
      const { error: reimburseErr } = await adminSupabase.rpc("reimburse_team", {
        p_team_id: om.organiser_team_id,
        p_amount_pence: buyIn,
        p_related_team_id: teamId,
      });
      // Don't fail the join if reimbursement can't be applied (e.g. migration not
      // run yet) — the joiner is already entered and paid. Surface it in logs.
      if (reimburseErr) console.error("reimburse_team failed:", reimburseErr.message);
    }

    // 6) Mark the tournament full if this was the last spot.
    if (joinedTeams.length + 1 >= om.max_teams) {
      await adminSupabase.from("open_matches").update({ status: "full" }).eq("id", openMatchId);
    }

    // Mark a pending invitation accepted so its discount can't be reused.
    if (invite && invite.status === "pending") {
      await adminSupabase.from("tournament_invitations").update({ status: "accepted" }).eq("id", invite.id);
    }

    // 7) Pre-create pending replenishments for the joining squad (best-effort — the
    //    buy-in is already paid from credit; this just sets up who refills it).
    if (buyIn > 0 && om.booking_id) {
      const { data: members } = await adminSupabase
        .from("team_members")
        .select("player_id")
        .eq("team_id", teamId)
        .eq("status", "approved");
      const playerIds = Array.from(
        new Set([...(members ?? []).map((m) => m.player_id), userId].filter(Boolean))
      );
      if (playerIds.length > 0) {
        const share = Math.floor(buyIn / playerIds.length);
        const fee = Math.round(share * 0.05);
        const rows = playerIds.map((pid) => ({
          booking_id: om.booking_id,
          player_id: pid,
          amount_pence: share,
          unitr_fee_pence: fee,
          total_pence: share + fee,
          status: "pending",
          purpose: "replenish",
          team_id: teamId,
          applied: false,
        }));
        // Ignore conflicts (a player already has a row for this booking).
        await adminSupabase.from("player_payments").upsert(rows, { onConflict: "booking_id,player_id", ignoreDuplicates: true });
      }
    }

    return NextResponse.json({
      ok: true,
      buyInPence: buyIn,
      pitchId: om.pitch_id,
      bookingId: om.booking_id,
      hostType: isTeamHosted ? "team" : "venue",
    });
  } catch (err) {
    console.error("tournaments/join error:", err);
    return NextResponse.json({ error: "Could not join tournament" }, { status: 500 });
  }
}
