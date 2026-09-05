import { NextRequest, NextResponse } from "next/server";
import { stripe, calcSplit } from "@/lib/stripe";
import { feeWithin } from "@/lib/unitr-fee";
import { getCaller, callerCustomerId, unauthorized } from "@/lib/api-auth";

// Open a card payment for the caller's own share of a pitch. The payer and the
// Stripe customer come from the session, not the body — the amount is still the
// caller's to choose, but it is only ever their own card being charged.
export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req);
    if (!caller) return unauthorized();

    const { pitchPricePerHour, playerCount, bookingId, amountPence } = await req.json();
    const playerId = caller.id;
    const customerId = await callerCustomerId(caller.id);
    const email = caller.email;

    // Credit-replenishment path passes an exact pre-computed amount (the player's
    // pitch share + fee). Individual path passes price + headcount to split here.
    let perPlayer: number, unitrFee: number, totalPerPlayer: number;
    if (amountPence && amountPence > 0) {
      totalPerPlayer = Math.round(amountPence);
      unitrFee = feeWithin(totalPerPlayer);
      perPlayer = totalPerPlayer - unitrFee;
    } else if (pitchPricePerHour && playerCount) {
      ({ totalPerPlayer, perPlayer, unitrFee } = calcSplit(pitchPricePerHour, playerCount));
    } else {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Attach to a Stripe customer and mark the payment method for future
    // off-session reuse, so the card can be saved on the profile afterwards.
    let customer = customerId as string | undefined;
    if (!customer) {
      const created = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { app: "unitr" },
      });
      customer = created.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalPerPlayer,
      currency: "gbp",
      customer,
      setup_future_usage: "off_session",
      // allow_redirects "never" keeps the Payment Element to methods that
      // finish in place (cards, wallets). Left on, Stripe offers whatever the
      // LIVE account has enabled — Klarna, iDEAL, Bancontact — and those
      // finish by sending the payer to the provider's own site. Every confirm
      // in this app is confirmPayment({ redirect: "if_required" }) with no
      // return_url, so a payer choosing one of those gets an error instead of
      // a payment. Test mode hides this: fewer methods are enabled there.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        bookingId: bookingId ?? "",
        playerId,
        pitchShare: perPlayer,
        unitrFee: unitrFee,
      },
      description: `Unitr match booking — £${(perPlayer / 100).toFixed(2)} pitch + £${(unitrFee / 100).toFixed(2)} platform fee`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, customerId: customer });
  } catch (err) {
    console.error("Stripe error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
