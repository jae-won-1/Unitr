// Settle Payments' data: the tournaments a team entered, as fixtures it can
// issue payment requests for, and the date helpers issuing uses.
//
// Moved unchanged out of components/SettlePaymentsModal.tsx so the mobile app
// can issue a tournament's payment requests from the same reading of what the
// team actually paid — the credit debit written at entry, not the list price.
// The modal imports these back, so its behaviour doesn't change.

import { supabase } from "@/lib/supabase";
import { isUpcomingDate, toDateKey } from "@/lib/match-dates";

export type HistoryFixture = {
  key: string;                  // stable React key + settle-state key
  kind: "match" | "tournament";
  postId: string | null;        // matches only
  matchRowId: string | null;    // matches only
  openMatchId: string | null;   // tournaments only
  label: string;                // opponent name, or tournament title
  teamPoolPence: number;        // what THIS team owes in total
  settled: boolean;
  date: string;
  time: string;
  pitch: string;
  isUpcoming: boolean;
};

export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// Availability date_options store a human string like "Tue, 30 JUN 2026".
// Parse it to an ISO date so we can match a poll option to a match_date.
export function parseOptionDate(dateStr: string): string | null {
  const m = /(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/.exec((dateStr ?? "").toUpperCase());
  if (!m) return null;
  const [, day, mon, year] = m;
  const mm = MONTHS[mon];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

// ── Tournaments this team entered, as settleable history rows ─────────────
// The amount owed is what the team ACTUALLY paid, read off the credit debit
// written when they joined (tournaments/join/route.ts) — that already has any
// invite discount applied. price_per_team_pence is the list price and only
// serves as a fallback when no debit row exists (e.g. a free entry).
export async function loadTournamentEntries(teamId: string): Promise<HistoryFixture[]> {
  const { data: entries } = await supabase.from("open_match_teams")
    .select("open_match_id, fees_settled").eq("team_id", teamId);
  const ids = (entries ?? []).map((e) => e.open_match_id).filter(Boolean) as string[];
  if (ids.length === 0) return [];

  const { data: oms } = await supabase.from("open_matches")
    .select("id, title, match_date, start_time, pitch_name, price_per_team_pence, status, booking_id, organiser_team_id")
    .in("id", ids).eq("match_type", "tournament").neq("status", "cancelled");

  // Two debit shapes, because the two ways to be in a tournament cost
  // different amounts: a team that JOINED paid the buy-in (recorded against
  // open_match_id by tournaments/join), while the team that HOSTED paid the
  // whole pitch block up front via /api/book/pay-credit (recorded against the
  // reservation's booking_id). Look up both.
  const bookingIds = (oms ?? []).map((t) => t.booking_id).filter(Boolean) as string[];
  const [{ data: buyIns }, { data: hostPayments }] = await Promise.all([
    supabase.from("team_credit_transactions")
      .select("open_match_id, amount_pence").eq("team_id", teamId).in("open_match_id", ids),
    bookingIds.length
      ? supabase.from("team_credit_transactions")
          .select("booking_id, amount_pence").eq("team_id", teamId).in("booking_id", bookingIds)
      : Promise.resolve({ data: [] as { booking_id: string; amount_pence: number }[] }),
  ]);

  const paidByOm = new Map<string, number>();
  for (const d of buyIns ?? []) {
    if (d.amount_pence >= 0) continue;   // credits/reimbursements, not a payment out
    paidByOm.set(d.open_match_id, (paidByOm.get(d.open_match_id) ?? 0) + Math.abs(d.amount_pence));
  }
  const paidByBooking = new Map<string, number>();
  for (const d of hostPayments ?? []) {
    if (d.amount_pence >= 0) continue;
    paidByBooking.set(d.booking_id, (paidByBooking.get(d.booking_id) ?? 0) + Math.abs(d.amount_pence));
  }
  const settledByOm = new Map((entries ?? []).map((e) => [e.open_match_id, Boolean(e.fees_settled)]));

  return (oms ?? []).map((t) => ({
    key: `tournament:${t.id}`,
    kind: "tournament" as const,
    postId: null,
    matchRowId: null,
    openMatchId: t.id,
    label: t.title || "Tournament",
    teamPoolPence: paidByOm.get(t.id)
      ?? (t.organiser_team_id === teamId && t.booking_id ? paidByBooking.get(t.booking_id) : undefined)
      ?? Math.round(t.price_per_team_pence ?? 0),
    settled: settledByOm.get(t.id) ?? false,
    date: toDateKey(t.match_date),
    time: t.start_time ?? "",
    pitch: t.pitch_name ?? "TBC",
    isUpcoming: isUpcomingDate(t.match_date),
  })).filter((t) => t.date !== "");
}
