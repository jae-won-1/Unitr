import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

// Real cash as STRIPE sees it, for /admin/finance.
//
// The finance page used to total "real money in" from player_payments rows,
// which silently excluded every credit top-up — top-ups write a 'deposit'
// credit-ledger row and no player_payments row at all. That understated the
// cash Unitr actually holds by the entire top-up volume.
//
// This route is the cash side of the ledger, read straight from Stripe rather
// than inferred from our own tables, so the page can show what genuinely
// settled and flag anywhere the two disagree.
//
// Buckets are keyed off the metadata.type each intent is created with:
//   team_credits          create-credits-intent   — team credit top-up
//   match_settlement      settle-match            — off-session replenishment
//   ringer_fee            ringer/create-intent    — flat £5 guest fee
//   dev_fund_test_balance dev/fund-test-balance   — test plumbing, NOT revenue
// create-payment-intent predates the convention and sets no type; it lands in
// `untyped` rather than being silently dropped.

export const dynamic = "force-dynamic";

// Prototype volumes are tiny; cap the walk so a runaway account can't hang the
// page, and tell the client when the numbers are therefore partial.
const MAX_INTENTS = 1000;

type TopUp = { id: string; amountPence: number; teamId: string | null; created: number };

export async function GET() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }
  try {
    const byType: Record<string, { pence: number; count: number }> = {};
    const topUps: TopUp[] = [];
    let scanned = 0;
    let truncated = false;

    for await (const pi of stripe.paymentIntents.list({ limit: 100 })) {
      if (scanned >= MAX_INTENTS) { truncated = true; break; }
      scanned += 1;
      // Only settled money counts. Anything requires_payment_method / canceled
      // is an abandoned attempt and must not appear as cash held.
      if (pi.status !== "succeeded") continue;

      const type = (pi.metadata?.type as string) || "untyped";
      // amount_received is what actually settled; amount is only what was asked for.
      const pence = pi.amount_received ?? pi.amount ?? 0;
      byType[type] = byType[type] ?? { pence: 0, count: 0 };
      byType[type].pence += pence;
      byType[type].count += 1;

      if (type === "team_credits") {
        topUps.push({
          id: pi.id,
          amountPence: pence,
          teamId: (pi.metadata?.teamId as string) || null,
          created: pi.created,
        });
      }
    }

    return NextResponse.json({
      byType,
      topUps,
      topUpPence: byType.team_credits?.pence ?? 0,
      topUpCount: byType.team_credits?.count ?? 0,
      scanned,
      truncated,
      testMode: process.env.STRIPE_SECRET_KEY.startsWith("sk_test_"),
    });
  } catch (err) {
    console.error("admin/stripe-cash error:", err);
    return NextResponse.json({ error: "Could not read Stripe activity" }, { status: 500 });
  }
}
