import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";

// Card payment for a ringer spot. The price is a flat fee paid to Unitr and
// is read from the request row server-side — never from the client — so the
// amount can't be tampered with. Availability is re-checked here so a player
// isn't asked for card details for a spot that has just gone.
export async function POST(req: NextRequest) {
  try {
    const { requestId, playerId, email } = await req.json();
    if (!requestId || !playerId) {
      return NextResponse.json({ error: "Missing requestId or playerId" }, { status: 400 });
    }

    const { data: request } = await adminSupabase
      .from("ringer_requests")
      .select("id, match_id, team_id, spots, price_pence, status")
      .eq("id", requestId)
      .maybeSingle();
    if (!request) return NextResponse.json({ error: "Ringer request not found" }, { status: 404 });
    if (request.status !== "open") {
      return NextResponse.json({ error: "This ringer spot is no longer available." }, { status: 409 });
    }

    const { data: signups } = await adminSupabase
      .from("ringer_signups")
      .select("player_id")
      .eq("request_id", requestId);
    if ((signups ?? []).some((s) => s.player_id === playerId)) {
      return NextResponse.json({ error: "You've already joined this match." }, { status: 409 });
    }
    if ((signups ?? []).length >= request.spots) {
      return NextResponse.json({ error: "This ringer spot has just been filled." }, { status: 409 });
    }

    const amount = Math.round(request.price_pence ?? 500);
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "gbp",
      receipt_email: email ?? undefined,
      automatic_payment_methods: { enabled: true },
      metadata: {
        type: "ringer_fee",
        requestId,
        playerId,
        matchId: request.match_id,
        teamId: request.team_id,
      },
      description: `Unitr ringer spot — £${(amount / 100).toFixed(2)}`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, amountPence: amount });
  } catch (err) {
    console.error("Ringer intent error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
