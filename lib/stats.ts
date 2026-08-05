// ── Stats aggregation ─────────────────────────────────────────────────
// The first real stats layer in the app. Everything shown before this was a
// hardcoded string — "47 games, 23 goals, 8.7 rating" on /profile, and a literal
// "—" for every player in the squad list.
//
// Two things follow from where the numbers come from, and both shape the UI:
//
// 1. Stats only exist for fixtures where a captain actually submitted a result.
//    A team can have played ten games and have an empty table here. That is why
//    every return carries `matchesWithResults` — a caller with zero should show
//    "no results submitted yet", not a wall of confident-looking zeros.
//
// 2. There is no ingestion pipeline. Goals and assists are typed in by a human
//    on the result form, so there is nothing here for possession, pass accuracy,
//    distance, or a match rating. Those metrics are absent rather than
//    estimated — inventing them is how a prototype starts lying.
//
// Schema note: match_result_players.assists is added by
// supabase_match_result_verification.sql, NOT by the base supabase_match_results.sql.
// A database with only the base migration applied has no such column, and asking
// for it fails the whole select. We therefore try with assists and fall back to
// a query without it, per the repo's "missing migrations degrade, they don't
// crash" convention.

import { supabase } from "@/lib/supabase";

export type TeamStats = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  winRate: number;        // 0–100, rounded
  matchesWithResults: number;
};

export type PlayerStats = {
  playerId: string;
  appearances: number;
  starts: number;
  goals: number;
  assists: number;
  goalsPerGame: number;   // 2dp
  matchesWithResults: number;
};

export const EMPTY_TEAM_STATS: TeamStats = {
  played: 0, won: 0, drawn: 0, lost: 0,
  goalsFor: 0, goalsAgainst: 0, goalDifference: 0,
  winRate: 0, matchesWithResults: 0,
};

export function emptyPlayerStats(playerId: string): PlayerStats {
  return { playerId, appearances: 0, starts: 0, goals: 0, assists: 0, goalsPerGame: 0, matchesWithResults: 0 };
}

type ResultPlayerRow = {
  match_id: string;
  player_id: string;
  started: boolean | null;
  subbed_on: boolean | null;
  goals: number | null;
  assists?: number | null;
};

const WITH_ASSISTS = "match_id, player_id, started, subbed_on, goals, assists";
const NO_ASSISTS = "match_id, player_id, started, subbed_on, goals";

// Selects match_result_players filtered by one column, retrying without
// `assists` if that column doesn't exist yet. Returns [] rather than throwing —
// a stats panel that renders empty beats a page that dies.
async function selectResultPlayers(column: "team_id" | "player_id", value: string): Promise<ResultPlayerRow[]> {
  const first = await supabase.from("match_result_players").select(WITH_ASSISTS).eq(column, value);
  if (!first.error) return (first.data ?? []) as unknown as ResultPlayerRow[];

  const retry = await supabase.from("match_result_players").select(NO_ASSISTS).eq(column, value);
  if (retry.error) return [];
  return (retry.data ?? []) as unknown as ResultPlayerRow[];
}

/**
 * Season record for a team, from every result its captain has submitted.
 *
 * Only the team's OWN match_results rows are read. The opponent files a
 * mirrored row for the same match, so counting both would double every fixture
 * and score each one from both ends at once.
 */
export async function loadTeamStats(teamId: string): Promise<TeamStats> {
  const { data, error } = await supabase
    .from("match_results")
    .select("match_id, team_score, opponent_score")
    .eq("team_id", teamId);

  if (error || !data || data.length === 0) return EMPTY_TEAM_STATS;

  // One row per match — a re-submitted result could leave duplicates, and a
  // team's record should not depend on how many times someone hit save.
  const byMatch = new Map<string, { team_score: number; opponent_score: number }>();
  for (const r of data) {
    byMatch.set(r.match_id, {
      team_score: r.team_score ?? 0,
      opponent_score: r.opponent_score ?? 0,
    });
  }

  const stats = { ...EMPTY_TEAM_STATS };
  for (const { team_score, opponent_score } of byMatch.values()) {
    stats.played += 1;
    stats.goalsFor += team_score;
    stats.goalsAgainst += opponent_score;
    if (team_score > opponent_score) stats.won += 1;
    else if (team_score < opponent_score) stats.lost += 1;
    else stats.drawn += 1;
  }

  stats.goalDifference = stats.goalsFor - stats.goalsAgainst;
  stats.winRate = stats.played > 0 ? Math.round((stats.won / stats.played) * 100) : 0;
  stats.matchesWithResults = stats.played;
  return stats;
}

/**
 * Per-player totals for a whole squad, keyed by player_id.
 *
 * Scoped to the team, so a player who has also turned out for another club (or
 * as a ringer elsewhere) only has their record for THIS team counted here.
 * Players with no recorded appearance are absent from the map — callers should
 * fall back to emptyPlayerStats().
 */
export async function loadSquadStats(teamId: string): Promise<Map<string, PlayerStats>> {
  return foldPlayerRows(await selectResultPlayers("team_id", teamId));
}

/**
 * One player's totals across every team they have played for.
 *
 * This is the career figure behind /profile, deliberately not team-scoped —
 * a player's own stats page should not reset when they transfer.
 */
export async function loadPlayerStats(playerId: string): Promise<PlayerStats> {
  const rows = await selectResultPlayers("player_id", playerId);
  return foldPlayerRows(rows).get(playerId) ?? emptyPlayerStats(playerId);
}

function foldPlayerRows(rows: ResultPlayerRow[]): Map<string, PlayerStats> {
  const out = new Map<string, PlayerStats>();
  // match_result_players is unique on (match_id, player_id), so an appearance
  // is one row and there is nothing to de-duplicate here.
  const matches = new Map<string, Set<string>>();

  for (const r of rows) {
    const s = out.get(r.player_id) ?? emptyPlayerStats(r.player_id);
    // An appearance is starting OR coming off the bench. A named substitute who
    // never got on has a row too, and should not be credited with a game.
    const played = !!r.started || !!r.subbed_on;
    if (played) s.appearances += 1;
    if (r.started) s.starts += 1;
    s.goals += r.goals ?? 0;
    s.assists += r.assists ?? 0;
    out.set(r.player_id, s);

    const seen = matches.get(r.player_id) ?? new Set<string>();
    seen.add(r.match_id);
    matches.set(r.player_id, seen);
  }

  for (const s of out.values()) {
    s.matchesWithResults = matches.get(s.playerId)?.size ?? 0;
    s.goalsPerGame = s.appearances > 0 ? Math.round((s.goals / s.appearances) * 100) / 100 : 0;
  }
  return out;
}
