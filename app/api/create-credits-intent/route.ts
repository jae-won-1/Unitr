import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { amountPence, teamId } = await req.json();

    if (!amountPence || amountPence < 100) {
      return NextResponse.json({ error: "Minimum top-up is £1.00" }, { status: 400 });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountPence,
      currency: "gbp",
      automatic_payment_methods: { enabled: true },
      metadata: { teamId: teamId ?? "", type: "team_credits" },
      description: `Unitr team credits — £${(amountPence / 100).toFixed(2)}`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Stripe error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
