import type { SupabaseClient } from "@supabase/supabase-js";
import { isKickoffPast } from "@/lib/match-dates";

// What a membership had answered for games that haven't happened, withdrawn
// when the membership ends. Two callers: leaving a squad (lib/leave-team.ts,
// the player's own browser session) and deleting an account
// (/api/account/delete, the service key) — so the client is a parameter.
//
// Answers for games already played are left alone: they are the record of who
// played, which Settle Payments reads. Money is never touched here.

// The fixtures this player answered for that haven't kicked off yet. Both
// shapes of answer live in match_confirmations — a friendly against match_id,
// a tournament entry against open_match_id — so both are resolved to a date
// and the past ones left alone.
export async function withdrawFutureAnswers(db: SupabaseClient, teamId: string, playerId: string): Promise<void> {
  const { data: rows, error } = await db
    .from("match_confirmations")
    .select("id, match_id, open_match_id")
    .eq("team_id", teamId)
    .eq("player_id", playerId);
  if (error || !rows || rows.length === 0) return;

  const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))] as string[];
  const openIds = [...new Set(rows.map((r) => r.open_match_id).filter(Boolean))] as string[];

  const [matchRes, openRes] = await Promise.all([
    matchIds.length
      ? db.from("matches").select("id, match_date, match_time").in("id", matchIds)
      : Promise.resolve({ data: [] as { id: string; match_date: string; match_time: string }[] }),
    openIds.length
      ? db.from("open_matches").select("id, match_date, start_time").in("id", openIds)
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
    await db.from("match_confirmations").delete().in("id", doomed);
  }
}

// The live poll's answers. A poll is about dates the captain is still choosing
// between, so a leaver's picks are never history — they're an offer to play
// that no longer stands.
export async function withdrawPollAnswers(db: SupabaseClient, teamId: string, playerId: string): Promise<void> {
  const { data: polls } = await db
    .from("availability_requests").select("id").eq("team_id", teamId);
  const ids = (polls ?? []).map((p) => p.id as string);
  if (ids.length === 0) return;
  await db.from("availability_responses")
    .delete().eq("player_id", playerId).in("request_id", ids);
}
