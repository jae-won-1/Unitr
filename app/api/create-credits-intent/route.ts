import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { amountPence, teamId, customerId, email } = await req.json();

    if (!amountPence || amountPence < 100) {
      return NextResponse.json({ error: "Minimum top-up is £1.00" }, { status: 400 });
    }

    // Attach to a Stripe customer and mark the card for future off-session
    // reuse, so we can offer to save it once the payment succeeds. Reuse the
    // caller's existing customer where they have one, rather than minting a
    // second customer for the same player.
    let customer = customerId as string | undefined;
    if (!customer) {
      const created = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { app: "unitr" },
      });
      customer = created.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountPence,
      currency: "gbp",
      customer,
      setup_future_usage: "off_session",
      automatic_payment_methods: { enabled: true },
      metadata: { teamId: teamId ?? "", type: "team_credits" },
      description: `Unitr team credits — £${(amountPence / 100).toFixed(2)}`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, customerId: customer });
  } catch (err) {
    console.error("Stripe error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
