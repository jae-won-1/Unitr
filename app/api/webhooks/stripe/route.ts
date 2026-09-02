import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";

// Stripe webhook — the ONLY place a card payment turns into team credit.
//
// The browser used to do this: confirmPayment() resolved, then the client
// called add_credit(). Nothing tied the two together, so credit could be
// minted without paying, and a payment whose tab closed mid-flow charged the
// player and credited nobody. Stripe tells us here instead, and keeps
// retrying until we acknowledge, so the credit survives a closed tab.
//
// Idempotency lives in credit_from_payment(), keyed on the PaymentIntent id
// — Stripe delivers at-least-once and will replay events.

export const runtime = "nodejs";        // needs the raw body and node crypto
export const dynamic = "force-dynamic"; // never cache a webhook

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  // credit_from_payment is granted to service_role only. Without the service
  // key adminSupabase silently falls back to the anon key and every credit
  // would fail permission-denied — fail loudly here instead.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.error("stripe-webhook: SUPABASE_SERVICE_ROLE_KEY is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  // Must be the raw, unparsed body — any reserialisation breaks the signature.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    // Unverified: could be anyone. Never act on it.
    console.error("stripe-webhook: signature verification failed:", (err as Error).message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.type !== "team_credits") break;   // other flows settle elsewhere

        const teamId = pi.metadata.teamId;
        if (!teamId) {
          // Nothing to credit and a retry can't fix it — ack so Stripe stops.
          console.error(`stripe-webhook: ${pi.id} has type=team_credits but no teamId`);
          break;
        }

        // amount_received is what actually landed; amount is what we asked for.
        const amountPence = pi.amount_received || pi.amount;
        const { data, error } = await adminSupabase.rpc("credit_from_payment", {
          p_team_id: teamId,
          p_amount_pence: amountPence,
          p_player_id: pi.metadata.playerId || null,
          p_payment_intent_id: pi.id,
        });

        if (error) {
          // The player HAS been charged. Return 5xx so Stripe redelivers
          // rather than losing the credit — the RPC is idempotent, so a
          // replay after a partial success is harmless.
          console.error(`stripe-webhook: credit failed for ${pi.id}:`, error.message);
          return NextResponse.json({ error: "Could not apply credit" }, { status: 500 });
        }
        console.log(`stripe-webhook: credited ${amountPence}p to team ${teamId} (${pi.id}), balance now ${data}p`);
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.warn(`stripe-webhook: payment failed ${pi.id}: ${pi.last_payment_error?.message ?? "unknown"}`);
        break;
      }

      default:
        break;  // unhandled types are acknowledged, not retried
    }
  } catch (err) {
    console.error("stripe-webhook: handler threw:", err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
