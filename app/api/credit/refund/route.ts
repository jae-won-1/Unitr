import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, isAdmin, forbidden, unauthorized } from "@/lib/api-auth";
import {
  allocateEqually, loadContributors, loadRefundableIntents,
  type Contributor,
} from "@/lib/team-refunds";

// A GET that authenticates its caller reads the request headers, which rules
// out static rendering. Say so up front rather than letting the build discover
// it by throwing inside the handler's try/catch.
export const dynamic = "force-dynamic";

// Cash out leftover team credit to the cards that paid it in.
//
// A team that plays one event and doesn't come back is left holding the
// difference between what its players put in and what the entry cost. This
// hands that back: an equal amount per contributor, capped at what each of
// them actually paid, refunded against their original charges.
//
// GET  — a preview. Who gets what, and what can't be returned to a card.
// POST — does it. Refunds at Stripe first, then debits the team's credit with
//        the refund id. If that second step fails, the charge.refunded webhook
//        applies the same debit keyed on the same refund id, so the ledger
//        catches up on its own rather than drifting.

async function mayRefund(callerId: string, teamId: string): Promise<boolean> {
  return (await isTeamLeader(callerId, teamId)) || (await isAdmin(callerId));
}

// Balance, and what of it is actually spare — reserved credit is earmarked
// against a live post, promised to a pitch and not the team's to hand back.
async function readCredit(teamId: string): Promise<{ balancePence: number; availablePence: number }> {
  const { data } = await adminSupabase
    .from("team_credits").select("balance_pence, reserved_pence").eq("team_id", teamId).maybeSingle();
  if (!data) return { balancePence: 0, availablePence: 0 };
  const balancePence = data.balance_pence ?? 0;
  return { balancePence, availablePence: Math.max(0, balancePence - (data.reserved_pence ?? 0)) };
}

function summarise(contributors: Contributor[], availablePence: number, requestedPence: number) {
  const { allocations, unallocatedPence } = allocateEqually(requestedPence, contributors);
  const byPlayer = new Map(allocations.map((a) => [a.playerId, a.amountPence]));
  return {
    availablePence,
    requestedPence,
    // What will actually reach a card. The rest — cash top-ups, or players
    // already refunded in full — stays in the balance.
    refundablePence: requestedPence - unallocatedPence,
    unallocatedPence,
    recipients: contributors.map((c) => ({
      playerId: c.playerId,
      name: c.name,
      contributedPence: c.contributedPence,
      refundedPence: c.refundedPence,
      amountPence: byPlayer.get(c.playerId) ?? 0,
      // Flagged so the captain can see WHY someone is getting less than an
      // equal share, rather than assuming the split is broken.
      cappedByContribution: (byPlayer.get(c.playerId) ?? 0) >= c.refundablePence && c.refundablePence > 0,
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const teamId = req.nextUrl.searchParams.get("teamId");
    if (!teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
    if (!(await mayRefund(callerId, teamId))) {
      return forbidden("Only the captain can refund team credit.");
    }

    const { availablePence: available } = await readCredit(teamId);
    const contributors = await loadContributors(adminSupabase, teamId);
    const asked = Number(req.nextUrl.searchParams.get("amountPence") ?? available);
    const requested = Math.min(available, Math.max(0, Math.round(asked)));

    return NextResponse.json(summarise(contributors, available, requested));
  } catch (err) {
    console.error("credit/refund preview error:", err);
    return NextResponse.json({ error: "Could not work out the refund" }, { status: 500 });
  }
}

type RefundResult = {
  playerId: string;
  name: string;
  amountPence: number;
  refundedPence: number;
  ok: boolean;
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { teamId, amountPence, requestId } = await req.json();
    if (!teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
    if (!(await mayRefund(callerId, teamId))) {
      return forbidden("Only the captain can refund team credit.");
    }
    // The client sends one id per confirmed cash-out and reuses it on retry,
    // so a double-submit or a dropped response can't refund twice.
    if (!requestId || typeof requestId !== "string") {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const { availablePence: available } = await readCredit(teamId);
    if (available <= 0) {
      return NextResponse.json({ error: "There's no credit to refund." }, { status: 409 });
    }
    const requested = amountPence ? Math.min(available, Math.round(amountPence)) : available;
    if (requested < 1) {
      return NextResponse.json({ error: "Refund amount must be at least 1p." }, { status: 400 });
    }

    const contributors = await loadContributors(adminSupabase, teamId);
    if (contributors.length === 0) {
      return NextResponse.json(
        { error: "No card payments to refund — this team's credit was all recorded as cash." },
        { status: 409 },
      );
    }

    const { allocations } = allocateEqually(requested, contributors);
    const names = new Map(contributors.map((c) => [c.playerId, c.name]));

    const results: RefundResult[] = [];
    let refundedTotal = 0;
    let slice = 0;

    for (const a of allocations) {
      const intents = await loadRefundableIntents(adminSupabase, teamId, a.playerId);
      let outstanding = a.amountPence;
      let refundedForPlayer = 0;
      let failure: string | undefined;

      // One player's share can span several charges — a £30 refund against
      // three £10 top-ups is three Stripe refunds.
      for (const intent of intents) {
        if (outstanding <= 0) break;
        const amount = Math.min(outstanding, intent.refundablePence);
        if (amount <= 0) continue;

        try {
          const refund = await stripe.refunds.create(
            {
              payment_intent: intent.paymentIntentId,
              amount,
              metadata: { type: "team_credit_cashout", teamId, playerId: a.playerId, requestedBy: callerId },
            },
            { idempotencyKey: `unitr_cashout_${requestId}_${slice}` },
          );
          slice += 1;

          // Debit the credit that this refund just took back out. Keyed on the
          // Stripe refund id, which is also what the webhook will use — so
          // whichever gets there first wins and the other is a no-op.
          const { error } = await adminSupabase.rpc("refund_credit", {
            p_team_id: teamId,
            p_amount_pence: amount,
            p_player_id: a.playerId,
            p_stripe_refund_id: refund.id,
            p_payment_intent_id: intent.paymentIntentId,
            p_allow_negative: false,
          });
          if (error) {
            // The money is already on its way back to the card. Log it rather
            // than reporting a clean failure — and the webhook will still
            // apply the debit when charge.refunded lands.
            console.error(`credit/refund: debit failed for ${refund.id}:`, error.message);
          }

          outstanding -= amount;
          refundedForPlayer += amount;
          refundedTotal += amount;
        } catch (err) {
          slice += 1;
          failure = (err as { message?: string }).message ?? "Refund failed";
          console.error(`credit/refund: Stripe refund failed for ${intent.paymentIntentId}:`, failure);
          break;
        }
      }

      results.push({
        playerId: a.playerId,
        name: names.get(a.playerId) ?? "Player",
        amountPence: a.amountPence,
        refundedPence: refundedForPlayer,
        ok: failure === undefined && refundedForPlayer === a.amountPence,
        error: failure,
      });
    }

    const after = await readCredit(teamId);
    return NextResponse.json({
      ok: results.every((r) => r.ok),
      refundedPence: refundedTotal,
      availablePence: after.availablePence,
      balancePence: after.balancePence,
      results,
    });
  } catch (err) {
    console.error("credit/refund error:", err);
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
}
