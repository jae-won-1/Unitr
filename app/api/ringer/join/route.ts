import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";

// Confirms a ringer into a match after their £5 card payment succeeded.
//
// The client confirms the PaymentIntent and then calls this route, so the
// money has ALREADY moved by the time we get here — every failure path below
// either completes the join or reports loudly enough that it can be fixed.
// The PaymentIntent is re-read from Stripe (not trusted from the body) and
// must be succeeded, for this request, and unused by an earlier signup.
export async function POST(req: NextRequest) {
  try {
    const { requestId, playerId, paymentIntentId, position } = await req.json();
    if (!requestId || !playerId || !paymentIntentId) {
      return NextResponse.json({ error: "Missing requestId, playerId or paymentIntentId" }, { status: 400 });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded") {
      return NextResponse.json({ error: "Payment hasn't completed." }, { status: 402 });
    }
    if (intent.metadata?.requestId !== requestId || intent.metadata?.playerId !== playerId) {
      return NextResponse.json({ error: "Payment doesn't match this ringer spot." }, { status: 400 });
    }

    const { data: request } = await adminSupabase
      .from("ringer_requests")
      .select("id, match_id, team_id, spots, price_pence, status")
      .eq("id", requestId)
      .maybeSingle();
    if (!request) return NextResponse.json({ error: "Ringer request not found" }, { status: 404 });

    // Already recorded (double-submit, or the client retried after a network
    // blip) — report success rather than charging the player's patience.
    const { data: signups } = await adminSupabase
      .from("ringer_signups")
      .select("id, player_id, stripe_payment_intent_id")
      .eq("request_id", requestId);
    const mine = (signups ?? []).find((s) => s.player_id === playerId);
    if (mine) return NextResponse.json({ ok: true, alreadyJoined: true });
    if ((signups ?? []).some((s) => s.stripe_payment_intent_id === paymentIntentId)) {
      return NextResponse.json({ ok: true, alreadyJoined: true });
    }

    const { error: signupErr } = await adminSupabase.from("ringer_signups").insert({
      request_id: requestId,
      match_id: request.match_id,
      team_id: request.team_id,
      player_id: playerId,
      position: position ?? null,
      amount_pence: intent.amount,
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
    });
    if (signupErr) {
      console.error("ringer/join: signup insert failed", paymentIntentId, signupErr.message);
      return NextResponse.json(
        { error: "Payment went through but we couldn't add you to the squad. Contact the team." },
        { status: 500 }
      );
    }

    // Put the ringer in the matchday squad. is_ringer keeps them out of the
    // captain's settlement — they've already paid Unitr directly.
    const { error: confErr } = await adminSupabase.from("match_confirmations").upsert({
      match_id: request.match_id,
      player_id: playerId,
      team_id: request.team_id,
      status: "confirmed",
      is_ringer: true,
    }, { onConflict: "match_id,player_id" });
    if (confErr) {
      console.error("ringer/join: squad insert failed", paymentIntentId, confErr.message);
      return NextResponse.json({
        ok: true,
        squadWarning: "You're paid up, but the squad list didn't update — run supabase_ringers.sql.",
      });
    }

    // Last spot gone: close the listing so it drops out of the Fill In feed.
    if ((signups ?? []).length + 1 >= request.spots) {
      await adminSupabase.from("ringer_requests").update({ status: "filled" }).eq("id", requestId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ringer/join error:", err);
    return NextResponse.json({ error: "Could not confirm your spot" }, { status: 500 });
  }
}
