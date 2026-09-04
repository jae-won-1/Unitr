import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getCallerId, isAdmin, forbidden, unauthorized } from "@/lib/api-auth";

// A GET that authenticates its caller reads the request headers, which rules
// out static rendering. Say so up front rather than letting the build discover
// it by throwing inside the handler's try/catch.
export const dynamic = "force-dynamic";

// Admin-only, on top of the test-key gate: the finance page that calls this is
// behind app/admin/layout.tsx, and that gate is client-side only.
async function requireAdmin(req: NextRequest) {
  const callerId = await getCallerId(req);
  if (!callerId) return unauthorized();
  if (!(await isAdmin(callerId))) return forbidden("Admins only.");
  return null;
}

// TEST MODE ONLY — add funds to Unitr's platform balance so venue transfers
// have something to draw from. Uses Stripe's `bypassPending` test card, whose
// charges settle straight into AVAILABLE balance (normal test charges sit in
// pending for days and can't back a transfer). Refuses to run on a live key.
export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    return NextResponse.json({ error: "Test-mode only" }, { status: 403 });
  }
  const denied = await requireAdmin(req);
  if (denied) return denied;
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
export async function GET(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    return NextResponse.json({ error: "Test-mode only" }, { status: 403 });
  }
  const denied = await requireAdmin(req);
  if (denied) return denied;
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
