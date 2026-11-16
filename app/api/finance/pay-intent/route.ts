import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCaller, unauthorized } from "@/lib/api-auth";
import { paymentRateLimit } from "@/lib/rate-limit";
import { ensureStripeCustomer } from "@/lib/stripe-customer";
import { feeOnTop } from "@/lib/payment-fee";
import { financeOff, loadFinanceAccount, UUID } from "@/lib/team-finance-server";

export const dynamic = "force-dynamic";

// Open a card payment for the caller's own share of a payment request.
//
// The money goes to the TEAM'S linked Stripe account, not to Uniter: the
// charge names that account as its destination, so the share is transferred
// there as part of the charge and nothing rests in Uniter's balance. The fee
// is added on top and is all Uniter keeps (lib/payment-fee.ts).
//
// Nothing about the amount comes from the request body: the share is what the
// caller's own row still owes, and the destination is the team's account as
// the database holds it.
export async function POST(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  try {
    const caller = await getCaller(req);
    if (!caller) return unauthorized();
    const limited = await paymentRateLimit(caller.id);
    if (limited) return limited;

    const { requestId } = await req.json().catch(() => ({}));
    if (!UUID.test(requestId ?? "")) return NextResponse.json({ error: "Missing requestId" }, { status: 400 });

    const { data: request } = await adminSupabase.from("payment_requests")
      .select("id, team_id, title, cancelled_at").eq("id", requestId).maybeSingle();
    if (!request || request.cancelled_at) {
      return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
    }

    const { data: member } = await adminSupabase.from("payment_request_members")
      .select("id, amount_pence, paid_pence")
      .eq("request_id", requestId).eq("player_id", caller.id).maybeSingle();
    if (!member) return NextResponse.json({ error: "That request wasn't sent to you." }, { status: 403 });

    const sharePence = Math.max(0, (member.amount_pence as number) - (member.paid_pence as number));
    if (sharePence <= 0) return NextResponse.json({ error: "You've already paid this." }, { status: 409 });

    const teamId = request.team_id as string;
    const account = await loadFinanceAccount(teamId);
    if (!account) {
      return NextResponse.json(
        { error: "Your team hasn't linked a bank account yet, so it can't take card payments. Pay your captain directly." },
        { status: 409 },
      );
    }

    // Ask Stripe rather than trusting the cached flag: onboarding may have
    // finished since, or Stripe may have paused the account.
    const stripeAccount = await stripe.accounts.retrieve(account.stripe_account_id);
    const ready = stripeAccount.capabilities?.transfers === "active";
    if (ready !== account.transfers_active) {
      await adminSupabase.from("team_finance_accounts")
        .update({ transfers_active: ready, updated_at: new Date().toISOString() })
        .eq("team_id", teamId).eq("stripe_account_id", account.stripe_account_id);
    }
    if (!ready) {
      return NextResponse.json(
        { error: "Your team's bank account isn't fully set up yet, so it can't take card payments. Pay your captain directly." },
        { status: 409 },
      );
    }

    const feePence = feeOnTop(sharePence);
    const totalPence = sharePence + feePence;
    const customer = await ensureStripeCustomer(caller.id, caller.email);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalPence,
      currency: "gbp",
      customer,
      // Lets the payer tick "save this card" (useSaveCardTickbox); the card is
      // kept on their own Uniter customer, not on the team's account.
      setup_future_usage: "off_session",
      // Cards and wallets only — see the convention in CLAUDE.md.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      transfer_data: { destination: account.stripe_account_id },
      ...(feePence > 0 ? { application_fee_amount: feePence } : {}),
      // applyRequestPayment (lib/team-finance-server.ts) records the payment
      // off this metadata — the only link between the charge and the request.
      metadata: {
        type: "payment_request",
        memberId: member.id as string,
        requestId: request.id as string,
        teamId,
        playerId: caller.id,
        sharePence: String(sharePence),
        feePence: String(feePence),
      },
      description: `Uniter — ${request.title}`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, sharePence, feePence, totalPence });
  } catch (err) {
    console.error("finance/pay-intent error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
