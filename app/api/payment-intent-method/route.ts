import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

// After a card-on-file PaymentIntent succeeds, resolve which payment method it
// used (and its brand/last4) so the card can be saved on the player's profile.
export async function GET(req: NextRequest) {
  try {
    const paymentIntentId = req.nextUrl.searchParams.get("paymentIntentId");
    if (!paymentIntentId) {
      return NextResponse.json({ error: "Missing paymentIntentId" }, { status: 400 });
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
    if (!pm) {
      return NextResponse.json({ error: "No payment method on this intent" }, { status: 404 });
    }

    const method = await stripe.paymentMethods.retrieve(pm);
    return NextResponse.json({
      paymentMethodId: pm,
      brand: method.card?.brand ?? null,
      last4: method.card?.last4 ?? null,
    });
  } catch (err) {
    console.error("Stripe payment-intent-method error:", err);
    return NextResponse.json({ error: "Could not read payment method" }, { status: 500 });
  }
}
