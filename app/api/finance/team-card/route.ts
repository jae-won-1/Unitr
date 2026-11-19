import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCaller, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { paymentRateLimit } from "@/lib/rate-limit";
import { financeOff, STRIPE_LIVEMODE, UUID } from "@/lib/team-finance-server";
import {
  describeTeamCard, ensureTeamCustomer, loadTeamCard, TeamCardTableMissing,
} from "@/lib/team-card-server";

export const dynamic = "force-dynamic";

// The team card: a card a leader saves for the team, which pays for its event
// entries. Any captain or co-captain may add, replace or remove it — it is the
// team's, on the team's own Stripe customer, not the leader's.
//
//   setup   open a SetupIntent on the team's customer; the app collects the card
//   save    after the app confirmed it: check with Stripe and record the card
//   remove  take the card off the team
//
// Nothing about the card comes from the body except which SetupIntent to look
// at, and that is only accepted if Stripe says it belongs to this team's
// customer.

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  try {
    const caller = await getCaller(req);
    if (!caller) return unauthorized();

    const { teamId, action, setupIntentId } = await req.json().catch(() => ({}));
    if (!UUID.test(teamId ?? "")) return bad("Missing teamId");
    if (!(await isTeamLeader(caller.id, teamId))) {
      return forbidden("Only the captain or a co-captain can manage the team card.");
    }

    if (action === "setup") {
      const limited = await paymentRateLimit(caller.id);
      if (limited) return limited;
      const customer = await ensureTeamCustomer(teamId);
      const setupIntent = await stripe.setupIntents.create({
        customer,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { type: "team_card", teamId, savedBy: caller.id },
      });
      return NextResponse.json({ clientSecret: setupIntent.client_secret });
    }

    const row = await loadTeamCard(teamId);

    if (action === "save") {
      if (typeof setupIntentId !== "string" || !setupIntentId.startsWith("seti_")) return bad("Missing setupIntentId");
      if (!row) return bad("Start adding the card again.", 409);
      const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
      const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
      if (customerId !== row.stripe_customer_id || si.metadata?.teamId !== teamId) {
        return forbidden("That card isn't being saved for this team.");
      }
      if (si.status !== "succeeded") return bad("The card hasn't been confirmed yet.", 409);
      const pm = si.payment_method;
      if (!pm || typeof pm === "string" || !pm.card) return bad("Couldn't read that card.", 409);

      const previous = row.stripe_payment_method_id;
      const { error } = await adminSupabase.from("team_cards").update({
        stripe_payment_method_id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
        funding: pm.card.funding,
        saved_by: caller.id,
        updated_at: new Date().toISOString(),
      }).eq("team_id", teamId).eq("livemode", STRIPE_LIVEMODE);
      if (error) throw new Error(`team card save failed: ${error.message}`);

      // A replaced card is taken off the team's customer, so only one card can
      // ever be charged for the team. Best effort — the new one is saved.
      if (previous && previous !== pm.id) {
        await stripe.paymentMethods.detach(previous).catch((e) =>
          console.error("team-card: detach of the old card failed:", (e as Error).message));
      }
      return NextResponse.json({ card: await describeTeamCard(await loadTeamCard(teamId), caller.id) });
    }

    if (action === "remove") {
      if (row?.stripe_payment_method_id) {
        await stripe.paymentMethods.detach(row.stripe_payment_method_id).catch((e) =>
          console.error("team-card: detach failed:", (e as Error).message));
        const { error } = await adminSupabase.from("team_cards").update({
          stripe_payment_method_id: null, brand: null, last4: null, exp_month: null, exp_year: null,
          funding: null, saved_by: null, updated_at: new Date().toISOString(),
        }).eq("team_id", teamId).eq("livemode", STRIPE_LIVEMODE);
        if (error) throw new Error(`team card remove failed: ${error.message}`);
      }
      return NextResponse.json({ card: null });
    }

    return bad("Unknown action.");
  } catch (err) {
    if (err instanceof TeamCardTableMissing) {
      return bad("The team card isn't set up on this database yet — run supabase_team_card.sql.", 503);
    }
    console.error("finance/team-card error:", err);
    return bad("Couldn't reach Stripe. Try again in a moment.", 500);
  }
}
