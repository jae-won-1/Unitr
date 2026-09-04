import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isKickoffPast, sortKey, toDateKey } from "@/lib/match-dates";
import { loadTournamentFixtures } from "@/lib/tournament-fixtures";

// ── "Am I playing?", for everything the team has committed to ──────────
//
// One question, two records behind it. A poll (availability_requests /
// availability_responses) asks which of several PROPOSED dates a player could
// make; match_confirmations records their answer for a game that is actually
// happening. The poll is optional — a captain who takes a match off the feed or
// enters a tournament never has to run one — so the confirmed side has to stand
// on its own, for tournaments as much as for friendlies.
//
// A tournament entry has no matches row, so match_confirmations grew a second
// target: open_match_id (supabase_event_availability.sql). Everything that
// reads or writes an answer goes through here, so neither target can be
// remembered in one place and forgotten in another.

export type ConfirmStatus = "confirmed" | "declined" | "pending";

/** Exactly one of these is set — a confirmation targets a match or a tournament. */
export type AvailabilityTarget = { matchId?: string | null; openMatchId?: string | null };

export type UpcomingEvent = {
  /** Stable React key — a match id and a tournament id can't be assumed distinct. */
  key: string;
  kind: "match" | "tournament";
  target: AvailabilityTarget;
  title: string;
  matchDate: string;
  matchTime: string;
  venueName: string | null;
  myStatus: ConfirmStatus;
};

function column(target: AvailabilityTarget): "match_id" | "open_match_id" {
  return target.openMatchId ? "open_match_id" : "match_id";
}

function targetId(target: AvailabilityTarget): string | null {
  return target.openMatchId ?? target.matchId ?? null;
}

// ── One player's answer ───────────────────────────────────────────────
/** null means the read failed — distinct from "pending", which is a real answer. */
export async function readMyStatus(
  target: AvailabilityTarget,
  playerId: string,
): Promise<ConfirmStatus | null> {
  const id = targetId(target);
  if (!id) return null;
  const { data, error } = await supabase
    .from("match_confirmations")
    .select("status")
    .eq(column(target), id)
    .eq("player_id", playerId)
    .maybeSingle();
  if (error) return null;
  return (data?.status as ConfirmStatus) ?? "pending";
}

/** Saves an answer. Returns false if the write failed, so the caller can revert. */
export async function writeMyStatus(
  target: AvailabilityTarget,
  { playerId, teamId, status }: { playerId: string; teamId: string; status: ConfirmStatus },
): Promise<boolean> {
  const id = targetId(target);
  if (!id) return false;

  // The match side upserts against the table's unique(match_id, player_id).
  // Tournament rows are guarded by a PARTIAL unique index instead, which
  // PostgREST can't name as a conflict target, so they read first and then
  // insert or update. Same record either way.
  if (target.matchId) {
    const { error } = await supabase.from("match_confirmations").upsert(
      { match_id: target.matchId, player_id: playerId, team_id: teamId, status },
      { onConflict: "match_id,player_id" },
    );
    return !error;
  }

  const { data: existing, error: readErr } = await supabase
    .from("match_confirmations")
    .select("id")
    .eq("open_match_id", id)
    .eq("player_id", playerId)
    .maybeSingle();
  if (readErr) return false;

  const { error } = existing
    ? await supabase.from("match_confirmations").update({ status }).eq("id", existing.id)
    : await supabase.from("match_confirmations")
        .insert({ open_match_id: id, player_id: playerId, team_id: teamId, status });
  return !error;
}

// ── Everything upcoming that wants an answer ──────────────────────────
// Confirmed friendlies plus every tournament the team actually entered.
// Hosting one isn't entering it — an organiser buys into its own tournament
// separately, like anyone else — so a hosted-but-not-entered tournament asks
// the squad nothing.
export async function loadUpcomingEvents(
  teamId: string | null,
  userId: string | undefined,
): Promise<UpcomingEvent[]> {
  if (!teamId || !userId) return [];

  const [matches, tournaments] = await Promise.all([
    loadUpcomingMatches(teamId, userId),
    loadUpcomingTournaments(teamId, userId),
  ]);

  return [...matches, ...tournaments].sort((a, b) =>
    sortKey(a.matchDate, a.matchTime).localeCompare(sortKey(b.matchDate, b.matchTime)));
}

async function loadUpcomingMatches(teamId: string, userId: string): Promise<UpcomingEvent[]> {
  const { data: rows } = await supabase
    .from("matches")
    .select("id, posting_team_id, challenging_team_id, match_date, match_time, confirmed_pitch, status")
    .or(`posting_team_id.eq.${teamId},challenging_team_id.eq.${teamId}`)
    .eq("status", "confirmed");

  const upcoming = (rows ?? []).filter((m) => !isKickoffPast(m.match_date, m.match_time));
  if (upcoming.length === 0) return [];

  // teams.captain_id → profiles isn't in the schema cache, and embedding the
  // opponent team the same way would fail the whole query. Fetched separately.
  const opponentIds = [...new Set(upcoming.map((m) =>
    m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id))].filter(Boolean);
  const [{ data: teams }, { data: confs }] = await Promise.all([
    opponentIds.length
      ? supabase.from("teams").select("id, name").in("id", opponentIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("match_confirmations").select("match_id, status")
      .eq("player_id", userId).in("match_id", upcoming.map((m) => m.id)),
  ]);
  const nameById = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
  const statusById = new Map((confs ?? []).map((c) => [c.match_id as string, c.status as ConfirmStatus]));

  return upcoming.map((m) => ({
    key: `match:${m.id}`,
    kind: "match" as const,
    target: { matchId: m.id as string },
    title: `vs ${nameById.get(
      m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id) ?? "Opponent"}`,
    matchDate: m.match_date as string,
    matchTime: m.match_time as string,
    venueName: (m.confirmed_pitch as { name?: string } | null)?.name ?? null,
    myStatus: statusById.get(m.id as string) ?? "pending",
  }));
}

async function loadUpcomingTournaments(teamId: string, userId: string): Promise<UpcomingEvent[]> {
  const entered = (await loadTournamentFixtures(teamId)).filter((t) => t.entered);
  const upcoming = entered.filter((t) => !isKickoffPast(t.date, t.time));
  if (upcoming.length === 0) return [];

  // open_match_id arrives with supabase_event_availability.sql. Selecting a
  // column that isn't there fails the query, so a missing migration drops
  // tournaments out of the list rather than emptying it.
  const { data: confs, error } = await supabase.from("match_confirmations")
    .select("open_match_id, status")
    .eq("player_id", userId)
    .in("open_match_id", upcoming.map((t) => t.id));
  if (error) return [];

  const statusById = new Map((confs ?? []).map((c) => [c.open_match_id as string, c.status as ConfirmStatus]));

  return upcoming.map((t) => ({
    key: `tournament:${t.id}`,
    kind: "tournament" as const,
    target: { openMatchId: t.id },
    title: t.title || "Tournament",
    matchDate: t.date,
    matchTime: t.time,
    venueName: t.pitch ?? null,
    myStatus: statusById.get(t.id) ?? "pending",
  }));
}

// ── How the squad answered, per game ──────────────────────────────────
// What the captain needs to see and the player doesn't: the tally behind each
// fixture. It's the matchday squad in miniature, and for a tournament it is the
// only place that tally exists — /my-team/match/[matchId] has no counterpart
// for an open_matches entry.
export type AnswerCounts = { confirmed: number; declined: number };

export async function loadSquadAnswerCounts(
  teamId: string | null,
  events: UpcomingEvent[],
): Promise<Record<string, AnswerCounts>> {
  if (!teamId || events.length === 0) return {};

  const matchIds = events.map((e) => e.target.matchId).filter(Boolean) as string[];
  const openMatchIds = events.map((e) => e.target.openMatchId).filter(Boolean) as string[];

  const [matchRows, openRows] = await Promise.all([
    matchIds.length
      ? supabase.from("match_confirmations").select("match_id, status")
          .eq("team_id", teamId).in("match_id", matchIds)
      : Promise.resolve({ data: [] as { match_id: string; status: string }[] }),
    openMatchIds.length
      ? supabase.from("match_confirmations").select("open_match_id, status")
          .eq("team_id", teamId).in("open_match_id", openMatchIds)
      : Promise.resolve({ data: [] as { open_match_id: string; status: string }[] }),
  ]);

  const out: Record<string, AnswerCounts> = {};
  const bump = (key: string, status: string) => {
    if (status !== "confirmed" && status !== "declined") return;
    const c = out[key] ?? (out[key] = { confirmed: 0, declined: 0 });
    c[status] += 1;
  };
  for (const r of (matchRows.data ?? []) as { match_id: string; status: string }[]) {
    bump(`match:${r.match_id}`, r.status);
  }
  for (const r of (openRows.data ?? []) as { open_match_id: string; status: string }[]) {
    bump(`tournament:${r.open_match_id}`, r.status);
  }
  return out;
}

// ── Carrying a poll answer over to the real fixture ───────────────────
// A poll asked "could you play Sat 18:00?" and the captain then booked exactly
// that slot. Asking the same squad the same question again is busywork, and the
// half who don't answer twice read as undecided when they aren't — so the
// poll's answer for the matching date becomes the fixture's starting answer.
//
// Only the date decides the carry-over: a player who picked that slot starts
// Available, one who answered the poll without picking it starts Unavailable
// (they said that date doesn't work — that is an answer, not a silence), and
// anyone who never replied stays pending. All three can still be changed on the
// fixture card right up to kickoff.
//
// Takes its client: the browser writes this when a challenge is accepted, and
// /api/tournaments/join writes it with adminSupabase.
export async function seedAvailabilityFromPoll(
  client: SupabaseClient,
  { teamId, target, date, time, playerIds }: {
    teamId: string;
    target: AvailabilityTarget;
    date: string;
    time: string;
    /** The squad this fixture belongs to — a poll answer from anyone else is ignored. */
    playerIds: string[];
  },
): Promise<number> {
  const id = targetId(target);
  const dateKey = toDateKey(date);
  if (!id || !dateKey || playerIds.length === 0) return 0;

  const { data: req } = await client
    .from("availability_requests")
    .select("id, date_options")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!req) return 0;

  const options = (req.date_options ?? []) as { id: string; date: string; time: string }[];
  const sameDay = options.filter((o) => toDateKey(o.date) === dateKey);
  // A poll can propose the same day twice at different times. Prefer the slot
  // that was actually booked; fall back to the day when no time lines up, since
  // what the squad answered was a question about the day.
  const option = sameDay.find((o) => o.time === time) ?? sameDay[0];
  if (!option) return 0;

  const { data: responses } = await client
    .from("availability_responses")
    .select("player_id, available_date_ids")
    .eq("request_id", req.id);

  const answers = (responses ?? [])
    .filter((r) => playerIds.includes(r.player_id as string))
    .map((r) => ({
      playerId: r.player_id as string,
      status: ((r.available_date_ids ?? []) as string[]).includes(option.id)
        ? ("confirmed" as const)
        : ("declined" as const),
    }));
  if (answers.length === 0) return 0;

  // Accepting a challenge pre-writes a pending row per squad member, and so
  // does entering a tournament — but either write can have failed, so split
  // the update from the insert rather than assuming the rows are there.
  const { data: existing, error: readErr } = await client
    .from("match_confirmations")
    .select("id, player_id")
    .eq(column(target), id)
    .in("player_id", answers.map((a) => a.playerId));
  if (readErr) return 0;

  const rowByPlayer = new Map((existing ?? []).map((r) => [r.player_id as string, r.id as string]));

  for (const status of ["confirmed", "declined"] as const) {
    const rowIds = answers
      .filter((a) => a.status === status && rowByPlayer.has(a.playerId))
      .map((a) => rowByPlayer.get(a.playerId) as string);
    if (rowIds.length > 0) {
      await client.from("match_confirmations").update({ status }).in("id", rowIds);
    }
  }

  const missing = answers.filter((a) => !rowByPlayer.has(a.playerId));
  if (missing.length > 0) {
    await client.from("match_confirmations").insert(missing.map((a) => ({
      [column(target)]: id,
      player_id: a.playerId,
      team_id: teamId,
      status: a.status,
    })));
  }

  return answers.length;
}

/**
 * Everyone a fixture has to ask: the approved squad plus the captain, who has
 * no team_members row of their own.
 */
export async function squadPlayerIds(
  client: SupabaseClient,
  teamId: string,
  captainId?: string | null,
): Promise<string[]> {
  const { data: members } = await client
    .from("team_members").select("player_id").eq("team_id", teamId).eq("status", "approved");
  return [...new Set(
    [...(members ?? []).map((m) => m.player_id as string), captainId].filter(Boolean) as string[],
  )];
}
