import { authedPost } from "@/lib/authed-fetch";

// Remove one team from one of Uniter's own hosted events and refund its buy-in.
//
// Thin on purpose, exactly like lib/take-down-event.ts: who may do it, what the
// money has to do on the way out, and who gets told are all decided in
// /api/events/kick-team. `reason` is required — it is what the removed team's
// captain is shown.
//
// Unlike a take-down there is no partial outcome to report: the route refunds
// before it removes and refuses the removal outright if the money couldn't go
// back, so either the team is out and paid back, or nothing happened.
export type KickTeamResult = {
  refundedPence: number;
  teamName: string;
};

export async function kickTeamFromEvent(
  openMatchId: string, teamId: string, reason: string,
): Promise<{ error: string } | { result: KickTeamResult }> {
  try {
    const res = await authedPost("/api/events/kick-team", { openMatchId, teamId, reason });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error ?? "Couldn't remove that team." };
    const b = body as Partial<KickTeamResult>;
    return {
      result: {
        refundedPence: b.refundedPence ?? 0,
        teamName: b.teamName ?? "That team",
      },
    };
  } catch {
    return { error: "Couldn't remove that team — check your connection." };
  }
}
