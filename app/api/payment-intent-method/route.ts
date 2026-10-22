import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, callerCustomerId, forbidden, unauthorized } from "@/lib/api-auth";

// "Save this card" after a payment: copy the card a PaymentIntent was paid
// with onto the caller's profile, and hand back what was saved.
//
// Written here rather than by the browser, for the reason given in
// /api/payment-method: a client that can write its own card columns can write
// someone else's card into them and spend it. Only a card that paid an intent
// on the caller's own customer is saved.
export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { paymentIntentId } = await req.json();
    if (!paymentIntentId) {
      return NextResponse.json({ error: "Missing paymentIntentId" }, { status: 400 });
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "succeeded" && pi.status !== "processing") {
      return NextResponse.json({ error: "That payment hasn't gone through." }, { status: 409 });
    }
    const piCustomer = typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null;
    // Every intent route attaches the payer's customer from their profile
    // (lib/stripe-customer.ts), so the two match. A profile with no customer
    // yet falls back to the payer stamped into metadata — set by our routes
    // from the session, never by the client.
    const mine = await callerCustomerId(callerId);
    const ours = piCustomer !== null &&
      (mine ? piCustomer === mine : pi.metadata?.playerId === callerId);
    if (!ours) {
      return forbidden("That payment belongs to another account.");
    }
    const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
    if (!pm) {
      return NextResponse.json({ error: "No payment method on this intent" }, { status: 404 });
    }

    const method = await stripe.paymentMethods.retrieve(pm);
    const brand = method.card?.brand ?? null;
    const last4 = method.card?.last4 ?? null;

    // Never in test mode — see lib/stripe-mode.ts.
    let saved = false;
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      const { error } = await adminSupabase.from("profiles").update({
        stripe_customer_id: piCustomer,
        stripe_payment_method_id: pm,
        card_brand: brand,
        card_last4: last4,
      }).eq("id", callerId);
      if (error) {
        console.error("payment-intent-method: could not save card:", error.message);
        return NextResponse.json({ error: "Could not save card" }, { status: 500 });
      }
      saved = true;
    }

    return NextResponse.json({ saved, paymentMethodId: pm, customerId: piCustomer, brand, last4 });
  } catch (err) {
    console.error("Stripe payment-intent-method error:", err);
    return NextResponse.json({ error: "Could not read payment method" }, { status: 500 });
  }
}
