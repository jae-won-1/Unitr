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
// (supabase_pilot_security.sql). They hand the team to a co-captain first
// (lib/hand-over-team.ts), which makes them an ordinary member who can leave.

import { supabase } from "@/lib/supabase";
import { withdrawFutureAnswers, withdrawPollAnswers } from "@/lib/membership-cleanup";

export type LeaveTeamOutcome = { error: string } | { ok: true };

/**
 * Leave a squad. Returns an error to show the person who pressed it, or ok.
 *
 * The tidying (lib/membership-cleanup.ts) is best-effort — a database missing a migration must not
 * trap someone in a team — but the membership delete is not: if that fails,
 * nothing has happened and the caller says so.
 */
export async function leaveTeam(teamId: string, playerId: string): Promise<LeaveTeamOutcome> {
  try {
    const { data: team } = await supabase
      .from("teams").select("captain_id").eq("id", teamId).maybeSingle();
    if (team?.captain_id === playerId) {
      return { error: "You captain this team — hand it to a co-captain in Team Settings first." };
    }

    const { data: membership } = await supabase
      .from("team_members").select("id")
      .eq("team_id", teamId).eq("player_id", playerId).eq("status", "approved")
      .maybeSingle();
    if (!membership) return { error: "You're not in this team." };

    await withdrawFutureAnswers(supabase, teamId, playerId);
    await withdrawPollAnswers(supabase, teamId, playerId);

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
