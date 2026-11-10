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
  // whole pitch block up front via /api/book/pitch (recorded against the
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

// ── Friendlies this team played (or will), as settleable history rows ──────
// Moved unchanged out of SettlePaymentsList so the phone's Settle screen lists
// the same friendlies the web does. Everything here is filed under the TEAM'S
// captain id (lib/team-leadership.ts), so pass `captainId`, not the viewer's.

export type SettleMatchRow = {
  id: string;
  post_id: string;
  posting_team_id: string;
  challenging_team_id: string;
  confirmed_pitch: { price?: number } | null;
  fees_settled: boolean;
  result_submitted: boolean;
  result_verified: boolean;
};

export type SettleMatchResult = { teamScore: number; opponentScore: number };

export async function loadMatchFixtures(captainId: string, teamId: string): Promise<{
  fixtures: HistoryFixture[];
  matchRows: Record<string, SettleMatchRow>;
  matchResults: Record<string, SettleMatchResult>;
}> {
  // Matches where this team posted and was challenged
  const { data: myPosts } = await supabase.from("match_posts")
    .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched");

  const posterFixtures = await Promise.all(
    (myPosts ?? []).map(async (post) => {
      const { data: ch } = await supabase.from("challenges")
        .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
      return {
        postId: post.id as string,
        opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
        date: post.match_date as string,
        time: post.match_time as string,
        pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
      };
    })
  );

  // Matches where this team challenged another team's post
  const { data: myChallenges } = await supabase.from("challenges")
    .select("post_id, selected_pitch").eq("challenger_captain_id", captainId).eq("status", "accepted");

  const challengerFixtures = await Promise.all(
    (myChallenges ?? []).map(async (c) => {
      const { data: post } = await supabase.from("match_posts")
        .select("id, team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
      return {
        postId: c.post_id as string,
        opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
        date: (post as { match_date: string } | null)?.match_date ?? "",
        time: (post as { match_time: string } | null)?.match_time ?? "",
        pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
      };
    })
  );

  // Settle Payments shows both past fixtures and upcoming ones (marked
  // "Upcoming" so a captain can still issue payment requests ahead of the
  // game, just not submit a result before it's played).
  // Normalise the date rather than requiring ISO: legacy rows store
  // "Wed, 03 JUN 2026", and dropping them hid played fixtures from history
  // entirely while the same string kept them pinned in Upcoming elsewhere.
  const all = [...posterFixtures, ...challengerFixtures]
    .map((f) => ({ ...f, date: toDateKey(f.date), isUpcoming: isUpcomingDate(f.date) }))
    .filter((f) => f.date !== "");

  const { data: rows } = all.length > 0
    ? await supabase.from("matches").select("id, post_id, posting_team_id, challenging_team_id, confirmed_pitch, fees_settled, result_submitted, result_verified").in("post_id", all.map((f) => f.postId))
    : { data: [] };
  const byPostId = new Map((rows ?? []).map((r) => [r.post_id, r.id]));
  const matchRows: Record<string, SettleMatchRow> =
    Object.fromEntries((rows ?? []).map((r) => [r.id, r as unknown as SettleMatchRow]));

  // Fetch all match_results for these matches, then filter client-side to the
  // current team only. Consistent with match detail page which uses the same
  // pattern — server-side eq("team_id") can return opponent rows unexpectedly.
  let matchResults: Record<string, SettleMatchResult> = {};
  const allMatchIds = (rows ?? []).map((r) => r.id);
  if (allMatchIds.length > 0) {
    const { data: results } = await supabase.from("match_results")
      .select("match_id, team_id, team_score, opponent_score").in("match_id", allMatchIds);
    const myResults = (results ?? []).filter((r) => r.team_id === teamId);
    matchResults = Object.fromEntries(myResults.map((r) => [r.match_id, { teamScore: r.team_score, opponentScore: r.opponent_score }]));
  }

  const matchById = new Map((rows ?? []).map((r) => [r.id, r]));
  const fixtures: HistoryFixture[] = all.map((f) => {
    const matchRowId = byPostId.get(f.postId) ?? null;
    const m = matchRowId ? matchById.get(matchRowId) : undefined;
    // Each team covers 50% of the pitch fee; the poster carries the odd penny.
    const feePence = Math.round(((m?.confirmed_pitch as { price?: number } | null)?.price ?? 0) * 100);
    const half = Math.floor(feePence / 2);
    return {
      ...f,
      key: `match:${f.postId}`,
      kind: "match" as const,
      matchRowId,
      openMatchId: null,
      label: f.opponent,
      teamPoolPence: m?.posting_team_id === teamId ? feePence - half : half,
      settled: Boolean(m?.fees_settled),
    };
  });

  return { fixtures, matchRows, matchResults };
}

/** Soonest upcoming first, then most recent past first. */
export function sortSettleFixtures(list: HistoryFixture[]): HistoryFixture[] {
  return [...list].sort((a, b) => {
    if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1;
    return a.isUpcoming ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
  });
}
