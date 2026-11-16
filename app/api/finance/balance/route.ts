import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { financeOff, trackedBalancePence, UUID } from "@/lib/team-finance-server";

export const dynamic = "force-dynamic";

// Set the tracked balance to a figure the leader reads off the bank.
//
// Uniter can't see the team's bank account, so the balance on the dashboard is
// only what it has watched move: paid requests in, team-card spend out. Cash
// spent on kit, a payment made by bank transfer, money that was there before
// the team joined — none of that is visible. This writes the difference as an
// adjustment, so the figure matches the bank and carries on tracking from
// there. Bookkeeping only: no money moves.
const LIMIT_PENCE = 10_000_000;   // £100,000 either way — a typo guard

export async function POST(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  const callerId = await getCallerId(req);
  if (!callerId) return unauthorized();

  const { teamId, balancePence } = await req.json().catch(() => ({}));
  if (!UUID.test(teamId ?? "")) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  if (!Number.isInteger(balancePence) || Math.abs(balancePence) > LIMIT_PENCE) {
    return NextResponse.json({ error: "Enter the balance as an amount in pounds." }, { status: 400 });
  }
  if (!(await isTeamLeader(callerId, teamId))) {
    return forbidden("Only the captain or a co-captain can set the balance.");
  }

  const current = await trackedBalancePence(teamId);
  const difference = balancePence - current;
  if (difference !== 0) {
    const { error } = await adminSupabase.from("team_finance_entries").insert({
      team_id: teamId,
      kind: "adjustment",
      amount_pence: difference,
      note: "Balance set to match the bank",
      created_by: callerId,
    });
    if (error) {
      console.error("finance/balance:", error.message);
      return NextResponse.json({ error: "Couldn't save the balance." }, { status: 500 });
    }
  }
  return NextResponse.json({ balancePence });
}
