import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getCaller, unauthorized } from "@/lib/api-auth";
import { ensureStripeCustomer } from "@/lib/stripe-customer";

// Card-on-file step 1: create (or reuse) a Stripe customer and open a SetupIntent
// so the player can save a card for future off-session match settlement.
//
// The customer is the caller's own, read from their profile — a customerId from
// the body would attach the new card to whoever's customer was named.
export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req);
    if (!caller) return unauthorized();

    const { name } = await req.json().catch(() => ({ name: null }));

    // Written as it is created, not after the card saves. The profile form used
    // to be the only thing that remembered this id, so a 3D Secure challenge
    // that cost the payer their tab lost it — the next attempt made a second
    // Stripe customer, and a card recovered by ResumePaymentBanner had no
    // customer to record. Now shared with the PaymentIntent routes, so a player
    // has exactly one customer however they first reach Stripe.
    const customer = await ensureStripeCustomer(caller.id, caller.email, name);

    const setupIntent = await stripe.setupIntents.create({
      customer,
      usage: "off_session",
      payment_method_types: ["card"],
    });

    return NextResponse.json({ clientSecret: setupIntent.client_secret, customerId: customer });
  } catch (err) {
    console.error("Stripe setup-intent error:", err);
    return NextResponse.json({ error: "Could not start card setup" }, { status: 500 });
  }
}
