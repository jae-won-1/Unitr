import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, callerCustomerId, forbidden, unauthorized } from "@/lib/api-auth";

// Card-on-file step 2: a SetupIntent has succeeded — put its card on the
// caller's profile, and hand back the brand + last4 to show.
//
// The profile write happens HERE, not in the browser. The card columns used to
// be written by the client, and profiles are world-readable: anyone could copy
// a stranger's customer + payment method onto their own row and have
// /api/settle-match or /api/book/pitch charge that stranger's card off-session.
// supabase_card_and_credit_lockdown.sql now refuses a client write to them, so
// this route is the only way in, and it saves a card only if Stripe says it is
// attached to the caller's own customer.
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
    // /api/create-setup-intent wrote the caller's customer to the profile
    // before the card was collected, so a card of theirs is always attached to it.
    const mine = await callerCustomerId(callerId);
    if (!customer || !mine || customer !== mine) {
      return forbidden("That card belongs to another account.");
    }

    const brand = pm.card?.brand ?? null;
    const last4 = pm.card?.last4 ?? null;

    // Test mode shares the live database: a test card written here would
    // replace this player's live one (lib/stripe-mode.ts).
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      const { error } = await adminSupabase.from("profiles").update({
        stripe_payment_method_id: pm.id,
        card_brand: brand,
        card_last4: last4,
      }).eq("id", callerId);
      if (error) {
        console.error("payment-method: could not save card:", error.message);
        return NextResponse.json({ error: "Could not save card" }, { status: 500 });
      }
    }

    return NextResponse.json({ brand, last4 });
  } catch (err) {
    console.error("Stripe payment-method error:", err);
    return NextResponse.json({ error: "Could not read card details" }, { status: 500 });
  }
}
