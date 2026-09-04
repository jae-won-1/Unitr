import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, ownsPitch, forbidden, unauthorized } from "@/lib/api-auth";

// Refresh a VENUE's payout status from Stripe. The venue's pitches all share
// one connected account, so the answer is mirrored onto every pitch row in
// the group — `pitches.payouts_enabled` tracks whether the venue's account
// can actually receive transfers.
export async function POST(req: NextRequest) {
  try {
    // Reads a Connect account's KYC state and writes payouts_enabled across
    // the venue's pitches — the venue's own manager, or an admin.
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { pitchId } = await req.json();
    if (!pitchId) {
      return NextResponse.json({ error: "Missing pitchId" }, { status: 400 });
    }
    if (!(await ownsPitch(callerId, pitchId))) {
      return forbidden("That pitch belongs to another venue.");
    }

    const { data: pitch } = await adminSupabase
      .from("pitches")
      .select("id, venue_owner_id, stripe_account_id, payouts_enabled")
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

    // Mirror onto every pitch sharing this venue account.
    const update = adminSupabase.from("pitches").update({ payouts_enabled: payoutsEnabled });
    if (pitch.venue_owner_id) {
      await update.eq("venue_owner_id", pitch.venue_owner_id).eq("stripe_account_id", pitch.stripe_account_id);
    } else {
      await update.eq("id", pitch.id);
    }

    return NextResponse.json({
      connected: true,
      payoutsEnabled,
      accountId: pitch.stripe_account_id,
      detailsSubmitted: account.details_submitted ?? false,
    });
  } catch (err) {
    console.error("Connect account-status error:", err);
    return NextResponse.json({ error: "Could not check account status" }, { status: 500 });
  }
}
