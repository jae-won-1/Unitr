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
// Cancelling the event puts the buy-ins back the same way — /api/events/take-down
// writes a positive `buyin_refund` row against the same listing — so both types
// are read here and netted. A team refunded in full stops counting as a paying
// team; nothing about the cancelled event is left claiming to have taken money.
//
// `booking_capture` is also used for ordinary pitch captures, but those rows
// carry a booking_id/match_id and no open_match_id, so they can't leak in.

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

  // Per team first, so a refund cancels out the capture it reverses rather
  // than just shrinking a total while the team still counts as having paid.
  const netByEvent = new Map<string, Map<string, number>>();
  for (const c of ledger ?? []) {
    if (c.type !== "booking_capture" && c.type !== "buyin_refund") continue;
    const perTeam = netByEvent.get(c.open_match_id) ?? new Map<string, number>();
    // Captures are negative on the team's ledger, refunds positive: negating
    // leaves what the team is actually out of pocket for this event.
    const key = c.team_id ?? "";
    perTeam.set(key, (perTeam.get(key) ?? 0) - (c.amount_pence ?? 0));
    netByEvent.set(c.open_match_id, perTeam);
  }

  const paidByEvent = new Map<string, { pence: number; teams: Set<string> }>();
  for (const [eventId, perTeam] of netByEvent) {
    const cur = { pence: 0, teams: new Set<string>() };
    for (const [teamId, pence] of perTeam) {
      if (pence <= 0) continue; // fully refunded — this team paid nothing in the end
      cur.pence += pence;
      if (teamId) cur.teams.add(teamId);
    }
    paidByEvent.set(eventId, cur);
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
