import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getCallerId, unauthorized } from "@/lib/api-auth";
import { applyRequestPayment, financeOff } from "@/lib/team-finance-server";

export const dynamic = "force-dynamic";

// The payer's browser saying "that card payment finished". The Stripe webhook
// records the same payment; this exists so the tick shows straight away and so
// local development works without a webhook forwarder. Whichever arrives
// second does nothing (apply_request_payment is idempotent on the intent).
//
// Nothing is believed from the body except which intent to look at: Stripe is
// asked whether it succeeded, and it has to be the caller's own payment.
export async function POST(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { paymentIntentId } = await req.json().catch(() => ({}));
    if (typeof paymentIntentId !== "string" || !paymentIntentId.startsWith("pi_")) {
      return NextResponse.json({ error: "Missing paymentIntentId" }, { status: 400 });
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata?.type !== "payment_request" || pi.metadata.playerId !== callerId) {
      return NextResponse.json({ error: "That isn't your payment." }, { status: 403 });
    }
    if (pi.status !== "succeeded") {
      // Still processing: the webhook will record it when it lands.
      return NextResponse.json({ applied: false, status: pi.status });
    }

    const outcome = await applyRequestPayment(pi);
    return NextResponse.json({ applied: outcome === "applied" || outcome === "already" });
  } catch (err) {
    console.error("finance/confirm-payment error:", err);
    return NextResponse.json({ error: "Couldn't confirm that payment." }, { status: 500 });
  }
}
