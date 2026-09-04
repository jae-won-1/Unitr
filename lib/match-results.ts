import { supabase } from "@/lib/supabase";

// ── Submitted results, read from wherever a fixture is shown ──────────
// A result lives in two rows per match: each captain files their own
// match_results row from their own side (team_score / opponent_score), and
// matches.result_verified turns true only once both filed the same score.
//
// Every surface that shows a played fixture wants the same two things — the
// score from THIS team's point of view, and whether it is settled or still
// waiting on the opponent — so the read lives here rather than being
// re-derived per page. /my-team/match/[matchId] keeps its own richer load
// (both sides' submissions, so it can say who still owes one).
//
// A result is shown as soon as this team submits it, marked pending until the
// opponent agrees. Hiding it until verification meant a captain who had just
// typed the score in saw "no result" everywhere else in the app.
//
// match_results arrives with supabase_match_results.sql. Selecting from a table
// that isn't there fails the whole query, so a missing migration yields no
// results rather than a Calendar that won't load.

export type Outcome = "won" | "drawn" | "lost";

export type FixtureResult = {
  teamScore: number;
  opponentScore: number;
  /** Both captains submitted the same score. Until then it reads "Pending". */
  verified: boolean;
  outcome: Outcome;
};

export type ResultScorer = { playerId: string; name: string; goals: number };

export function outcomeOf(teamScore: number, opponentScore: number): Outcome {
  if (teamScore > opponentScore) return "won";
  if (teamScore < opponentScore) return "lost";
  return "drawn";
}

/** W / D / L, for a one-character chip beside the score. */
export const OUTCOME_LETTER: Record<Outcome, string> = { won: "W", drawn: "D", lost: "L" };

/** Tailwind text colour per outcome — matches the Settle Payments score. */
export const OUTCOME_TEXT: Record<Outcome, string> = {
  won: "text-accent-ink",
  drawn: "text-text-secondary",
  lost: "text-red-500",
};

export const OUTCOME_CHIP: Record<Outcome, string> = {
  won: "bg-[#E7F8EC] text-accent-ink border-[#B7E8C6]",
  drawn: "bg-surface-2 text-text-secondary border-border",
  lost: "bg-red-50 text-red-600 border-red-200",
};

export function resultKey(matchId: string, teamId: string): string {
  return `${matchId}:${teamId}`;
}

/**
 * Scores for a set of (match, team) pairs, keyed by resultKey().
 *
 * The pair is the unit rather than the match id because the same match can be
 * asked about from two directions — a team's own fixture, and a ringer who
 * guested for one side of it — and each wants the score its own way round.
 *
 * `verified` comes from the caller's own matches row: everywhere this is used
 * that row has already been fetched for something else.
 */
export async function loadFixtureResults(
  fixtures: { matchId: string; teamId: string; verified?: boolean }[],
): Promise<Map<string, FixtureResult>> {
  const out = new Map<string, FixtureResult>();
  const matchIds = [...new Set(fixtures.map((f) => f.matchId).filter(Boolean))];
  if (matchIds.length === 0) return out;

  const { data, error } = await supabase.from("match_results")
    .select("match_id, team_id, team_score, opponent_score")
    .in("match_id", matchIds);
  if (error || !data) return out;

  // Filtered client-side by team rather than with a second eq(): one query
  // covers every pair, including two rows of the same match read from
  // opposite sides.
  for (const f of fixtures) {
    const row = data.find((r) => r.match_id === f.matchId && r.team_id === f.teamId);
    if (!row) continue;
    const teamScore = row.team_score ?? 0;
    const opponentScore = row.opponent_score ?? 0;
    out.set(resultKey(f.matchId, f.teamId), {
      teamScore,
      opponentScore,
      verified: Boolean(f.verified),
      outcome: outcomeOf(teamScore, opponentScore),
    });
  }
  return out;
}

/**
 * Who scored, both sides, for one match — names resolved, goalless players
 * dropped, top scorer first.
 *
 * Split by team rather than returned flat, because a scorers list only reads
 * as a scorers list when it sits under the half of the score it belongs to.
 */
export async function loadResultScorers(
  matchId: string,
  teamId: string,
): Promise<{ mine: ResultScorer[]; theirs: ResultScorer[] }> {
  const empty = { mine: [], theirs: [] };

  const { data: rows, error } = await supabase.from("match_result_players")
    .select("team_id, player_id, goals")
    .eq("match_id", matchId);
  if (error || !rows) return empty;

  const scorers = rows.filter((r) => (r.goals ?? 0) > 0);
  if (scorers.length === 0) return empty;

  // profiles has no registered FK from match_result_players, so the names come
  // from a second query and are merged by hand (PGRST200 otherwise).
  const ids = [...new Set(scorers.map((r) => r.player_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "Player"]));

  const toScorer = (r: { player_id: string; goals: number | null }): ResultScorer => ({
    playerId: r.player_id,
    name: nameById.get(r.player_id) ?? "Player",
    goals: r.goals ?? 0,
  });
  const byGoals = (a: ResultScorer, b: ResultScorer) => b.goals - a.goals;

  return {
    mine: scorers.filter((r) => r.team_id === teamId).map(toScorer).sort(byGoals),
    theirs: scorers.filter((r) => r.team_id !== teamId).map(toScorer).sort(byGoals),
  };
}
