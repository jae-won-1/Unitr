// Submitting a friendly's result, in one place — the web's Submit Result page
// and the mobile app's both call this, because the rules are easy to get
// subtly different twice:
//
//   • each team files its OWN side (match_results, upserted on
//     match_id,team_id) with the scorers and assisters behind it
//     (match_result_players, replaced wholesale on every save);
//   • goals per player must add up to the team's score exactly, and assists
//     may not exceed it;
//   • when the other team has already filed, the two are compared: matching
//     scores verify the result (matches.result_verified), and a mismatch
//     clears both submissions and DMs both captains to re-submit.
//
// Moved here unchanged from app/my-team/match/[matchId]/result/page.tsx.

import { supabase } from "@/lib/supabase";
import { loadLedTeam } from "@/lib/team-leadership";

export type ResultMatch = {
  id: string;
  posting_team_id: string;
  challenging_team_id: string;
  match_date: string;
};
export type RosterPlayer = { player_id: string; name: string };
export type PlayerStats = { goals: number; assists: number };

export type ResultForm = {
  match: ResultMatch;
  myTeamId: string | null;
  myTeamName: string;
  opponentName: string;
  roster: RosterPlayer[];
  /** This team's earlier submission, if it made one. */
  existing: { teamScore: number; opponentScore: number } | null;
  stats: Record<string, PlayerStats>;
};

/** Everything the form needs, or null when the match doesn't exist. */
export async function loadResultForm(matchId: string, userId: string): Promise<ResultForm | null> {
  const { data: m } = await supabase.from("matches")
    .select("id, posting_team_id, challenging_team_id, match_date")
    .eq("id", matchId).maybeSingle();
  if (!m) return null;
  const match = m as ResultMatch;

  const captainTeam = await loadLedTeam<{ id: string; name: string }>(userId, "id, name");
  let tid = captainTeam?.id ?? null;
  let myTeamName = captainTeam?.name ?? "Your Team";
  if (!tid) {
    // Fallback: generic lookup can fail if captain_id isn't set correctly.
    // Check the two teams in this match directly.
    const { data: matchTeams } = await supabase.from("teams").select("id, name, captain_id")
      .in("id", [match.posting_team_id, match.challenging_team_id]);
    const myTeam = (matchTeams ?? []).find((t) => t.captain_id === userId);
    if (myTeam) { tid = myTeam.id; myTeamName = myTeam.name; }
  }

  const oppId = match.posting_team_id === tid ? match.challenging_team_id : match.posting_team_id;
  const { data: oppTeam } = await supabase.from("teams").select("name").eq("id", oppId).maybeSingle();
  const opponentName = (oppTeam?.name as string | undefined) ?? "Opponent";

  const form: ResultForm = { match, myTeamId: tid, myTeamName, opponentName, roster: [], existing: null, stats: {} };
  if (!tid) return form;

  const [{ data: members }, { data: team }] = await Promise.all([
    supabase.from("team_members").select("player_id, profiles(full_name)").eq("team_id", tid).eq("status", "approved"),
    supabase.from("teams").select("captain_id").eq("id", tid).maybeSingle(),
  ]);
  const { data: captainProfile } = team?.captain_id
    ? await supabase.from("profiles").select("full_name").eq("id", team.captain_id).maybeSingle()
    : { data: null };
  form.roster = [
    ...(team?.captain_id ? [{ player_id: team.captain_id as string, name: (captainProfile?.full_name as string | undefined) ?? "Captain" }] : []),
    ...(members ?? []).map((mm) => ({
      player_id: mm.player_id as string,
      name: (mm.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player",
    })),
  ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);

  const { data: existingResult } = await supabase.from("match_results")
    .select("team_score, opponent_score").eq("match_id", matchId).eq("team_id", tid).maybeSingle();
  if (existingResult) {
    form.existing = { teamScore: existingResult.team_score, opponentScore: existingResult.opponent_score };
  }
  const { data: existingPlayers } = await supabase.from("match_result_players")
    .select("player_id, goals, assists").eq("match_id", matchId).eq("team_id", tid);
  for (const p of existingPlayers ?? []) {
    if (p.goals > 0 || p.assists > 0) {
      form.stats[p.player_id] = { goals: p.goals, assists: p.assists ?? 0 };
    }
  }
  return form;
}

export const totalOf = (stats: Record<string, PlayerStats>, field: keyof PlayerStats) =>
  Object.values(stats).reduce((s, p) => s + p[field], 0);

/** The form's rules, as the message to show — or null when it can be sent. */
export function validateResult(teamScore: string, opponentScore: string, stats: Record<string, PlayerStats>): string | null {
  if (teamScore.trim() === "" || opponentScore.trim() === "") return "Enter the final score for both teams.";
  const ts = parseInt(teamScore, 10);
  const os = parseInt(opponentScore, 10);
  if (isNaN(ts) || isNaN(os) || ts < 0 || os < 0) return "Scores must be valid non-negative numbers.";
  const goals = totalOf(stats, "goals");
  if (goals !== ts) return `Goals scored by players (${goals}) must add up exactly to your team's score (${ts}).`;
  const assists = totalOf(stats, "assists");
  if (assists > ts) return `Total assists (${assists}) can't exceed total goals (${ts}).`;
  return null;
}

/**
 * File this team's side. Call validateResult first. `conflict` means the other
 * team had filed a different score: both submissions were cleared and both
 * captains messaged, so the caller shows the error and stays on the form.
 */
export async function submitMatchResult(opts: {
  match: ResultMatch;
  myTeamId: string;
  userId: string;
  teamScore: number;
  opponentScore: number;
  stats: Record<string, PlayerStats>;
}): Promise<{ conflict: boolean }> {
  const { match: m, myTeamId, userId, teamScore: ts, opponentScore: os, stats } = opts;

  await supabase.from("match_results").upsert({
    match_id: m.id,
    team_id: myTeamId,
    team_score: ts,
    opponent_score: os,
    submitted_by: userId,
  }, { onConflict: "match_id,team_id" });

  // Delete old player rows then insert fresh ones (only players with any stat).
  await supabase.from("match_result_players").delete()
    .eq("match_id", m.id).eq("team_id", myTeamId);

  const playerRows = Object.entries(stats)
    .filter(([, p]) => p.goals > 0 || p.assists > 0)
    .map(([playerId, p]) => ({
      match_id: m.id,
      team_id: myTeamId,
      player_id: playerId,
      started: false,
      subbed_on: false,
      goals: p.goals,
      assists: p.assists,
    }));
  if (playerRows.length > 0) {
    await supabase.from("match_result_players").insert(playerRows);
  }

  const oppTeamId = m.posting_team_id === myTeamId ? m.challenging_team_id : m.posting_team_id;
  const { data: oppResult } = await supabase.from("match_results")
    .select("team_score, opponent_score, submitted_by").eq("match_id", m.id).eq("team_id", oppTeamId).maybeSingle();

  if (oppResult) {
    const scoresMatch = oppResult.team_score === os && oppResult.opponent_score === ts;
    if (scoresMatch) {
      await supabase.from("matches").update({ result_submitted: true, result_verified: true }).eq("id", m.id);
    } else {
      await supabase.from("match_results").delete().eq("match_id", m.id);
      await supabase.from("matches").update({ result_submitted: false, result_verified: false }).eq("id", m.id);
      const msg = `⚠️ Score conflict for your match on ${m.match_date}. Please re-submit the correct result.`;
      await supabase.from("messages").insert([
        { sender_id: userId, receiver_id: oppResult.submitted_by, type: "score_conflict", body: msg },
        { sender_id: userId, receiver_id: userId, type: "score_conflict", body: `⚠️ Score conflict on ${m.match_date}. Your submission differed from the opponent's. Please re-submit.` },
      ]);
      return { conflict: true };
    }
  }
  return { conflict: false };
}

export const SCORE_CONFLICT_MESSAGE =
  "Score conflict: the opponent submitted a different result. Both submissions have been cleared — please coordinate and re-submit.";
