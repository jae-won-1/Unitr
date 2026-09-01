import { supabase } from "@/lib/supabase";

// ── What an event listing actually took ───────────────────────────────────
// A tournament / league / hosted friendly (an `open_matches` row) is paid for
// one team at a time: /api/tournaments/join debits the buy-in from the joining
// team's credit and writes a single `booking_capture` row against the listing.
// That ledger row — not the list price — is the truth, because an invitation
// can carry a per-team discount which is applied server-side at join and is
// never written back to the listing.
//
// Where the money goes AFTER the debit depends on who hosts (venue transfer /
// organiser-team reimbursement / kept by the platform when Unitr staff host),
// but what came IN is this same sum in all three cases.
//
// Two known limits, both deliberate:
//   - No refund path writes `open_match_id`, so a refunded entry is not netted
//     off here. Cancellations are rare enough in the prototype to leave loud.
//   - `booking_capture` is also used for ordinary pitch captures; those rows
//     carry a booking_id/match_id and no open_match_id, so they can't leak in.

export type EventRef = { id: string; price_per_team_pence: number | null; max_teams: number | null };

export type EventRevenue = {
  /** Buy-ins actually debited against this listing. */
  collectedPence: number;
  /** Distinct teams with a recorded buy-in. */
  payingTeams: number;
  /** Teams entered (open_match_teams) — may exceed payingTeams for free entries. */
  entries: number;
  /** List price × paying teams − collected: what invitation discounts gave away. */
  discountsPence: number;
  /** List price × max teams — the ceiling if every spot sells at full price. */
  potentialPence: number;
  /** True when the ledger couldn't be read and collected is entries × list price. */
  estimated: boolean;
};

// Batched: one round of queries for a whole list of events, not one per row.
export async function loadEventRevenue(events: EventRef[]): Promise<Map<string, EventRevenue>> {
  const out = new Map<string, EventRevenue>();
  if (events.length === 0) return out;
  const ids = events.map((e) => e.id);

  const [entries, ledger] = await Promise.all([
    supabase.from("open_match_teams").select("open_match_id, team_id").in("open_match_id", ids)
      .then((r) => (r.error ? [] : (r.data ?? []) as { open_match_id: string; team_id: string }[])),
    // 42703 here means open_match_id isn't on the ledger yet — the whole query
    // fails, so fall back to counting entries at list price below.
    supabase.from("team_credit_transactions").select("open_match_id, team_id, amount_pence, type").in("open_match_id", ids)
      .then((r) => (r.error ? null : (r.data ?? []) as { open_match_id: string; team_id: string | null; amount_pence: number; type: string }[])),
  ]);

  const entriesByEvent = new Map<string, number>();
  for (const e of entries) entriesByEvent.set(e.open_match_id, (entriesByEvent.get(e.open_match_id) ?? 0) + 1);

  const paidByEvent = new Map<string, { pence: number; teams: Set<string> }>();
  for (const c of ledger ?? []) {
    if (c.type !== "booking_capture") continue;
    const cur = paidByEvent.get(c.open_match_id) ?? { pence: 0, teams: new Set<string>() };
    cur.pence += Math.abs(c.amount_pence ?? 0);
    if (c.team_id) cur.teams.add(c.team_id);
    paidByEvent.set(c.open_match_id, cur);
  }

  for (const ev of events) {
    const price = ev.price_per_team_pence ?? 0;
    const entered = entriesByEvent.get(ev.id) ?? 0;
    const paid = paidByEvent.get(ev.id);
    const estimated = ledger === null;
    const collectedPence = estimated ? entered * price : paid?.pence ?? 0;
    const payingTeams = estimated ? entered : paid?.teams.size ?? 0;
    out.set(ev.id, {
      collectedPence,
      payingTeams,
      entries: entered,
      discountsPence: estimated ? 0 : Math.max(0, payingTeams * price - collectedPence),
      potentialPence: price * (ev.max_teams ?? 0),
      estimated,
    });
  }
  return out;
}

export function fmtPence(pence: number) {
  return `£${(pence / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
