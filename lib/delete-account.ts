import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { authedPost } from "@/lib/authed-fetch";
import { isKickoffPast, isUpcomingDate } from "@/lib/match-dates";

// Deleting your own account — required by both app stores, and offered on the
// web too, which is where Google Play's "request deletion" link points.
//
// The work runs in /api/account/delete. This file is the rule — who may
// delete, and what goes with them — and the call. The rule takes the Supabase
// client as a parameter because the screen asks it (to grey the button with
// the reason) and the route asks it again (to enforce it).
//
// The rule for a captain (user, 26 Oct 2026):
//   • squad of anyone else → hand the team to a co-captain first;
//   • nobody else in it → the account goes and the team is CLOSED with it
//     (teams.closed_at; hidden everywhere by the read policy in
//     supabase_account_deletion.sql). Its credit is forfeited — credit is
//     non-refundable — and its money records stay. Refused while the team
//     still has a game or event ahead, which closing would leave a ghost in.

export type DeletionCheck = {
  /** Why the account can't be deleted yet, or null if it can. */
  block: string | null;
  /** The empty team that will be closed along with the account. */
  closesTeam: { id: string; name: string } | null;
};

export async function checkAccountDeletion(db: SupabaseClient, userId: string): Promise<DeletionCheck> {
  const [{ data: profile }, { data: team }] = await Promise.all([
    db.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
    db.from("teams").select("id, name").eq("captain_id", userId).maybeSingle(),
  ]);

  if (profile?.account_type === "venue_manager" || profile?.account_type === "admin") {
    return {
      block: "This account runs a venue or Uniter events, so it's closed by the Uniter team — contact us to close it.",
      closesTeam: null,
    };
  }
  if (!team) return { block: null, closesTeam: null };

  const name = (team.name as string) ?? "your team";
  const { count } = await db.from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("team_id", team.id).eq("status", "approved");
  if ((count ?? 0) > 0) {
    return {
      block: `You captain ${name}. Hand the team to a co-captain in Team Settings first — make one there if you haven't yet.`,
      closesTeam: null,
    };
  }

  const ahead = await upcomingCommitment(db, team.id as string);
  if (ahead) {
    return {
      block: `${name} still has ${ahead} ahead. Take it down, or contact Uniter to withdraw the team, before deleting your account.`,
      closesTeam: null,
    };
  }
  return { block: null, closesTeam: { id: team.id as string, name } };
}

// Something a closed team would leave behind with nobody to answer for it: an
// event it is entered in, or one of its posts or matches, that hasn't kicked
// off. Null when there is none.
async function upcomingCommitment(db: SupabaseClient, teamId: string): Promise<string | null> {
  const [{ data: entries }, { data: posts }, { data: challenges }] = await Promise.all([
    db.from("open_match_teams").select("open_match_id").eq("team_id", teamId),
    db.from("match_posts").select("match_date, match_time, status")
      .eq("team_id", teamId).in("status", ["open", "matched"]),
    db.from("challenges").select("post_id").eq("challenger_team_id", teamId).eq("status", "accepted"),
  ]);

  const eventIds = (entries ?? []).map((e) => e.open_match_id as string);
  if (eventIds.length) {
    const { data: events } = await db.from("open_matches")
      .select("match_date, start_time, status").in("id", eventIds);
    if ((events ?? []).some((e) => e.status !== "cancelled" && !isKickoffPast(e.match_date, e.start_time))) {
      return "an event it's entered in";
    }
  }

  const upcomingPost = (p: { match_date: string; match_time: string | null }) =>
    p.match_time ? !isKickoffPast(p.match_date, p.match_time) : isUpcomingDate(p.match_date);
  if ((posts ?? []).some((p) => p.status === "open" && upcomingPost(p))) return "a live match post";
  if ((posts ?? []).some((p) => p.status === "matched" && upcomingPost(p))) return "a match";

  const postIds = (challenges ?? []).map((c) => c.post_id as string);
  if (postIds.length) {
    const { data: theirs } = await db.from("match_posts").select("match_date, match_time").in("id", postIds);
    if ((theirs ?? []).some(upcomingPost)) return "a match";
  }
  return null;
}

/** The screen's copy of the check, on the signed-in browser / phone client. */
export function accountDeletionCheck(userId: string): Promise<DeletionCheck> {
  return checkAccountDeletion(supabase, userId);
}

/** Delete the signed-in account. On ok the session is gone; the caller should
 *  send the person to a signed-out screen with a full navigation. */
export async function deleteOwnAccount(): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await authedPost("/api/account/delete", {});
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error ?? "Couldn't delete your account. Try again." };
    // The auth user is already gone on the server; this clears the local
    // session so nothing keeps using its token.
    await supabase.auth.signOut().catch(() => {});
    return { ok: true };
  } catch {
    return { error: "Couldn't delete your account — check your connection." };
  }
}
