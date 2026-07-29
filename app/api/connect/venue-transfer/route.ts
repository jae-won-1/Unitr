import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";

// Pay a venue: transfer the pitch fee from Unitr's Stripe balance to the
// venue's connected account. This is the CASH counterpart to the in-app
// credit debit on match confirmation — every booking's credit-spend should
// produce exactly one venue_transfers row here so the two reconcile.
//
// TEST MODE: a transfer needs available balance on the platform. In test mode
// fund it from the Stripe dashboard (or test charges); if there isn't enough,
// Stripe returns balance_insufficient and we record the attempt as 'failed'
// rather than throwing — the demo still shows the intended money movement.
export async function POST(req: NextRequest) {
  try {
    const { pitchId, bookingId, matchId, teamId, openMatchId, amountPence } = await req.json();
    if (!pitchId || !amountPence || amountPence < 1) {
      return NextResponse.json({ error: "Missing pitchId or amount" }, { status: 400 });
    }

    const { data: pitch } = await adminSupabase
      .from("pitches")
      .select("id, name, stripe_account_id")
      .eq("id", pitchId)
      .maybeSingle();
    if (!pitch?.stripe_account_id) {
      return NextResponse.json(
        { error: "This venue has not connected a payout account yet." },
        { status: 409 }
      );
    }

    // Idempotency: don't pay the same booking twice. Tournament buy-ins have
    // no individual booking (every team shares the tournament's one
    // reservation), so dedupe those on (openMatchId, teamId) instead.
    if (bookingId) {
      const { data: existing } = await adminSupabase
        .from("venue_transfers")
        .select("id, status, stripe_transfer_id")
        .eq("booking_id", bookingId)
        .eq("status", "paid")
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ transferId: existing.stripe_transfer_id, alreadyPaid: true });
      }
    } else if (openMatchId && teamId) {
      const { data: existing, error: dedupeErr } = await adminSupabase
        .from("venue_transfers")
        .select("id, status, stripe_transfer_id")
        .eq("open_match_id", openMatchId)
        .eq("team_id", teamId)
        .eq("status", "paid")
        .maybeSingle();
      // Without the open_match_id/team_id columns this query errors and the
      // guard silently disappears — refuse rather than risk a double payout.
      if (dedupeErr) {
        console.error("venue-transfer: tournament dedupe unavailable:", dedupeErr.message);
        return NextResponse.json(
          { error: "Payout ledger is out of date — run supabase_venue_payouts.sql before taking tournament payments." },
          { status: 503 }
        );
      }
      if (existing) {
        return NextResponse.json({ transferId: existing.stripe_transfer_id, alreadyPaid: true });
      }
    }

    const amount = Math.round(amountPence);
    let transferId: string | null = null;
    let status: "paid" | "failed" = "paid";
    let failureReason: string | null = null;

    try {
      const transfer = await stripe.transfers.create({
        amount,
        currency: "gbp",
        destination: pitch.stripe_account_id,
        description: `Unitr pitch payout — ${pitch.name}`,
        metadata: { pitchId: pitch.id, bookingId: bookingId ?? "", matchId: matchId ?? "", teamId: teamId ?? "", openMatchId: openMatchId ?? "" },
      });
      transferId = transfer.id;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      status = "failed";
      failureReason = e.message ?? "Transfer failed";
    }

    // Record the ledger row. The money has ALREADY left Stripe at this point, so
    // a failed insert must never be silent — that is exactly how a payout ends up
    // visible in Stripe but missing from the venue's Reports. If the columns
    // added by supabase_venue_payouts.sql aren't in the DB yet, retry without
    // them so the payout is at least recorded, and say so in the response.
    const row = {
      pitch_id: pitch.id,
      booking_id: bookingId ?? null,
      match_id: matchId ?? null,
      team_id: teamId ?? null,
      open_match_id: openMatchId ?? null,
      stripe_account_id: pitch.stripe_account_id,
      stripe_transfer_id: transferId,
      amount_pence: amount,
      status,
      failure_reason: failureReason,
    };
    let recorded = true;
    let recordWarning: string | null = null;
    const { error: insErr } = await adminSupabase.from("venue_transfers").insert(row);
    if (insErr) {
      const { team_id, open_match_id, ...legacyRow } = row;
      const { error: legacyErr } = await adminSupabase.from("venue_transfers").insert(legacyRow);
      if (legacyErr) {
        recorded = false;
        recordWarning = insErr.message;
        console.error("venue-transfer: could not record transfer", transferId, insErr.message, legacyErr.message);
      } else {
        recordWarning = `Recorded without team attribution — run supabase_venue_payouts.sql (${insErr.message})`;
        console.warn("venue-transfer:", recordWarning);
      }
    }

    if (status === "failed") {
      return NextResponse.json({ error: failureReason, status, recorded, recordWarning }, { status: 502 });
    }
    return NextResponse.json({ transferId, status, recorded, recordWarning });
  } catch (err) {
    console.error("Connect venue-transfer error:", err);
    return NextResponse.json({ error: "Venue transfer failed" }, { status: 500 });
  }
}
