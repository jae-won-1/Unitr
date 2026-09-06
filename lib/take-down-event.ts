import { authedPost } from "@/lib/authed-fetch";

// Take one of Unitr's own hosted events (an open_matches row with
// organiser_admin_id set) off the feed and refund every buy-in.
//
// Thin on purpose: who may do it, what the money has to do on the way out, and
// who gets told are all decided in /api/events/take-down. `reason` is required
// — it is what each entered team is shown.
//
// Returns what came back: an error message to show whoever pressed it, or the
// outcome, whose `warning` is the case where the event went down but a refund
// didn't (a missing migration, a ledger that wouldn't take the write) — the
// admin needs to know that even though nothing they can press will fix it.
export type EventTakeDownResult = {
  refundedPence: number;
  refundedTeams: number;
  alreadyDown: boolean;
  warning?: string;
};

export async function takeDownEvent(
  openMatchId: string, reason: string,
): Promise<{ error: string } | { result: EventTakeDownResult }> {
  try {
    const res = await authedPost("/api/events/take-down", { openMatchId, reason });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error ?? "Couldn't take that event down." };
    const b = body as Partial<EventTakeDownResult>;
    return {
      result: {
        refundedPence: b.refundedPence ?? 0,
        refundedTeams: b.refundedTeams ?? 0,
        alreadyDown: Boolean(b.alreadyDown),
        warning: b.warning,
      },
    };
  } catch {
    return { error: "Couldn't take that event down — check your connection." };
  }
}
