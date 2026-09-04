import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, ownsPitch, forbidden, unauthorized } from "@/lib/api-auth";

// Create (or reuse) ONE Stripe Connect EXPRESS account per VENUE and return an
// onboarding link. A venue is the group of pitches sharing a venue_owner_id —
// multi-pitch venues get a single payout account; revenue is still recorded
// per pitch in venue_transfers so reports can break it down.
export async function POST(req: NextRequest) {
  try {
    // Onboarding stamps a payout account onto every pitch in the venue group,
    // so only that venue's manager (or an admin) may start it. Otherwise
    // anyone could point a venue's pitches at an account they control.
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
      .select("id, name, contact_email, venue_owner_id, stripe_account_id")
      .eq("id", pitchId)
      .maybeSingle();
    if (!pitch) {
      return NextResponse.json({ error: "Pitch not found" }, { status: 404 });
    }

    // All pitches that make up this venue (fall back to the single pitch for
    // legacy rows without an owner).
    const ownerId = pitch.venue_owner_id as string | null;
    const { data: venuePitchesData } = ownerId
      ? await adminSupabase
          .from("pitches")
          .select("id, name, stripe_account_id, created_at")
          .eq("venue_owner_id", ownerId)
          .order("created_at", { ascending: true })
      : { data: [pitch] };
    const venuePitches = venuePitchesData ?? [pitch];
    const primary = venuePitches[0];

    // Reuse the venue's connected account — but only if it really belongs to
    // this venue (legacy data pointed every pitch at one shared demo account).
    let accountId: string | null = null;
    const candidateId = venuePitches.find((p) => p.stripe_account_id)?.stripe_account_id ?? null;
    if (candidateId) {
      try {
        const existing = await stripe.accounts.retrieve(candidateId);
        const meta = existing.metadata ?? {};
        if (ownerId ? meta.venueOwnerId === ownerId : meta.pitchId === pitch.id) {
          accountId = candidateId;
        }
      } catch {
        // Account deleted on Stripe's side — fall through and create a new one.
      }
    }

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        email: pitch.contact_email ?? undefined,
        business_type: "company",
        capabilities: { transfers: { requested: true } },
        business_profile: { name: primary.name, product_description: "Football pitch hire" },
        metadata: {
          venueOwnerId: ownerId ?? "",
          pitchId: pitch.id,
          type: "unitr_venue",
        },
      });
      accountId = account.id;
    }

    // One account for the whole venue: stamp it on every pitch in the group.
    const pitchIds = venuePitches.map((p) => p.id);
    await adminSupabase.from("pitches").update({ stripe_account_id: accountId }).in("id", pitchIds);

    // Onboarding link the venue opens to finish KYC and enable payouts.
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/venue/settings?connect=refresh`,
      return_url: `${origin}/venue/settings?connect=done`,
      type: "account_onboarding",
    });

    return NextResponse.json({ accountId, onboardingUrl: link.url });
  } catch (err) {
    console.error("Connect create-venue-account error:", err);
    return NextResponse.json({ error: "Could not create venue account" }, { status: 500 });
  }
}
