// Team finance — the shapes the Team Finance screen works with, the calls it
// makes, and the pure rules (what counts as complete, how the filter sorts).
//
// docs/PAYMENT_PIVOT.md. Everything is read and written through
// /api/finance/*: the tables are server-only (supabase_team_finance.sql), so
// there is no Supabase query in this file. No React and no DOM either, so the
// phone can share it.

import { authedGet, authedPost, authedPostForm } from "@/lib/authed-fetch";

export type RequestKind = "general" | "joining_fee" | "match_fee";

export type RequestMember = {
  playerId: string;
  name: string;
  amountPence: number;
  paidPence: number;
  /** "card" through Uniter, "manual" when a leader ticked it off. */
  paidVia: "card" | "manual" | null;
  paidAt: string | null;
  remindedAt: string | null;
};

export type FinanceRequest = {
  id: string;
  kind: RequestKind;
  title: string;
  description: string | null;
  /** A short-lived signed link to the attached screenshot. */
  imageUrl: string | null;
  /** What each member was asked for (a match fee's shares can differ by a penny). */
  amountPence: number;
  dueDate: string | null;      // ISO date
  createdAt: string;           // ISO timestamp — the "send date"
  matchId: string | null;
  openMatchId: string | null;
  /** For a leader: across everyone it was sent to. For a member: their own row only. */
  memberCount: number;
  paidCount: number;
  outstandingPence: number;
  /** Everyone it was sent to — leaders only; empty for a member. */
  members: RequestMember[];
  /** The viewer's own row, if it was sent to them. */
  mine: RequestMember | null;
  /** Joining fee only: the captain is left off it. */
  captainExempt: boolean;
};

export type FinanceEntry = {
  id: string;
  kind: "adjustment" | "expense" | "spend";
  amountPence: number;         // signed: money out is negative
  note: string | null;
  createdAt: string;
};

export type FinanceAccount = {
  /** A Stripe account exists for the team. */
  linked: boolean;
  /** …and it can receive payments. */
  ready: boolean;
  /** The viewer is the person whose Stripe account it is. */
  linkedByMe: boolean;
  linkedByName: string | null;
};

export type SquadMember = { playerId: string; name: string; isCaptain: boolean };

export type FinanceDashboard = {
  /** Set when the database hasn't had supabase_team_finance.sql run. */
  setupNeeded?: string;
  isLeader: boolean;
  account: FinanceAccount;
  /** Leaders only. Tracked, not the bank's: see trackedBalanceNote. */
  balancePence: number | null;
  requests: FinanceRequest[];
  /** Leaders only. */
  entries: FinanceEntry[];
  /** Leaders only — who a new request can be sent to. */
  squad: SquadMember[];
};

export type Owed = {
  feeDuePence: number;
  feePaidPence: number;
  feeOwedPence: number;
  /** Unpaid match fees. With the joining fee, what blocks voting Available. */
  duesOwedPence: number;
  /** Unpaid requests of any other kind — never blocks anything. */
  otherOwedPence: number;
  isLeader: boolean;
  /** Leaders only: requests somebody still owes on. */
  openRequests: number;
};

export const NOTHING_OWED: Owed = {
  feeDuePence: 0, feePaidPence: 0, feeOwedPence: 0,
  duesOwedPence: 0, otherOwedPence: 0, isLeader: false, openRequests: 0,
};

export const trackedBalanceNote =
  "Paid requests, less what the team card has spent through Uniter. " +
  "Uniter can't see your bank account — set the balance to match it whenever they drift.";

/** A request can be between these two amounts per member. */
export const MIN_REQUEST_PENCE = 100;
export const MAX_REQUEST_PENCE = 50_000;

export const KIND_LABEL: Record<RequestKind, string> = {
  general: "Payment request",
  joining_fee: "Joining fee",
  match_fee: "Match fee",
};

export function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function owes(m: { amountPence: number; paidPence: number } | null | undefined): number {
  return m ? Math.max(0, m.amountPence - m.paidPence) : 0;
}

/** Nothing left to collect on it — for the viewer's own view of the request. */
export function isComplete(r: FinanceRequest): boolean {
  return r.outstandingPence === 0;
}

// ── The dashboard filter ──────────────────────────────────────────────

export type FinanceFilter = {
  show: "active" | "completed" | "all";
  sortBy: "due" | "sent";
  order: "oldest" | "newest";
};

/** The dashboard is "recent transactions", so it opens newest-sent first. */
export const DEFAULT_FILTER: FinanceFilter = { show: "all", sortBy: "sent", order: "newest" };

export function isDefaultFilter(f: FinanceFilter): boolean {
  return f.show === DEFAULT_FILTER.show && f.sortBy === DEFAULT_FILTER.sortBy && f.order === DEFAULT_FILTER.order;
}

export function applyFilter(requests: FinanceRequest[], f: FinanceFilter): FinanceRequest[] {
  const shown = requests.filter((r) =>
    f.show === "all" ? true : f.show === "completed" ? isComplete(r) : !isComplete(r));
  const dir = f.order === "oldest" ? 1 : -1;
  return [...shown].sort((a, b) => {
    if (f.sortBy === "due") {
      // A request with no due date has nothing to sort on: it goes last
      // whichever way the list runs, and falls back to when it was sent.
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate) * dir;
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
    }
    return a.createdAt.localeCompare(b.createdAt) * dir;
  });
}

// ── Calls ─────────────────────────────────────────────────────────────

type Failed = { error: string };

async function read<T>(res: Response): Promise<T | Failed> {
  try {
    const body = await res.json();
    if (!res.ok) return { error: (body as Failed)?.error ?? "Something went wrong." };
    return body as T;
  } catch {
    return { error: "Something went wrong." };
  }
}

export function failed(x: unknown): x is Failed {
  return typeof x === "object" && x !== null && typeof (x as Failed).error === "string";
}

export async function loadDashboard(teamId: string): Promise<FinanceDashboard | Failed> {
  return read<FinanceDashboard>(await authedGet(`/api/finance/dashboard?teamId=${encodeURIComponent(teamId)}`));
}

// What the signed-in player owes this team. Every availability button on a
// page asks at the same moment, so concurrent callers share one round trip —
// the IN-FLIGHT promise only, never a settled one: the answer changes the
// moment they pay (the same rule lib/availability-gate.ts keeps).
const owedInFlight = new Map<string, Promise<Owed>>();

export async function loadOwed(teamId: string | null | undefined): Promise<Owed> {
  if (!teamId) return NOTHING_OWED;
  const existing = owedInFlight.get(teamId);
  if (existing) return existing;
  const run = (async () => {
    try {
      const res = await authedGet(`/api/finance/owed?teamId=${encodeURIComponent(teamId)}`);
      // Degrades to "owes nothing": a missing migration or a failed request
      // must not lock a squad out of a vote they are entitled to.
      if (!res.ok) return NOTHING_OWED;
      return { ...NOTHING_OWED, ...(await res.json()) } as Owed;
    } catch {
      return NOTHING_OWED;
    }
  })().finally(() => owedInFlight.delete(teamId));
  owedInFlight.set(teamId, run);
  return run;
}

export type NewRequest = {
  teamId: string;
  kind: RequestKind;
  title: string;
  description?: string;
  /** Per member — general requests and the joining fee. */
  amountPence?: number;
  /** A match fee: the whole cost, split equally among `playerIds` on the server. */
  totalPence?: number;
  dueDate?: string | null;
  /** Ignored for the joining fee, which always goes to the whole squad. */
  playerIds?: string[];
  /** Joining fee only: leave the captain off it. */
  captainExempt?: boolean;
  matchId?: string | null;
  openMatchId?: string | null;
  image?: Blob | null;
};

export async function createRequest(r: NewRequest): Promise<{ requestId: string } | Failed> {
  // append, not set: React Native's FormData has no set(), and on a fresh
  // form the two do the same thing.
  const form = new FormData();
  form.append("teamId", r.teamId);
  form.append("kind", r.kind);
  form.append("title", r.title);
  if (r.description) form.append("description", r.description);
  if (r.amountPence != null) form.append("amountPence", String(r.amountPence));
  if (r.totalPence != null) form.append("totalPence", String(r.totalPence));
  if (r.dueDate) form.append("dueDate", r.dueDate);
  if (r.playerIds) form.append("playerIds", JSON.stringify(r.playerIds));
  if (r.kind === "joining_fee") form.append("captainExempt", r.captainExempt ? "true" : "false");
  if (r.matchId) form.append("matchId", r.matchId);
  if (r.openMatchId) form.append("openMatchId", r.openMatchId);
  if (r.image) form.append("image", r.image);
  return read<{ requestId: string }>(await authedPostForm("/api/finance/requests", form));
}

export type RequestAction = "mark_paid" | "mark_unpaid" | "remind" | "remove_member" | "cancel";

export async function requestAction(
  requestId: string, action: RequestAction, playerId?: string,
): Promise<{ ok: true } | Failed> {
  return read<{ ok: true }>(await authedPost("/api/finance/request-action", { requestId, action, playerId }));
}

export type PaymentStart = { clientSecret: string; sharePence: number; feePence: number; totalPence: number };

export async function startRequestPayment(requestId: string): Promise<PaymentStart | Failed> {
  return read<PaymentStart>(await authedPost("/api/finance/pay-intent", { requestId }));
}

/** Tell the server the card payment finished, so the tick doesn't wait on the webhook. */
export async function confirmRequestPayment(paymentIntentId: string): Promise<{ applied: boolean } | Failed> {
  return read<{ applied: boolean }>(await authedPost("/api/finance/confirm-payment", { paymentIntentId }));
}

export type AccountAction = "link" | "session" | "refresh" | "dashboard";

/**
 * `returnTo` is for the phone, with action "link": the app's own link
 * (uniter://…) that Stripe's hosted page should hand back to when it is done.
 * Left out, the hosted page returns to the website's Team finance.
 */
export async function accountAction(
  teamId: string, action: AccountAction, returnTo?: string,
): Promise<{ url?: string; clientSecret?: string; account?: FinanceAccount } | Failed> {
  return read<{ url?: string; clientSecret?: string; account?: FinanceAccount }>(
    await authedPost("/api/finance/account", { teamId, action, ...(returnTo ? { returnTo } : {}) }));
}

export async function setTrackedBalance(teamId: string, balancePence: number): Promise<{ balancePence: number } | Failed> {
  return read<{ balancePence: number }>(await authedPost("/api/finance/balance", { teamId, balancePence }));
}
