import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

// Card-on-file step 1: create (or reuse) a Stripe customer and open a SetupIntent
// so the player can save a card for future off-session match settlement.
export async function POST(req: NextRequest) {
  try {
    const { customerId, email, name } = await req.json();

    let customer = customerId as string | undefined;
    if (!customer) {
      const created = await stripe.customers.create({
        email: email ?? undefined,
        name: name ?? undefined,
        metadata: { app: "unitr" },
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
