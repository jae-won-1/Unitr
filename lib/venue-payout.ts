import { adminSupabase } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

// Paying a venue: transfer the pitch fee from Unitr's Stripe balance to the
// venue's connected account. This is the CASH counterpart to the in-app credit
// debit on match confirmation — every booking's credit-spend should produce
// exactly one venue_transfers row here so the two reconcile.
//
// The logic lives here rather than in the route because two callers need it:
// the route (a captain's browser, authorised there) and /api/tournaments/join,
// which pays a venue-hosted tournament's buy-in over server-side. The join
// route used to fetch its own /api/connect/venue-transfer over HTTP; calling
// the function directly means the route can demand a caller session without
// the server having to forge one for itself.
//
// TEST MODE: a transfer needs available balance on the platform. In test mode
// fund it from the Stripe dashboard (or /api/dev/fund-test-balance); if there
// isn't enough, Stripe returns balance_insufficient and we record the attempt
// as 'failed' rather than throwing — the demo still shows the intended money
// movement.

export type VenuePayout = {
  pitchId: string;
  bookingId?: string | null;
  matchId?: string | null;
  teamId?: string | null;
  openMatchId?: string | null;
  amountPence: number;
};

// Shaped so a caller can hand it straight to NextResponse.json(body, { status }).
export type PayoutOutcome = { status: number; body: Record<string, unknown> };

// The most this payout is allowed to be, derived from the thing being paid for
// rather than from whoever asked. Without it the amount is just a number in a
// request body, and the endpoint is a cash-out tap on the platform balance.
//
// Returns null when the referenced booking/tournament doesn't exist or belongs
// to a different pitch — both mean "don't pay this".
export async function payoutCeilingPence(p: VenuePayout): Promise<number | null> {
  if (p.bookingId) {
    const { data } = await adminSupabase
      .from("pitch_bookings")
      .select("pitch_id, total_price_pence")
      .eq("id", p.bookingId)
      .maybeSingle();
    if (!data || data.pitch_id !== p.pitchId) return null;
    return Math.round(data.total_price_pence ?? 0);
  }
  if (p.openMatchId) {
    const { data } = await adminSupabase
      .from("open_matches")
      .select("pitch_id, price_per_team_pence")
      .eq("id", p.openMatchId)
      .maybeSingle();
    if (!data || data.pitch_id !== p.pitchId) return null;
    return Math.round(data.price_per_team_pence ?? 0);
  }
  // A challenge whose booking row failed to insert still owes the venue its
  // pitch fee — cap it at one hour of the pitch's list price.
  const { data: pitch } = await adminSupabase
    .from("pitches").select("price_per_hour").eq("id", p.pitchId).maybeSingle();
  if (!pitch) return null;
  return Math.round((pitch.price_per_hour ?? 0) * 100);
}

export async function payVenue(p: VenuePayout): Promise<PayoutOutcome> {
  const { pitchId, bookingId, matchId, teamId, openMatchId } = p;

  const { data: pitch } = await adminSupabase
    .from("pitches")
    .select("id, name, stripe_account_id")
    .eq("id", pitchId)
    .maybeSingle();
  if (!pitch?.stripe_account_id) {
    return { status: 409, body: { error: "This venue has not connected a payout account yet." } };
  }

  // Idempotency: don't pay the same booking twice. Tournament buy-ins have no
  // individual booking (every team shares the tournament's one reservation),
  // so dedupe those on (openMatchId, teamId) instead.
  if (bookingId) {
    const { data: existing } = await adminSupabase
      .from("venue_transfers")
      .select("id, status, stripe_transfer_id")
      .eq("booking_id", bookingId)
      .eq("status", "paid")
      .maybeSingle();
    if (existing) {
      return { status: 200, body: { transferId: existing.stripe_transfer_id, alreadyPaid: true } };
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
      return {
        status: 503,
        body: { error: "Payout ledger is out of date — run supabase_venue_payouts.sql before taking tournament payments." },
      };
    }
    if (existing) {
      return { status: 200, body: { transferId: existing.stripe_transfer_id, alreadyPaid: true } };
    }
  }

  const amount = Math.round(p.amountPence);
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
    void team_id; void open_match_id;
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
    return { status: 502, body: { error: failureReason, status, recorded, recordWarning } };
  }
  return { status: 200, body: { transferId, status, recorded, recordWarning } };
}
