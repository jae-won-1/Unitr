import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getCallerId, callerCustomerId, forbidden, unauthorized } from "@/lib/api-auth";

// Card-on-file step 2: after a SetupIntent succeeds, fetch the saved card's
// brand + last4 so we can show it on the profile.
//
// Only the caller's own card: unauthenticated, this read any payment method by
// id and handed back the brand and last four digits.
export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { paymentMethodId } = await req.json();
    if (!paymentMethodId) {
      return NextResponse.json({ error: "Missing paymentMethodId" }, { status: 400 });
    }

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const customer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id ?? null;
    // A card saved seconds ago isn't on the profile yet, so a customer that
    // matches the caller's is enough — anything else is someone else's card.
    if (customer && customer !== (await callerCustomerId(callerId))) {
      return forbidden("That card belongs to another account.");
    }
    return NextResponse.json({
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
    });
  } catch (err) {
    console.error("Stripe payment-method error:", err);
    return NextResponse.json({ error: "Could not read card details" }, { status: 500 });
  }
}
