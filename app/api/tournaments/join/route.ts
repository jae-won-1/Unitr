import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { payVenue } from "@/lib/venue-payout";
import { feeOn } from "@/lib/uniter-fee";
import { teamCategoryRefusal } from "@/lib/gender-entry";
import { LINKED_FINANCE } from "@/lib/finance-mode";
import { stripe } from "@/lib/stripe";
import { paymentRateLimit } from "@/lib/rate-limit";
import { afterEventEntry, finalizeEventEntry, isRefusal, priceEventEntry } from "@/lib/event-entry-server";
import { loadTeamCard, TeamCardTableMissing } from "@/lib/team-card-server";

// ── Linked finance: the buy-in is paid with the team card ───────────────
// docs/PAYMENT_PIVOT.md step 2. There is no team credit to debit. A leader
// saves a card for the team in Team finance (/api/finance/team-card) —
// ideally the debit card of the team's linked bank account, which is where
// the squad's payment requests are paid out — and entries are charged to it.
// Three calls to this route, all from the same entry sheet:
//
//   1. quote: true — check the entry and price it (invitation discount, the
//      fee on top). Nothing is charged; the leader sees the total and the card.
//   2. no paymentIntentId — charge the team card, the leader present. A venue's
//      or a team's event names that host's Stripe account as the charge's
//      destination; Uniter's own event is an ordinary sale. Usually that is the
//      end: the entry is recorded at once. If the bank wants the leader to
//      approve it, the answer carries the client secret for the app to finish.
//   3. paymentIntentId — after the app finished that approval: verify the
//      intent with Stripe and record the entry.
//
// Recording is lib/event-entry-server.ts's finalizeEventEntry, idempotent, and
// also run by the Stripe webhook — so an app that dies after paying still ends
// up entered — and it refunds the card if the event filled or was cancelled
// while the payment was going through. A free entry is simply recorded.
async function enterByCard(
  userId: string,
  body: { openMatchId: string; teamId: string; teamName?: string; paymentIntentId?: string; quote?: boolean },
) {
  const { openMatchId, teamId, teamName, paymentIntentId, quote } = body;

  const entered = (buyInPence: number, totalPence: number) =>
    NextResponse.json({ ok: true, buyInPence, totalPence, paidBy: "team_card" });

  // ── 3. Finish after the bank's approval ──
  if (paymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata?.type !== "event_entry" || pi.metadata.openMatchId !== openMatchId
        || pi.metadata.teamId !== teamId) {
      return forbidden("That payment isn't for this entry.");
    }
    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: "That payment hasn't gone through yet." }, { status: 409 });
    }
    const outcome = await finalizeEventEntry(pi);
    if (outcome.status === "refunded") {
      return NextResponse.json({ error: outcome.reason, refunded: true }, { status: 409 });
    }
    if (outcome.status === "not_an_entry") {
      return NextResponse.json({ error: "That payment isn't for an entry." }, { status: 400 });
    }
    return entered(outcome.buyInPence, outcome.totalPence);
  }

  const price = await priceEventEntry(openMatchId, teamId);
  if (isRefusal(price)) return NextResponse.json({ error: price.refusal }, { status: price.status });

  // Nothing to pay (a full-discount invitation, a free event): just enter.
  if (price.totalPence <= 0) {
    if (quote) return NextResponse.json({ quote: true, buyInPence: 0, feePence: 0, totalPence: 0, card: null });
    const { error: joinErr } = await adminSupabase.from("open_match_teams").insert({
      open_match_id: openMatchId, team_id: teamId, team_name: teamName ?? "",
      joined_by: userId, payment_status: "paid",
    });
    if (joinErr) {
      return NextResponse.json({ error: `Couldn't enter the tournament: ${joinErr.message}` }, { status: 500 });
    }
    await afterEventEntry({
      event: price.event, teamId, userId, joinedBefore: price.joinedCount, invite: price.invite,
    });
    return entered(0, 0);
  }

  let card;
  try {
    card = await loadTeamCard(teamId);
  } catch (err) {
    if (err instanceof TeamCardTableMissing) {
      return NextResponse.json(
        { error: "The team card isn't set up on this database yet — run supabase_team_card.sql." },
        { status: 503 },
      );
    }
    throw err;
  }
  const totals = { buyInPence: price.buyInPence, feePence: price.feePence, totalPence: price.totalPence };
  if (!card?.stripe_payment_method_id) {
    return NextResponse.json({
      error: "Your team hasn't saved a team card yet. Add one in Team finance — it pays for entries.",
      code: "NO_TEAM_CARD",
      ...totals,
    }, { status: 409 });
  }

  // ── 1. The price, and the card it will go on ──
  if (quote) {
    return NextResponse.json({ quote: true, ...totals, card: { brand: card.brand, last4: card.last4 } });
  }

  // ── 2. Charge the team card ──
  const limited = await paymentRateLimit(userId);
  if (limited) return limited;

  let pi;
  try {
    pi = await stripe.paymentIntents.create({
      amount: price.totalPence,
      currency: "gbp",
      customer: card.stripe_customer_id,
      payment_method: card.stripe_payment_method_id,
      // Confirmed now, with the leader present (not off-session): if the bank
      // wants an approval, the app shows it to the leader who pressed Pay.
      confirm: true,
      // Cards and wallets only — see the convention in CLAUDE.md.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      ...(price.destination
        ? {
            transfer_data: { destination: price.destination },
            ...(price.feePence > 0 ? { application_fee_amount: price.feePence } : {}),
          }
        : {}),
      // finalizeEventEntry records the entry off this metadata — the only link
      // between the charge and what it bought.
      metadata: {
        type: "event_entry",
        paidWith: "team_card",
        openMatchId,
        teamId,
        userId,
        teamName: (teamName ?? "").slice(0, 120),
        buyInPence: String(price.buyInPence),
        feePence: String(price.feePence),
        host: price.host,
        ...(price.invite && price.invite.status === "pending" ? { inviteId: price.invite.id } : {}),
      },
      description: `Uniter — entry to ${price.event.title || "a tournament"}`,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return NextResponse.json(
      { error: e.code === "card_declined" || e.message
          ? `The team card was declined${e.message ? `: ${e.message}` : "."} Check it, or replace it in Team finance.`
          : "The team card couldn't be charged." },
      { status: 402 },
    );
  }

  if (pi.status === "requires_action") {
    return NextResponse.json({ requiresAction: true, clientSecret: pi.client_secret, paymentIntentId: pi.id, ...totals });
  }
  if (pi.status === "processing") {
    // Rare for a card; the webhook records the entry when it lands.
    return NextResponse.json({ ok: true, processing: true, ...totals, paidBy: "team_card" });
  }
  if (pi.status !== "succeeded") {
    return NextResponse.json({ error: "The team card couldn't be charged. Check it in Team finance." }, { status: 402 });
  }

  const outcome = await finalizeEventEntry(pi);
  if (outcome.status === "refunded") {
    return NextResponse.json({ error: outcome.reason, refunded: true }, { status: 409 });
  }
  return entered(price.buyInPence, price.totalPence);
}

export async function POST(req: NextRequest) {
  try {
    // Entering a tournament spends the team pot, so the entrant is the signed-in
    // caller, not whoever the body claims. A userId in the body is only an
    // assertion, and teamId with no check let anyone empty any team's credit.
    const userId = await getCallerId(req);
    if (!userId) return unauthorized();

    const body = await req.json();
    const { openMatchId, teamId, teamName } = body;
    if (!openMatchId || !teamId) {
      return NextResponse.json({ error: "Missing openMatchId or teamId" }, { status: 400 });
    }
    if (!(await isTeamLeader(userId, teamId))) {
      return forbidden("Only the captain or a co-captain can enter the team into a tournament.");
    }

    // Linked finance: no credit to debit — the buy-in is paid by card.
    if (LINKED_FINANCE) return await enterByCard(userId, body);

    // 1) Load the tournament listing.
    const { data: om } = await adminSupabase
      .from("open_matches")
      .select("id, pitch_id, price_per_team_pence, max_teams, status, booking_id, title, match_date, start_time, organiser_team_id, organiser_admin_id")
      .eq("id", openMatchId)
      .maybeSingle();
    if (!om) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    if (om.status === "cancelled") {
      return NextResponse.json({ error: "This tournament has been cancelled." }, { status: 409 });
    }
    // Men's teams enter men's events, women's teams women's — checked before
    // the debit below; the database refuses the entry row as well.
    const wrongCategory = await teamCategoryRefusal(teamId, { table: "open_matches", id: openMatchId });
    if (wrongCategory) return NextResponse.json({ error: wrongCategory }, { status: 409 });

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

    // 5) Team-hosted (and not the organiser joining their own tournament):
    //    reimburse the organiser team's credit with this buy-in, since they
    //    fronted the whole pitch fee. An organiser entering their own
    //    tournament gets neither this reimbursement nor a venue payout below —
    //    they already paid the venue in full at creation time.
    const isOrganiserSelfJoin = Boolean(om.organiser_team_id) && om.organiser_team_id === teamId;
    const isTeamHosted = Boolean(om.organiser_team_id) && !isOrganiserSelfJoin;
    // Admin-hosted (Uniter staff): the admin already paid the venue in cash
    // outside the app, so after the debit above the buy-in simply stays with
    // the platform — no reimbursement, no venue transfer. The ledger's
    // booking_capture row is the record of it.
    const isAdminHosted = Boolean(om.organiser_admin_id);
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

    // Venue-hosted: pay the venue directly, server-side, so the transfer can't
    // be skipped by the client and its (potentially failed, e.g. insufficient
    // test-mode balance) outcome is reported back to the caller. Never fires
    // for an organiser joining their own tournament — that pitch fee was
    // already paid to the venue when the tournament was created.
    let transferStatus: "paid" | "failed" | "skipped" = "skipped";
    let transferError: string | null = null;
    if (buyIn > 0 && !om.organiser_team_id && !isAdminHosted && om.pitch_id) {
      try {
        // Direct call, not an HTTP hop: /api/connect/venue-transfer now demands
        // a caller session and the server has no token of its own to present.
        // The check that route performs was already made above — this team is
        // entering, and the buy-in is what the listing charges.
        const transfer = await payVenue({
          pitchId: om.pitch_id,
          teamId,
          openMatchId,
          amountPence: buyIn,
        });
        if (transfer.status === 200) {
          transferStatus = "paid";
        } else {
          transferStatus = "failed";
          transferError = (transfer.body.error as string) ?? "Venue transfer failed";
        }
      } catch (err) {
        transferStatus = "failed";
        transferError = (err as { message?: string }).message ?? "Venue transfer failed";
        console.error("tournaments/join venue-transfer error:", err);
      }
    }

    // 6–7) Mark the tournament full on the last spot, use up the invitation,
    //    and ask the squad whether they can play it. A tournament entry commits
    //    the team the same way an accepted challenge does, and captains often
    //    enter one without running a poll first — so the entry raises the same
    //    availability question on Home and the Calendar, keyed off
    //    open_match_id (supabase_event_availability.sql); where a poll DID
    //    propose this date its answers carry straight over. Shared with the
    //    card path (lib/event-entry-server.ts); best-effort throughout.
    await afterEventEntry({
      event: om, teamId, userId, joinedBefore: joinedTeams.length, invite: invite ?? null,
    });

    // 8) Pre-create pending replenishments for the joining squad (best-effort — the
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
        const fee = feeOn(share);
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
      hostType: isOrganiserSelfJoin ? "organiser" : isTeamHosted ? "team" : isAdminHosted ? "admin" : "venue",
      transferStatus,
      transferError,
    });
  } catch (err) {
    console.error("tournaments/join error:", err);
    return NextResponse.json({ error: "Could not join tournament" }, { status: 500 });
  }
}
