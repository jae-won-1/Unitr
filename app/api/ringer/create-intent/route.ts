import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCaller, unauthorized } from "@/lib/api-auth";

// Card payment for a ringer spot. The price is a flat fee paid to Unitr and
// is read from the request row server-side — never from the client — so the
// amount can't be tampered with. Availability is re-checked here so a player
// isn't asked for card details for a spot that has just gone.
export async function POST(req: NextRequest) {
  try {
    // The ringer paying is the caller — a playerId in the body would let
    // someone open a spot in another player's name and, worse, reuse their
    // saved Stripe customer.
    const caller = await getCaller(req);
    if (!caller) return unauthorized();
    const playerId = caller.id;
    const email = caller.email;

    const { requestId } = await req.json();
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
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

    // Attach to a Stripe customer and mark the card for future off-session
    // reuse, so the player can be offered "save this card" afterwards. The
    // existing customer is read from the profile here rather than taken from
    // the request body — the client already can't be trusted with the amount.
    const { data: profile } = await adminSupabase
      .from("profiles").select("stripe_customer_id").eq("id", playerId).maybeSingle();
    let customer = (profile?.stripe_customer_id as string | null) ?? undefined;
    if (!customer) {
      const created = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { app: "unitr" },
      });
      customer = created.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "gbp",
      customer,
      setup_future_usage: "off_session",
      receipt_email: email ?? undefined,
      // allow_redirects "never" keeps the Payment Element to methods that
      // finish in place (cards, wallets). Left on, Stripe offers whatever the
      // LIVE account has enabled — Klarna, iDEAL, Bancontact — and those
      // finish by sending the payer to the provider's own site. Every confirm
      // in this app is confirmPayment({ redirect: "if_required" }) with no
      // return_url, so a payer choosing one of those gets an error instead of
      // a payment. Test mode hides this: fewer methods are enabled there.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        type: "ringer_fee",
        requestId,
        playerId,
        matchId: request.match_id,
        teamId: request.team_id,
      },
      description: `Unitr ringer spot — £${(amount / 100).toFixed(2)}`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, amountPence: amount, customerId: customer });
  } catch (err) {
    console.error("Ringer intent error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
