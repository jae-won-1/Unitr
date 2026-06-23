import { NextRequest, NextResponse } from "next/server";
import { stripe, calcSplit } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { pitchPricePerHour, playerCount, bookingId, playerId, amountPence } = await req.json();

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

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalPerPlayer,
      currency: "gbp",
      automatic_payment_methods: { enabled: true },
      metadata: {
        bookingId: bookingId ?? "",
        playerId: playerId ?? "",
        pitchShare: perPlayer,
        unitrFee: unitrFee,
      },
      description: `Unitr match booking — £${(perPlayer / 100).toFixed(2)} pitch + £${(unitrFee / 100).toFixed(2)} platform fee`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Stripe error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
