import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";

// Create (or reuse) a Stripe Connect EXPRESS account for a venue's pitch and
// return an onboarding link. TEST MODE: this lets a venue "connect" a payout
// account so Unitr can later transfer pitch fees to it (see venue-transfer).
export async function POST(req: NextRequest) {
  try {
    const { pitchId } = await req.json();
    if (!pitchId) {
      return NextResponse.json({ error: "Missing pitchId" }, { status: 400 });
    }

    const { data: pitch } = await adminSupabase
      .from("pitches")
      .select("id, name, contact_email, stripe_account_id")
      .eq("id", pitchId)
      .maybeSingle();
    if (!pitch) {
      return NextResponse.json({ error: "Pitch not found" }, { status: 404 });
    }

    // Reuse an existing connected account; otherwise create a fresh Express one.
    let accountId = pitch.stripe_account_id as string | null;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        email: pitch.contact_email ?? undefined,
        business_type: "company",
        capabilities: { transfers: { requested: true } },
        business_profile: { name: pitch.name, product_description: "5-a-side pitch hire" },
        metadata: { pitchId: pitch.id, type: "unitr_venue" },
      });
      accountId = account.id;
      await adminSupabase.from("pitches").update({ stripe_account_id: accountId }).eq("id", pitch.id);
    }

    // Onboarding link the venue opens to finish KYC and enable payouts.
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/pitches?connect=refresh&pitch=${pitch.id}`,
      return_url: `${origin}/pitches?connect=done&pitch=${pitch.id}`,
      type: "account_onboarding",
    });

    return NextResponse.json({ accountId, onboardingUrl: link.url });
  } catch (err) {
    console.error("Connect create-venue-account error:", err);
    return NextResponse.json({ error: "Could not create venue account" }, { status: 500 });
  }
}
