import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { LINKED_FINANCE } from "@/lib/finance-mode";

// Server half of team finance (docs/PAYMENT_PIVOT.md). Only the /api/finance/*
// routes and the Stripe webhook import this — it reads and writes the
// server-only tables of supabase_team_finance.sql on the service key.

/** Which Stripe mode the server's key is in. A team's test and live linked
 *  accounts are separate rows, because local development runs a test key
 *  against the live database (lib/stripe-mode.ts). */
export const STRIPE_LIVEMODE = !(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");

/** The refusal every finance route opens with while the switch is off, so an
 *  unfinished payment system can't be driven by hand on the live site. */
export function financeOff(): NextResponse | null {
  if (LINKED_FINANCE) return null;
  return NextResponse.json({ error: "Team finance isn't switched on yet." }, { status: 503 });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SquadRow = { playerId: string; name: string; isCaptain: boolean };

/** The captain plus every approved member — who a request can be sent to. */
export async function loadSquad(teamId: string): Promise<SquadRow[]> {
  const [{ data: team }, { data: members }] = await Promise.all([
    adminSupabase.from("teams").select("captain_id").eq("id", teamId).maybeSingle(),
    adminSupabase.from("team_members").select("player_id").eq("team_id", teamId).eq("status", "approved"),
  ]);
  const ids = [...new Set([
    ...(team?.captain_id ? [team.captain_id as string] : []),
    ...(members ?? []).map((m) => m.player_id as string),
  ])];
  if (ids.length === 0) return [];
  const names = await loadNames(ids);
  return ids
    .map((id) => ({ playerId: id, name: names.get(id) ?? "Player", isCaptain: id === team?.captain_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await adminSupabase.from("profiles").select("id, full_name").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "Player"]));
}

export type FinanceAccountRow = {
  team_id: string;
  stripe_account_id: string;
  linked_by: string;
  details_submitted: boolean;
  transfers_active: boolean;
  payouts_enabled: boolean;
};

/** The team's linked Stripe account in the server's current mode, if any. */
export async function loadFinanceAccount(teamId: string): Promise<FinanceAccountRow | null> {
  const { data } = await adminSupabase
    .from("team_finance_accounts")
    .select("team_id, stripe_account_id, linked_by, details_submitted, transfers_active, payouts_enabled")
    .eq("team_id", teamId).eq("livemode", STRIPE_LIVEMODE).maybeSingle();
  return (data as FinanceAccountRow | null) ?? null;
}

/** Paid requests plus every adjustment, expense and team-card spend. */
export async function trackedBalancePence(teamId: string): Promise<number> {
  const [{ data: paid }, { data: entries }] = await Promise.all([
    adminSupabase.from("payment_request_members").select("paid_pence").eq("team_id", teamId),
    adminSupabase.from("team_finance_entries").select("amount_pence").eq("team_id", teamId),
  ]);
  return (paid ?? []).reduce((sum, r) => sum + ((r.paid_pence as number) ?? 0), 0)
    + (entries ?? []).reduce((sum, r) => sum + ((r.amount_pence as number) ?? 0), 0);
}

/**
 * Record a succeeded card payment against the request it paid.
 *
 * Called by the Stripe webhook and by /api/finance/confirm-payment, whichever
 * hears first; apply_request_payment is idempotent on the intent id, so the
 * second is a no-op. Everything is read off the intent's metadata, which
 * /api/finance/pay-intent wrote from the caller's session and the database —
 * never from a request body.
 *
 * Throws only when the database refused, so the webhook can ask Stripe to
 * redeliver.
 */
export async function applyRequestPayment(
  pi: Stripe.PaymentIntent,
): Promise<"applied" | "already" | "not_a_request"> {
  if (pi.metadata?.type !== "payment_request") return "not_a_request";
  const memberId = pi.metadata.memberId;
  const sharePence = Number(pi.metadata.sharePence);
  const feePence = Number(pi.metadata.feePence) || 0;
  if (!memberId || !UUID.test(memberId) || !Number.isInteger(sharePence) || sharePence <= 0) {
    console.error(`team-finance: ${pi.id} is a payment_request with unusable metadata`);
    return "not_a_request";
  }

  const { data, error } = await adminSupabase.rpc("apply_request_payment", {
    p_member_id: memberId,
    p_payment_intent_id: pi.id,
    p_amount_pence: sharePence,
    p_fee_pence: feePence,
  });
  if (error) throw new Error(`apply_request_payment failed for ${pi.id}: ${error.message}`);
  return data === true ? "applied" : "already";
}

/** A direct message from a leader to a squad member. Best effort: a failed
 *  message must not undo the request it was announcing. */
export async function sendFinanceMessages(
  senderId: string,
  rows: { receiverId: string; body: string }[],
): Promise<void> {
  const out = rows.filter((r) => r.receiverId !== senderId);
  if (out.length === 0) return;
  const { error } = await adminSupabase.from("messages").insert(
    out.map((r) => ({ sender_id: senderId, receiver_id: r.receiverId, type: "payment_reminder", body: r.body })),
  );
  if (error) console.error("team-finance: message failed:", error.message);
}
