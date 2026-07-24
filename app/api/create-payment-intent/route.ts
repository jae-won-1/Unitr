import { NextRequest, NextResponse } from "next/server";
import { stripe, calcSplit } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { pitchPricePerHour, playerCount, bookingId, playerId, amountPence, customerId, email } = await req.json();

    // Credit-replenishment path passes an exact pre-computed amount (the player's
    // pitch share + fee). Individual path passes price + headcount to split here.
    let perPlayer: number, unitrFee: number, totalPerPlayer: number;
    if (amountPence && amountPence > 0) {
      totalPerPlayer = Math.round(amountPence);
      unitrFee = Math.round(totalPerPlayer - totalPerPlayer / 1.05);
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
      automatic_payment_methods: { enabled: true },
      metadata: {
        bookingId: bookingId ?? "",
        playerId: playerId ?? "",
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
