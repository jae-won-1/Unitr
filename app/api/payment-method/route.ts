import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

// Card-on-file step 2: after a SetupIntent succeeds, fetch the saved card's
// brand + last4 so we can show it on the profile.
export async function POST(req: NextRequest) {
  try {
    const { paymentMethodId } = await req.json();
    if (!paymentMethodId) {
      return NextResponse.json({ error: "Missing paymentMethodId" }, { status: 400 });
    }

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    return NextResponse.json({
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
    });
  } catch (err) {
    console.error("Stripe payment-method error:", err);
    return NextResponse.json({ error: "Could not read card details" }, { status: 500 });
  }
}
