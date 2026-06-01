import { NextRequest, NextResponse } from "next/server";
import { stripe, calcSplit } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { pitchPricePerHour, playerCount, bookingId, playerId } = await req.json();

    if (!pitchPricePerHour || !playerCount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { totalPerPlayer, perPlayer, unitrFee } = calcSplit(pitchPricePerHour, playerCount);

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
