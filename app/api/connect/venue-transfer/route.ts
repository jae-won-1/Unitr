import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
    const { pitchId, bookingId, matchId, amountPence } = await req.json();
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

    // Idempotency: don't pay the same booking twice.
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
        metadata: { pitchId: pitch.id, bookingId: bookingId ?? "", matchId: matchId ?? "" },
      });
      transferId = transfer.id;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      status = "failed";
      failureReason = e.message ?? "Transfer failed";
    }

    await adminSupabase.from("venue_transfers").insert({
      pitch_id: pitch.id,
      booking_id: bookingId ?? null,
      match_id: matchId ?? null,
      stripe_account_id: pitch.stripe_account_id,
      stripe_transfer_id: transferId,
      amount_pence: amount,
      status,
      failure_reason: failureReason,
    });

    if (status === "failed") {
      return NextResponse.json({ error: failureReason, status }, { status: 502 });
    }
    return NextResponse.json({ transferId, status });
  } catch (err) {
    console.error("Connect venue-transfer error:", err);
    return NextResponse.json({ error: "Venue transfer failed" }, { status: 500 });
  }
}
