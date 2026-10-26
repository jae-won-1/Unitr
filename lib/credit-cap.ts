import { adminSupabase } from "@/lib/supabase-admin";

// The most team credit a team can hold. Credit is a prepayment for the team's
// pitches and events (docs/LAUNCH_PLAN.md), so a balance far beyond what a
// season costs is money Uniter is holding for no purpose — the shape that
// starts to look like a stored-value account. It also caps what a stolen card
// can push into one team.
//
// Checked only where a card is about to be charged INTO credit — before the
// money moves, never after. The webhook always credits what was actually
// paid, because refusing then would keep money and give nothing for it.
export const TEAM_CREDIT_CAP_PENCE = 100_000; // £1,000

/** Null if `addPence` fits under the cap; otherwise the sentence to refuse with. */
export async function creditCapRefusal(teamId: string, addPence: number): Promise<string | null> {
  const { data } = await adminSupabase
    .from("team_credits").select("balance_pence").eq("team_id", teamId).maybeSingle();
  const balance = (data?.balance_pence as number | undefined) ?? 0;
  if (balance + addPence <= TEAM_CREDIT_CAP_PENCE) return null;
  const room = Math.max(0, TEAM_CREDIT_CAP_PENCE - balance);
  return room === 0
    ? `Your team already holds the most credit a team can (£${TEAM_CREDIT_CAP_PENCE / 100}). Spend some before adding more.`
    : `A team can hold at most £${TEAM_CREDIT_CAP_PENCE / 100} of credit — you can add up to £${(room / 100).toFixed(2)} right now.`;
}
