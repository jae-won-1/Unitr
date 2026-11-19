// Entering an event on linked finance — the client side of the three calls
// /api/tournaments/join takes (see the route and lib/event-entry-server.ts).
// Shared by the web's EnterTournamentPanel and the phone's entry sheet: no
// React, no DOM, no Stripe SDK. Each app finishes a bank approval with its own
// Stripe library and then calls finishEntry.

import { authedPost } from "@/lib/authed-fetch";

export type EntryTarget = { openMatchId: string; teamId: string; teamName: string | null };

export type EntryTotals = { buyInPence: number; feePence: number; totalPence: number };

export type EntryAnswer =
  /** The team is in. */
  | { kind: "entered"; totalPence: number }
  /** Paid; the entry is recorded the moment the payment lands (webhook). */
  | { kind: "processing" }
  /** What it will cost, and the card it goes on. Nothing charged. */
  | { kind: "quote"; totals: EntryTotals; card: { brand: string | null; last4: string | null } | null }
  /** No team card saved yet. */
  | { kind: "needs_card"; error: string; totals: EntryTotals }
  /** The bank wants the leader to approve the charge in their app. */
  | { kind: "needs_action"; clientSecret: string; paymentIntentId: string }
  /** Refused — the reason is a sentence for the screen. `refunded` when the
   *  card was charged and has been given its money back. */
  | { kind: "refused"; error: string; refunded?: boolean };

type Body = Record<string, unknown>;

async function call(target: EntryTarget, extra: Body): Promise<EntryAnswer> {
  let res: Response;
  try {
    res = await authedPost("/api/tournaments/join", {
      openMatchId: target.openMatchId, teamId: target.teamId, teamName: target.teamName, ...extra,
    });
  } catch {
    return { kind: "refused", error: "Couldn't reach Uniter. Check your connection and try again." };
  }
  const d = (await res.json().catch(() => ({}))) as Body;
  const totals: EntryTotals = {
    buyInPence: Number(d.buyInPence ?? 0), feePence: Number(d.feePence ?? 0), totalPence: Number(d.totalPence ?? 0),
  };
  if (d.code === "NO_TEAM_CARD") return { kind: "needs_card", error: String(d.error), totals };
  if (!res.ok) {
    return { kind: "refused", error: String(d.error ?? "Couldn't enter the tournament. Please try again."), refunded: d.refunded === true };
  }
  if (d.quote) {
    return { kind: "quote", totals, card: (d.card as { brand: string | null; last4: string | null } | null) ?? null };
  }
  if (d.requiresAction && typeof d.clientSecret === "string" && typeof d.paymentIntentId === "string") {
    return { kind: "needs_action", clientSecret: d.clientSecret, paymentIntentId: d.paymentIntentId };
  }
  if (d.processing) return { kind: "processing" };
  return { kind: "entered", totalPence: totals.totalPence };
}

/** Step 1 — the price and the card. Charges nothing. */
export function quoteEntry(target: EntryTarget): Promise<EntryAnswer> {
  return call(target, { quote: true });
}

/** Step 2 — charge the team card. Usually ends "entered". */
export function payEntry(target: EntryTarget): Promise<EntryAnswer> {
  return call(target, {});
}

/** Step 3 — after the bank's approval, record the entry. Safe to repeat. */
export function finishEntry(target: EntryTarget, paymentIntentId: string): Promise<EntryAnswer> {
  return call(target, { paymentIntentId });
}
