import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, forbidden, unauthorized } from "@/lib/api-auth";

// Turn a paid player_payments row into team credit.
//
// This used to be a straight supabase.rpc("apply_replenishment") from
// app/pay/[matchId]. Two open doors made that free money: player_payments
// takes any insert from the browser ("System can insert payments" is
// `with check (true)`), and apply_replenishment is `security definer` with no
// caller check, granted to PUBLIC like every function is on creation. Insert a
// row with purpose='replenish', any team_id and any amount, call the RPC, and
// the credit appeared with nothing behind it.
//
// So the RPC is now service_role only (supabase_pilot_security.sql §2) and the
// question "was this actually paid?" is answered the way the webhook answers
// it — by asking Stripe. The payer sees no difference: the pay screen still
// confirms the card and then reports success.
//
// Four things are checked, and all four have to hold:
//   1. the row belongs to the caller, identified from their session token;
//   2. Stripe says its PaymentIntent succeeded;
//   3. the PaymentIntent is the caller's own and covers what the row claims;
//   4. no other row has already been credited against that same payment.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { paymentId } = (await req.json()) as { paymentId?: string };
    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });
    }

    const { data: row } = await adminSupabase
      .from("player_payments")
      .select("id, player_id, team_id, purpose, applied, amount_pence, total_pence, stripe_payment_intent_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (!row) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    // 1) Yours, and of the kind that credits a team.
    if (row.player_id !== callerId) {
      return forbidden("That payment isn't yours.");
    }
    if (row.purpose !== "replenish") {
      return NextResponse.json({ error: "Not a replenishment payment" }, { status: 400 });
    }
    // Already credited. The RPC is idempotent on this flag, but saying so here
    // keeps a double-tap on the pay screen from looking like a failure.
    if (row.applied) {
      return NextResponse.json({ ok: true, alreadyApplied: true });
    }

    const intentId = row.stripe_payment_intent_id as string | null;
    if (!intentId) {
      return NextResponse.json({ error: "No payment recorded against this row" }, { status: 409 });
    }

    // 2) Stripe's word, not the client's.
    const pi = await stripe.paymentIntents.retrieve(intentId);
    if (pi.status !== "succeeded") {
      return NextResponse.json(
        { error: `Payment has not completed (${pi.status})` },
        { status: 409 },
      );
    }

    // 3) The payment is the caller's, and it is big enough to cover what the
    //    row says was charged. total_pence is the pitch share plus the Uniter
    //    fee — the whole amount the card was asked for; amount_pence alone is
    //    what gets credited. Checking the larger of the two is what stops a
    //    hand-written row inflating a small real payment into a large credit.
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", callerId)
      .maybeSingle();
    const customerId = (profile?.stripe_customer_id as string | null) ?? null;
    const intentCustomer = typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null;
    const metaPlayer = (pi.metadata?.playerId as string | undefined) ?? null;

    const isCallersPayment =
      (metaPlayer !== null && metaPlayer === callerId) ||
      (intentCustomer !== null && customerId !== null && intentCustomer === customerId);
    if (!isCallersPayment) {
      return forbidden("That payment was made by someone else.");
    }

    const expected = Math.max(
      Math.round(row.total_pence ?? 0),
      Math.round(row.amount_pence ?? 0),
    );
    const paid = pi.amount_received || pi.amount || 0;
    if (expected > 0 && paid < expected) {
      return NextResponse.json(
        { error: "The payment does not cover this charge" },
        { status: 409 },
      );
    }

    // 4) One credit per payment. The row's `applied` flag stops the SAME row
    //    being credited twice; this stops one real payment being spread across
    //    several rows, which is what a client that can insert its own rows
    //    would otherwise do.
    const { data: siblings } = await adminSupabase
      .from("player_payments")
      .select("id")
      .eq("stripe_payment_intent_id", intentId)
      .eq("applied", true)
      .neq("id", paymentId)
      .limit(1);
    if (siblings && siblings.length > 0) {
      return NextResponse.json(
        { error: "That payment has already been credited" },
        { status: 409 },
      );
    }

    const { error: rpcErr } = await adminSupabase.rpc("apply_replenishment", {
      p_payment_id: paymentId,
    });
    if (rpcErr) {
      // The player HAS been charged — this is bookkeeping that failed, not a
      // payment that failed. Log loudly; the captain can still settle by hand.
      console.error(`apply-replenishment: RPC failed for ${paymentId}:`, rpcErr.message);
      return NextResponse.json({ error: "Could not apply the credit" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("apply-replenishment error:", err);
    return NextResponse.json({ error: "Could not apply the credit" }, { status: 500 });
  }
}
