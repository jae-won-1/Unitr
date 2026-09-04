import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getCaller, isTeamMember, callerCustomerId, forbidden, unauthorized } from "@/lib/api-auth";

// Open a card payment that tops up a team's credit. The webhook credits the
// team off this intent's metadata, so the metadata is written from the caller's
// session — a teamId in the body would otherwise let anyone attach a payment to
// a team they have nothing to do with, and a playerId in the body would let
// them file the top-up under someone else's name.
export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req);
    if (!caller) return unauthorized();

    const { amountPence, teamId } = await req.json();

    if (!amountPence || amountPence < 100) {
      return NextResponse.json({ error: "Minimum top-up is £1.00" }, { status: 400 });
    }
    if (!teamId) {
      return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
    }
    if (!(await isTeamMember(caller.id, teamId))) {
      return forbidden("You're not in that team.");
    }

    const playerId = caller.id;
    const customerId = await callerCustomerId(caller.id);
    const email = caller.email;

    // Attach to a Stripe customer and mark the card for future off-session
    // reuse, so we can offer to save it once the payment succeeds. Reuse the
    // caller's existing customer where they have one, rather than minting a
    // second customer for the same player.
    let customer = customerId as string | undefined;
    if (!customer) {
      const created = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { app: "unitr" },
      });
      customer = created.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountPence,
      currency: "gbp",
      customer,
      setup_future_usage: "off_session",
      // allow_redirects "never" keeps the Payment Element to methods that
      // finish in place (cards, wallets). Left on, Stripe offers whatever the
      // LIVE account has enabled — Klarna, iDEAL, Bancontact — and those
      // finish by sending the payer to the provider's own site. Every confirm
      // in this app is confirmPayment({ redirect: "if_required" }) with no
      // return_url, so a payer choosing one of those gets an error instead of
      // a payment. Test mode hides this: fewer methods are enabled there.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      // The webhook credits the team off this metadata — it is the only link
      // between the charge and the ledger, so teamId has to be here.
      metadata: { teamId, playerId, type: "team_credits" },
      description: `Unitr team credits — £${(amountPence / 100).toFixed(2)}`,
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, customerId: customer });
  } catch (err) {
    console.error("Stripe error:", err);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 500 });
  }
}
