import { authedPost } from "@/lib/authed-fetch";

// Handing the team to a co-captain. The captain stays in the squad as an
// ordinary player; the co-captain becomes the captain, with everything filed
// under the captain's id re-filed under theirs (hand_over_team in
// supabase_account_deletion.sql). It runs on the server because
// teams.captain_id is immutable from a browser session.
//
// It exists so a captain can delete their account (/api/account/delete
// refuses a captain), but works at any time from Team Settings.

export async function handOverTeam(
  teamId: string, toPlayerId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await authedPost("/api/team/hand-over", { teamId, toPlayerId });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error ?? "Couldn't hand the team over. Try again." };
    return { ok: true };
  } catch {
    return { error: "Couldn't hand the team over — check your connection." };
  }
}
