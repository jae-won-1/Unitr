import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

// TEST MODE ONLY — add funds to Unitr's platform balance so venue transfers
// have something to draw from. Uses Stripe's `bypassPending` test card, whose
// charges settle straight into AVAILABLE balance (normal test charges sit in
// pending for days and can't back a transfer). Refuses to run on a live key.
export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    return NextResponse.json({ error: "Test-mode only" }, { status: 403 });
  }
  try {
    const { amountPence } = await req.json().catch(() => ({ amountPence: 0 }));
    const amount = Math.round(amountPence || 20000); // default £200

    const pi = await stripe.paymentIntents.create({
      amount,
      currency: "gbp",
      payment_method: "pm_card_bypassPending",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Unitr test-mode platform balance top-up",
      metadata: { type: "dev_fund_test_balance" },
    });
    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: `Funding charge status: ${pi.status}` }, { status: 502 });
    }

    const balance = await stripe.balance.retrieve();
    const gbp = balance.available.find((b) => b.currency === "gbp");
    return NextResponse.json({
      fundedPence: amount,
      availablePence: gbp?.amount ?? 0,
    });
  } catch (err) {
    console.error("fund-test-balance error:", err);
    return NextResponse.json({ error: "Could not fund test balance" }, { status: 500 });
  }
}

// Report the current platform balance (test-mode only) — used by the admin
// finance page to show what's actually available for venue transfers.
export async function GET() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    return NextResponse.json({ error: "Test-mode only" }, { status: 403 });
  }
  try {
    const balance = await stripe.balance.retrieve();
    const gbp = balance.available.find((b) => b.currency === "gbp");
    const gbpPending = balance.pending.find((b) => b.currency === "gbp");
    return NextResponse.json({
      availablePence: gbp?.amount ?? 0,
      pendingPence: gbpPending?.amount ?? 0,
    });
  } catch (err) {
    console.error("fund-test-balance GET error:", err);
    return NextResponse.json({ error: "Could not read balance" }, { status: 500 });
  }
}
