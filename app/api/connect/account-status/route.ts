import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";

// Refresh a pitch's payout status from Stripe. Called by the venue portal
// after onboarding (and on load) so `pitches.payouts_enabled` mirrors whether
// the connected account can actually receive transfers.
export async function POST(req: NextRequest) {
  try {
    const { pitchId } = await req.json();
    if (!pitchId) {
      return NextResponse.json({ error: "Missing pitchId" }, { status: 400 });
    }

    const { data: pitch } = await adminSupabase
      .from("pitches")
      .select("id, stripe_account_id, payouts_enabled")
      .eq("id", pitchId)
      .maybeSingle();
    if (!pitch) {
      return NextResponse.json({ error: "Pitch not found" }, { status: 404 });
    }
    if (!pitch.stripe_account_id) {
      return NextResponse.json({ connected: false, payoutsEnabled: false });
    }

    const account = await stripe.accounts.retrieve(pitch.stripe_account_id);
    // "Can this account receive our transfers?" — the transfers capability is
    // what stripe.transfers.create checks, so that's what we mirror.
    const payoutsEnabled = account.capabilities?.transfers === "active";

    if (payoutsEnabled !== pitch.payouts_enabled) {
      await adminSupabase
        .from("pitches")
        .update({ payouts_enabled: payoutsEnabled })
        .eq("id", pitch.id);
    }

    return NextResponse.json({
      connected: true,
      payoutsEnabled,
      detailsSubmitted: account.details_submitted ?? false,
    });
  } catch (err) {
    console.error("Connect account-status error:", err);
    return NextResponse.json({ error: "Could not check account status" }, { status: 500 });
  }
}
