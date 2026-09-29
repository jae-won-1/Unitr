"use client";

// ── Leaving a squad ───────────────────────────────────────────────────
// A player (or a co-captain) walking out of the team they're in. The only
// place a membership is given up, the way lib/team-chat.ts is the only place
// the chat is read or written.
//
// The membership row IS the membership: RoleContext reads it, the team chat
// derives its members from it, the co-captain flag rides on it, and
// lib/availability-gate reads the joining fee off it. So deleting it does most
// of the work — the leaver drops to new_user, falls out of the chat, and stops
// appearing in the squad everywhere it is listed.
//
// What deleting it does NOT undo is everything the membership had already
// answered or been billed for, and those split two ways:
//
//   • Questions about games that haven't happened get withdrawn here. A
//     leaver's Available on next Saturday is a place claimed in a team they
//     are no longer in, and the captain reads that tally when picking a side.
//   • Money is left exactly as it stands. Outstanding dues are a debt to the
//     squad, not a subscription — walking out is not a way to clear them, and
//     the captain's Payment Status still lists them.
//
// A captain can't leave: they hold the team, the fixtures are filed under
// their id, and teams.captain_id is immutable from a browser session anyway
// (supabase_pilot_security.sql). Handing a team over isn't built, so this
// refuses rather than pretending.

import { supabase } from "@/lib/supabase";
import { isKickoffPast } from "@/lib/match-dates";

export type LeaveTeamOutcome = { error: string } | { ok: true };

// The fixtures this player answered for that haven't kicked off yet. Both
// shapes of answer live in match_confirmations — a friendly against match_id,
// a tournament entry against open_match_id — so both are resolved to a date
// and the past ones left alone: a confirmation for a game already played is
// the record of who played it, which Settle Payments reads.
async function withdrawFutureAnswers(teamId: string, playerId: string): Promise<void> {
  const { data: rows, error } = await supabase
    .from("match_confirmations")
    .select("id, match_id, open_match_id")
    .eq("team_id", teamId)
    .eq("player_id", playerId);
  if (error || !rows || rows.length === 0) return;

  const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))] as string[];
  const openIds = [...new Set(rows.map((r) => r.open_match_id).filter(Boolean))] as string[];

  const [matchRes, openRes] = await Promise.all([
    matchIds.length
      ? supabase.from("matches").select("id, match_date, match_time").in("id", matchIds)
      : Promise.resolve({ data: [] as { id: string; match_date: string; match_time: string }[] }),
    openIds.length
      ? supabase.from("open_matches").select("id, match_date, start_time").in("id", openIds)
      : Promise.resolve({ data: [] as { id: string; match_date: string; start_time: string }[] }),
  ]);

  const upcoming = new Set<string>();
  for (const m of (matchRes.data ?? []) as { id: string; match_date: string; match_time: string }[]) {
    if (!isKickoffPast(m.match_date, m.match_time)) upcoming.add(m.id);
  }
  for (const o of (openRes.data ?? []) as { id: string; match_date: string; start_time: string }[]) {
    if (!isKickoffPast(o.match_date, o.start_time)) upcoming.add(o.id);
  }

  // A row whose fixture couldn't be resolved at all is left in place: an
  // unknown date is not a reason to delete somebody's record of a game.
  const doomed = rows
    .filter((r) => upcoming.has((r.open_match_id ?? r.match_id) as string))
    .map((r) => r.id as string);
  if (doomed.length > 0) {
    await supabase.from("match_confirmations").delete().in("id", doomed);
  }
}

// The live poll's answers. A poll is about dates the captain is still choosing
// between, so a leaver's picks are never history — they're an offer to play
// that no longer stands.
async function withdrawPollAnswers(teamId: string, playerId: string): Promise<void> {
  const { data: polls } = await supabase
    .from("availability_requests").select("id").eq("team_id", teamId);
  const ids = (polls ?? []).map((p) => p.id as string);
  if (ids.length === 0) return;
  await supabase.from("availability_responses")
    .delete().eq("player_id", playerId).in("request_id", ids);
}

/**
 * Leave a squad. Returns an error to show the person who pressed it, or ok.
 *
 * The tidying above is best-effort — a database missing a migration must not
 * trap someone in a team — but the membership delete is not: if that fails,
 * nothing has happened and the caller says so.
 */
export async function leaveTeam(teamId: string, playerId: string): Promise<LeaveTeamOutcome> {
  try {
    const { data: team } = await supabase
      .from("teams").select("captain_id").eq("id", teamId).maybeSingle();
    if (team?.captain_id === playerId) {
      return { error: "You captain this team, so you can't leave it." };
    }

    const { data: membership } = await supabase
      .from("team_members").select("id")
      .eq("team_id", teamId).eq("player_id", playerId).eq("status", "approved")
      .maybeSingle();
    if (!membership) return { error: "You're not in this team." };

    await withdrawFutureAnswers(teamId, playerId);
    await withdrawPollAnswers(teamId, playerId);

    // The chat's own row holds muted / left / last read. Derived membership
    // takes the chat away on its own, so this only clears the leftovers — and
    // stops a stale left_at freezing the chat for them if they ever rejoin.
    await supabase.from("team_chat_members")
      .delete().eq("team_id", teamId).eq("user_id", playerId);

    const { error: delErr } = await supabase
      .from("team_members").delete().eq("id", membership.id);
    if (delErr) return { error: "Couldn't leave the team — please try again." };

    return { ok: true };
  } catch {
    return { error: "Couldn't leave the team — check your connection." };
  }
}
