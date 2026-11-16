import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { seedAvailabilityFromPoll, squadPlayerIds } from "@/lib/event-availability";
import { teamCategoryRefusal } from "@/lib/gender-entry";
import { feeOnTop } from "@/lib/payment-fee";
import { loadFinanceAccount } from "@/lib/team-finance-server";

// Entering an event, paid by card — the linked-finance half of
// /api/tournaments/join (docs/PAYMENT_PIVOT.md, step 2). Server only.
//
// On team credit the buy-in is debited from a balance Uniter holds. Here there
// is no balance: a leader pays the buy-in by card as they enter, the fee is
// added on top (lib/payment-fee.ts), and where the money goes is part of the
// charge itself —
//
//   Uniter's own event   an ordinary sale by Uniter; nothing is transferred
//   a venue's event      the venue's Stripe account is the charge's destination
//   a team's event       the host team's linked account is the destination
//
// so nothing rests with Uniter on anyone's behalf. Two steps, the shape
// /api/book/pitch already uses: `priceEventEntry` checks the entry and prices
// it for a PaymentIntent whose metadata names exactly this event and team;
// `finalizeEventEntry` runs once that intent has succeeded — from the route
// when the payer's app says so, and from the Stripe webhook in case the app
// never gets the chance. It is idempotent, and it refunds the card if the
// event filled up or was cancelled while the payer was typing their card in.
//
// Every amount comes from the database. The only thing a caller supplies is
// which event and which team.

type EventRow = {
  id: string;
  pitch_id: string | null;
  price_per_team_pence: number | null;
  max_teams: number;
  status: string;
  title: string | null;
  match_date: string;
  start_time: string | null;
  organiser_team_id: string | null;
  organiser_admin_id: string | null;
};

type InviteRow = { id: string; discount_pence: number | null; status: string };

export type EntryHost = "admin" | "venue" | "team";

export type EntryPrice = {
  event: EventRow;
  invite: InviteRow | null;
  /** How many teams were entered when this was read. */
  joinedCount: number;
  buyInPence: number;
  feePence: number;
  totalPence: number;
  host: EntryHost;
  /** The Stripe account the buy-in is transferred to; null for Uniter's own event. */
  destination: string | null;
};

export type EntryRefusal = { refusal: string; status: number };

const refuse = (refusal: string, status = 409): EntryRefusal => ({ refusal, status });

export function isRefusal(x: EntryPrice | EntryRefusal): x is EntryRefusal {
  return typeof (x as EntryRefusal).refusal === "string";
}

async function loadEvent(openMatchId: string): Promise<EventRow | null> {
  const { data } = await adminSupabase
    .from("open_matches")
    .select("id, pitch_id, price_per_team_pence, max_teams, status, title, match_date, start_time, organiser_team_id, organiser_admin_id")
    .eq("id", openMatchId)
    .maybeSingle();
  return (data as EventRow | null) ?? null;
}

/** May this team enter this event, and what does it cost? Moves nothing. */
export async function priceEventEntry(openMatchId: string, teamId: string): Promise<EntryPrice | EntryRefusal> {
  const event = await loadEvent(openMatchId);
  if (!event) return refuse("Tournament not found", 404);
  if (event.status === "cancelled") return refuse("This tournament has been cancelled.");

  // Men's teams enter men's events, women's teams women's — before any money.
  const wrongCategory = await teamCategoryRefusal(teamId, { table: "open_matches", id: openMatchId });
  if (wrongCategory) return refuse(wrongCategory);

  const { data: joined } = await adminSupabase
    .from("open_match_teams").select("team_id").eq("open_match_id", openMatchId);
  const joinedTeams = joined ?? [];
  if (joinedTeams.some((t) => t.team_id === teamId)) return refuse("Your team has already entered this tournament.");
  if (joinedTeams.length >= event.max_teams) return refuse("This tournament is full.");

  // A pending invitation's discount is authoritative here; the app only shows it.
  const { data: inviteRow } = await adminSupabase
    .from("tournament_invitations")
    .select("id, discount_pence, status")
    .eq("open_match_id", openMatchId).eq("team_id", teamId).maybeSingle();
  const invite = (inviteRow as InviteRow | null) ?? null;
  const discount = invite && invite.status === "pending" ? Math.round(invite.discount_pence ?? 0) : 0;
  const buyInPence = Math.max(0, Math.round(event.price_per_team_pence ?? 0) - discount);

  // Who is being paid.
  let host: EntryHost = "venue";
  let destination: string | null = null;
  if (event.organiser_admin_id) {
    host = "admin";
  } else if (event.organiser_team_id) {
    host = "team";
    if (event.organiser_team_id === teamId) {
      // A host fielding its own team pays no buy-in; that entry is the
      // enter_own_tournament RPC, not a purchase.
      return refuse("Your team hosts this tournament — enter it from the tournament page.");
    }
    if (buyInPence > 0) {
      const account = await loadFinanceAccount(event.organiser_team_id);
      if (!account?.transfers_active) {
        return refuse("The host team hasn't linked a bank account yet, so it can't take entries by card.");
      }
      destination = account.stripe_account_id;
    }
  } else if (buyInPence > 0) {
    const { data: pitch } = event.pitch_id
      ? await adminSupabase.from("pitches").select("stripe_account_id, payouts_enabled").eq("id", event.pitch_id).maybeSingle()
      : { data: null };
    if (!pitch?.stripe_account_id || !pitch.payouts_enabled) {
      return refuse("This venue isn't set up to take card payments yet.");
    }
    destination = pitch.stripe_account_id as string;
  }

  const feePence = feeOnTop(buyInPence);
  return {
    event, invite, joinedCount: joinedTeams.length,
    buyInPence, feePence, totalPence: buyInPence + feePence, host, destination,
  };
}

/**
 * Everything an entry sets in motion once the team is in, whichever way it
 * paid: mark the event full on the last spot, use up the invitation, and ask
 * the squad whether they can play (keyed off open_match_id — a tournament has
 * no matches row). All best-effort: the team is already entered and paid, and
 * a database missing a migration must not fail the entry.
 */
export async function afterEventEntry(args: {
  event: { id: string; max_teams: number; match_date: string; start_time: string | null };
  teamId: string;
  userId: string;
  /** Teams entered BEFORE this one. */
  joinedBefore: number;
  invite: { id: string; status: string } | null;
}): Promise<void> {
  const { event, teamId, userId, joinedBefore, invite } = args;

  if (joinedBefore + 1 >= event.max_teams) {
    await adminSupabase.from("open_matches").update({ status: "full" }).eq("id", event.id);
  }
  // Accepted, so its discount can't be used twice.
  if (invite && invite.status === "pending") {
    await adminSupabase.from("tournament_invitations").update({ status: "accepted" }).eq("id", invite.id);
  }

  try {
    const squad = await squadPlayerIds(adminSupabase, teamId, userId);
    if (squad.length > 0) {
      // A team that left and re-entered still has its old rows, and the
      // partial unique index would reject the whole insert over one of them.
      const { data: already } = await adminSupabase
        .from("match_confirmations").select("player_id")
        .eq("open_match_id", event.id).in("player_id", squad);
      const answered = new Set((already ?? []).map((r) => r.player_id as string));
      const missing = squad.filter((pid) => !answered.has(pid));
      if (missing.length > 0) {
        await adminSupabase.from("match_confirmations").insert(
          missing.map((pid) => ({ open_match_id: event.id, player_id: pid, team_id: teamId, status: "pending" })),
        );
      }
      await seedAvailabilityFromPoll(adminSupabase, {
        teamId,
        target: { openMatchId: event.id },
        date: event.match_date,
        time: event.start_time ?? "",
        playerIds: squad,
      });
    }
  } catch (err) {
    console.error("event entry: availability seed failed:", err);
  }
}

export type EntryOutcome =
  | { status: "entered" | "already"; buyInPence: number; totalPence: number }
  /** Paid, but the entry couldn't stand — the card has been refunded. */
  | { status: "refunded"; reason: string }
  | { status: "not_an_entry" };

/** The card is refunded in full: the entry it paid for didn't happen. */
async function refundUnusedEntry(pi: Stripe.PaymentIntent, reason: string): Promise<EntryOutcome> {
  await stripe.refunds.create(
    {
      payment_intent: pi.id,
      // A destination charge: take the transfer back from the host, and give
      // the payer their fee back too — nothing was sold.
      ...(pi.transfer_data?.destination ? { reverse_transfer: true, refund_application_fee: true } : {}),
      metadata: { type: "event_entry_unused", openMatchId: pi.metadata.openMatchId ?? "", teamId: pi.metadata.teamId ?? "" },
    },
    { idempotencyKey: `entry-unused-${pi.id}` },
  );
  return { status: "refunded", reason };
}

/**
 * Record the entry a succeeded PaymentIntent paid for.
 *
 * Idempotent: the route and the webhook both call it, and a team can only be
 * entered once (open_match_teams is unique on event + team). Reads everything
 * from the intent's metadata, which /api/tournaments/join wrote from the
 * caller's session and the database.
 *
 * Throws only when Stripe or the database failed in a way a retry could fix,
 * so the webhook can ask for redelivery.
 */
export async function finalizeEventEntry(pi: Stripe.PaymentIntent): Promise<EntryOutcome> {
  if (pi.metadata?.type !== "event_entry") return { status: "not_an_entry" };
  const { openMatchId, teamId, userId, teamName } = pi.metadata;
  const buyInPence = Number(pi.metadata.buyInPence);
  if (!openMatchId || !teamId || !userId || !Number.isInteger(buyInPence)) {
    console.error(`event entry: ${pi.id} has unusable metadata`);
    return { status: "not_an_entry" };
  }
  const totalPence = pi.amount_received || pi.amount;

  const { data: existing } = await adminSupabase
    .from("open_match_teams").select("id")
    .eq("open_match_id", openMatchId).eq("team_id", teamId).maybeSingle();
  if (existing) {
    // Entered already. If THIS intent is the one on record, this is a repeat
    // call and there is nothing to do. If another paid for it, this one bought
    // nothing — two leaders paying at once — and goes back.
    const { data: spend } = await adminSupabase
      .from("team_finance_entries").select("stripe_payment_intent_id")
      .eq("team_id", teamId).eq("open_match_id", openMatchId).eq("kind", "spend").lt("amount_pence", 0);
    const paidByThis = (spend ?? []).some((s) => s.stripe_payment_intent_id === pi.id);
    if (paidByThis || (spend ?? []).length === 0) return { status: "already", buyInPence, totalPence };
    return refundUnusedEntry(pi, "Your team was already entered, so this payment has been refunded.");
  }

  const event = await loadEvent(openMatchId);
  if (!event || event.status === "cancelled") {
    return refundUnusedEntry(pi, "This tournament was cancelled before your entry went through. Your card has been refunded.");
  }
  const { data: joined } = await adminSupabase
    .from("open_match_teams").select("team_id").eq("open_match_id", openMatchId);
  const joinedBefore = (joined ?? []).length;
  if (joinedBefore >= event.max_teams) {
    return refundUnusedEntry(pi, "The last place went while you were paying. Your card has been refunded.");
  }

  const { error: joinErr } = await adminSupabase.from("open_match_teams").insert({
    open_match_id: openMatchId,
    team_id: teamId,
    team_name: teamName ?? "",
    joined_by: userId,
    payment_status: "paid",
  });
  if (joinErr) {
    // 23505: the other caller (route vs webhook) got there first — same intent.
    if (joinErr.code === "23505") return { status: "already", buyInPence, totalPence };
    // The category trigger, or anything else the database refuses: the entry
    // can't stand, so the money goes back.
    console.error(`event entry: insert refused for ${pi.id}:`, joinErr.message);
    return refundUnusedEntry(pi, "Your team couldn't be entered, so your card has been refunded.");
  }

  // The record of what was paid: the tracked balance, Settle match fees and
  // the refund on a take-down all read this row. Server-only table.
  const { error: spendErr } = await adminSupabase.from("team_finance_entries").insert({
    team_id: teamId,
    kind: "spend",
    amount_pence: -totalPence,
    note: `Entry — ${event.title || "Tournament"}`,
    created_by: userId,
    open_match_id: openMatchId,
    stripe_payment_intent_id: pi.id,
  });
  if (spendErr) console.error(`event entry: spend row failed for ${pi.id}:`, spendErr.message);

  const inviteId = pi.metadata.inviteId;
  await afterEventEntry({
    event, teamId, userId, joinedBefore,
    invite: inviteId ? { id: inviteId, status: "pending" } : null,
  });

  return { status: "entered", buyInPence, totalPence };
}

/**
 * Give a team its entry money back, to the card that paid — for a take-down or
 * a removed team. Returns the pence refunded (0 when the entry cost nothing or
 * was already refunded). Idempotent on the intent: Stripe refuses a second
 * refund of the same payment under the same key, and the balance row is only
 * written once.
 *
 * Uniter's own events only (the two routes that call it refuse any other), so
 * there is no transfer to reverse.
 */
export async function refundEventEntryToCard(
  teamId: string, openMatchId: string, actorId: string,
): Promise<number> {
  const { data: rows, error } = await adminSupabase
    .from("team_finance_entries")
    .select("id, amount_pence, stripe_payment_intent_id, note")
    .eq("team_id", teamId).eq("open_match_id", openMatchId).eq("kind", "spend");
  if (error) throw new Error(`refund lookup failed: ${error.message}`);

  const paid = (rows ?? []).filter((r) => (r.amount_pence as number) < 0 && r.stripe_payment_intent_id);
  const refunded = new Set(
    (rows ?? []).filter((r) => (r.amount_pence as number) > 0).map((r) => r.stripe_payment_intent_id as string),
  );

  let total = 0;
  for (const row of paid) {
    const intentId = row.stripe_payment_intent_id as string;
    if (refunded.has(intentId)) continue;
    const pence = Math.abs(row.amount_pence as number);
    await stripe.refunds.create(
      { payment_intent: intentId, metadata: { type: "event_entry_refund", openMatchId, teamId, actorId } },
      { idempotencyKey: `entry-refund-${intentId}` },
    );
    const { error: backErr } = await adminSupabase.from("team_finance_entries").insert({
      team_id: teamId,
      kind: "spend",
      amount_pence: pence,
      note: `Refund — ${String(row.note ?? "entry").replace(/^Entry — /, "")}`,
      created_by: actorId,
      open_match_id: openMatchId,
      stripe_payment_intent_id: intentId,
    });
    if (backErr) console.error(`event entry: refund row failed for ${intentId}:`, backErr.message);
    total += pence;
  }
  return total;
}
