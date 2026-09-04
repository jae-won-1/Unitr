import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getCaller, callerCustomerId, unauthorized } from "@/lib/api-auth";

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
    const customerId = await callerCustomerId(caller.id);
    const email = caller.email;

    let customer = customerId as string | undefined;
    if (!customer) {
      const created = await stripe.customers.create({
        email: email ?? undefined,
        name: name ?? undefined,
        metadata: { app: "unitr", playerId: caller.id },
      });
      customer = created.id;
    }

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
