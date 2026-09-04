import { supabase } from "@/lib/supabase";
import { DEFAULT_FORMATION } from "@/lib/formations";

// ── A single game inside a tournament ─────────────────────────────────
//
// The Calendar and My Team treat a tournament as ONE commitment, because that
// is how a squad buys into it: one entry, one buy-in, one availability answer
// (lib/event-availability.ts). But a team that enters a tournament plays
// several games in it, and each of those is a real fixture with a kickoff time,
// an opponent, a referee and — the thing that was missing — a shape the captain
// wants to pick before it starts.
//
// Those games are tournament_matches rows (supabase_tournament_schedule.sql).
// Everything that reads one on a team's behalf goes through here so the
// "is this fixture ours?" test isn't rewritten in four places, each slightly
// differently.

export type TeamTournamentFixture = {
  id: string;
  openMatchId: string;
  slotIndex: number;
  /** "18:00" within the tournament's booked block, or null if unscheduled. */
  scheduledTime: string | null;
  homeTeamId: string | null;
  homeTeamName: string;
  awayTeamId: string | null;
  awayTeamName: string;
  refereeName: string | null;
  refereeTeamName: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
};

// One unbroken literal on purpose: supabase-js types the result from the shape
// of this string, and a concatenated one widens to `string` and loses the row
// type entirely.
const COLUMNS = "id, open_match_id, slot_index, scheduled_time, home_team_id, home_team_name, away_team_id, away_team_name, referee_name, referee_team_name, home_score, away_score, status";

type Row = {
  id: string; open_match_id: string; slot_index: number; scheduled_time: string | null;
  home_team_id: string | null; home_team_name: string | null;
  away_team_id: string | null; away_team_name: string | null;
  referee_name: string | null; referee_team_name: string | null;
  home_score: number | null; away_score: number | null; status: string;
};

function map(r: Row): TeamTournamentFixture {
  return {
    id: r.id,
    openMatchId: r.open_match_id,
    slotIndex: r.slot_index,
    scheduledTime: r.scheduled_time,
    homeTeamId: r.home_team_id,
    homeTeamName: r.home_team_name ?? "TBC",
    awayTeamId: r.away_team_id,
    awayTeamName: r.away_team_name ?? "TBC",
    refereeName: r.referee_name,
    refereeTeamName: r.referee_team_name,
    homeScore: r.home_score,
    awayScore: r.away_score,
    status: r.status,
  };
}

/**
 * The games one team actually plays in one tournament, in schedule order.
 * An organiser who didn't enter a team of its own gets nothing — hosting isn't
 * playing, the same distinction lib/tournament-fixtures.ts draws.
 *
 * Returns [] rather than throwing when the schedule table isn't there: a
 * missing migration should hide the fixture list, not empty the page around it.
 */
export async function loadTeamFixturesInTournament(
  openMatchId: string,
  teamId: string | null | undefined,
): Promise<TeamTournamentFixture[]> {
  if (!teamId) return [];
  const { data, error } = await supabase
    .from("tournament_matches")
    .select(COLUMNS)
    .eq("open_match_id", openMatchId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("slot_index", { ascending: true });
  if (error) return [];
  return ((data ?? []) as Row[]).map(map);
}

/** One fixture by id, for the manage page. null means it doesn't exist. */
export async function loadTournamentFixture(fixtureId: string): Promise<TeamTournamentFixture | null> {
  const { data, error } = await supabase
    .from("tournament_matches").select(COLUMNS).eq("id", fixtureId).maybeSingle();
  if (error || !data) return null;
  return map(data as Row);
}

/** Which side of this fixture a team is on — null when it isn't in it at all. */
export function sideOf(
  fixture: TeamTournamentFixture,
  teamId: string | null,
): "home" | "away" | null {
  if (!teamId) return null;
  if (fixture.homeTeamId === teamId) return "home";
  if (fixture.awayTeamId === teamId) return "away";
  return null;
}

// ── The captain's plan for one fixture ────────────────────────────────
// Stored in match_tactics against tournament_match_id
// (supabase_tournament_match_tactics.sql), so a tournament game's lineup lives
// in the same table and the same { slotIndex: playerId } shape as a friendly's.

export type FixtureTactics = {
  formation: string;
  style: string | null;
  notes: string;
  lineup: Record<number, string>;
};

export const EMPTY_TACTICS: FixtureTactics = {
  formation: DEFAULT_FORMATION,
  style: null,
  notes: "",
  lineup: {},
};

/** null means the read failed — most likely the migration hasn't been run. */
export async function loadFixtureTactics(
  tournamentMatchId: string,
  teamId: string,
): Promise<FixtureTactics | null> {
  const { data, error } = await supabase
    .from("match_tactics")
    .select("formation, style, notes, lineup")
    .eq("tournament_match_id", tournamentMatchId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) return null;
  if (!data) return { ...EMPTY_TACTICS };
  return {
    formation: data.formation ?? DEFAULT_FORMATION,
    style: data.style ?? null,
    notes: data.notes ?? "",
    lineup: (data.lineup ?? {}) as Record<number, string>,
  };
}

/**
 * Saves the plan. The tournament target is guarded by a PARTIAL unique index,
 * which PostgREST can't name as an upsert conflict target, so this reads the
 * row first and then inserts or updates — the same dance writeMyStatus does
 * for a tournament availability answer.
 */
export async function saveFixtureTactics(
  tournamentMatchId: string,
  teamId: string,
  tactics: FixtureTactics,
): Promise<boolean> {
  const values = {
    formation: tactics.formation,
    style: tactics.style,
    notes: tactics.notes,
    lineup: tactics.lineup,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: readErr } = await supabase
    .from("match_tactics")
    .select("id")
    .eq("tournament_match_id", tournamentMatchId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (readErr) return false;

  const { error } = existing
    ? await supabase.from("match_tactics").update(values).eq("id", existing.id)
    : await supabase.from("match_tactics")
        .insert({ tournament_match_id: tournamentMatchId, team_id: teamId, ...values });
  return !error;
}
