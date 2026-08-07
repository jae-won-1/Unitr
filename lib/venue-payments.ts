import { supabase } from "@/lib/supabase";

// ── Venue-side payment truth ──────────────────────────────────────────────
// `pitch_bookings.payment_status` is what the venue portal used to display, but
// it is only ever written at booking time. Everything that pays for a pitch
// AFTER the row is created — a match being confirmed (both teams' credit is
// split), a team buying into a tournament, a secured pitch being converted —
// left it saying "Unpaid" forever.
//
// This module reconstructs what actually happened from the ledgers that do get
// written, and is the single source both the venue calendar and bookings list
// read from:
//
//   player_payments          a card charge against the booking
//   venue_transfers          the Connect payout Unitr sent the venue
//   team_credit_transactions the credit debit at match confirmation / direct book
//   open_match_teams         which teams bought into a listing, and for how much
//
// A tournament is the case the old code couldn't express at all: one booking,
// many payers, arriving one at a time. Those bookings carry `entries` and are
// "part paid" until the last spot is sold.
//
// Every query here degrades: a missing table or a column from an unrun
// migration falls back rather than wiping out the whole payment picture.

export type VenueBookingRef = {
  id: string;
  booking_type: string;
  payment_status?: string | null;
  total_price_pence?: number | null;
  per_player_pence?: number | null;
  player_count?: number | null;
  post_id?: string | null;
  stripe_payment_intent_id?: string | null;
};

export type PaymentPayer = { name: string; amountPence: number; paid: boolean };

export type BookingPayment = {
  // "part_paid" only ever applies to a multi-payer listing (tournament / open match).
  status: "paid" | "part_paid" | "unpaid" | "reception" | "after_match";
  collectedPence: number;
  expectedPence: number;
  // Present for open_matches listings — how many teams have bought in so far.
  entries?: { joined: number; max: number; pricePerTeamPence: number };
  payers: PaymentPayer[];
  // One line the venue can read: how this was paid, or what's outstanding.
  detail: string;
  // True when the payout to this venue's Connect account failed — the customer
  // paid, but the cash hasn't landed. Worth flagging separately from "unpaid".
  payoutFailed: boolean;
};

const PAID_STORED = new Set(["paid"]);

export function expectedPenceFor(b: VenueBookingRef): number {
  if (b.total_price_pence && b.total_price_pence > 0) return b.total_price_pence;
  if (b.per_player_pence && b.player_count) return b.per_player_pence * b.player_count;
  return 0;
}

// Batched: one round of queries for the whole booking list, not one per row.
export async function loadBookingPayments(
  bookings: VenueBookingRef[]
): Promise<Map<string, BookingPayment>> {
  const out = new Map<string, BookingPayment>();
  if (bookings.length === 0) return out;

  const ids = bookings.map((b) => b.id);
  const postIds = bookings.map((b) => b.post_id).filter(Boolean) as string[];

  const [{ data: oms }, { data: pays }, { data: matches }] = await Promise.all([
    supabase.from("open_matches")
      .select("id, booking_id, match_type, price_per_team_pence, max_teams")
      .in("booking_id", ids)
      .then((r) => (r.error ? { data: [] } : r)),
    supabase.from("player_payments")
      .select("booking_id, status, total_pence, amount_pence, purpose")
      .in("booking_id", ids)
      .then(async (r) => r.error
        // `purpose` arrived with supabase_payment_collection.sql; without it,
        // read what exists and treat every row as a venue-side payment.
        ? { data: ((await supabase.from("player_payments").select("booking_id, status, total_pence, amount_pence").in("booking_id", ids)).data ?? [])
            .map((p) => ({ ...p, purpose: null as string | null })) }
        : r),
    postIds.length
      ? supabase.from("matches").select("id, post_id").in("post_id", postIds).then((r) => (r.error ? { data: [] } : r))
      : Promise.resolve({ data: [] as { id: string; post_id: string }[] }),
  ]);

  const omRows = (oms ?? []) as { id: string; booking_id: string; match_type: string; price_per_team_pence: number; max_teams: number }[];
  const omByBooking = new Map(omRows.map((o) => [o.booking_id, o]));
  const omIds = omRows.map((o) => o.id);
  const matchIds = ((matches ?? []) as { id: string; post_id: string }[]).map((m) => m.id);
  const matchIdByPost = new Map(((matches ?? []) as { id: string; post_id: string }[]).map((m) => [m.post_id, m.id]));

  // venue_transfers: keyed by booking for single-payer bookings, by open_match
  // for tournaments (many teams share one reservation, so there's no booking_id
  // on those rows). team_id/open_match_id come from supabase_venue_payouts.sql.
  const transfers = await (async () => {
    const full = await supabase.from("venue_transfers")
      .select("booking_id, open_match_id, team_id, status, amount_pence")
      .or([
        `booking_id.in.(${ids.join(",")})`,
        ...(omIds.length ? [`open_match_id.in.(${omIds.join(",")})`] : []),
      ].join(","));
    if (!full.error) return (full.data ?? []) as { booking_id: string | null; open_match_id: string | null; team_id: string | null; status: string; amount_pence: number }[];
    const legacy = await supabase.from("venue_transfers")
      .select("booking_id, status, amount_pence").in("booking_id", ids);
    return ((legacy.data ?? []) as { booking_id: string; status: string; amount_pence: number }[])
      .map((t) => ({ ...t, open_match_id: null, team_id: null }));
  })();

  // Teams that bought into each listing — the payers behind a tournament booking.
  const { data: entered } = omIds.length
    ? await supabase.from("open_match_teams")
        .select("open_match_id, team_id, team_name, payment_status").in("open_match_id", omIds)
        .then((r) => (r.error ? { data: [] } : r))
    : { data: [] as { open_match_id: string; team_id: string; team_name: string; payment_status: string | null }[] };

  // Credit debits: the pitch fee leaving team credit at match confirmation
  // (match_id) or on a direct booking (booking_id) is the payment for bookings
  // that never see a card.
  // Kept as two queries rather than one `.or()`: booking_id was added to the
  // ledger later than match_id, and a single query would lose both if that
  // column isn't there.
  type CreditRow = { booking_id: string | null; match_id: string | null; amount_pence: number; type: string };
  const [byBooking, byMatch] = await Promise.all([
    supabase.from("team_credit_transactions").select("booking_id, amount_pence, type").in("booking_id", ids)
      .then((r) => (r.error ? [] : (r.data ?? []).map((c) => ({ ...c, match_id: null })) as CreditRow[])),
    matchIds.length
      ? supabase.from("team_credit_transactions").select("match_id, amount_pence, type").in("match_id", matchIds)
          .then((r) => (r.error ? [] : (r.data ?? []).map((c) => ({ ...c, booking_id: null })) as CreditRow[]))
      : Promise.resolve([] as CreditRow[]),
  ]);
  const creditCaptures = [...byBooking, ...byMatch];

  // ── Index everything ──
  const cardPaidByBooking = new Map<string, number>();
  for (const p of (pays ?? []) as { booking_id: string; status: string; total_pence: number | null; amount_pence: number | null; purpose: string | null }[]) {
    // 'replenish' rows are players refilling their OWN team's credit after the
    // fact — that money never reaches the venue, so it can't mark a booking paid.
    if (p.status !== "paid" || p.purpose === "replenish") continue;
    cardPaidByBooking.set(p.booking_id, (cardPaidByBooking.get(p.booking_id) ?? 0) + (p.total_pence ?? p.amount_pence ?? 0));
  }

  const payoutByBooking = new Map<string, { paid: number; failed: boolean }>();
  const payoutByOm = new Map<string, { paid: number; failed: boolean; teams: Set<string> }>();
  for (const t of transfers) {
    if (t.booking_id) {
      const cur = payoutByBooking.get(t.booking_id) ?? { paid: 0, failed: false };
      if (t.status === "paid") cur.paid += t.amount_pence ?? 0; else if (t.status === "failed") cur.failed = true;
      payoutByBooking.set(t.booking_id, cur);
    }
    if (t.open_match_id) {
      const cur = payoutByOm.get(t.open_match_id) ?? { paid: 0, failed: false, teams: new Set<string>() };
      if (t.status === "paid") { cur.paid += t.amount_pence ?? 0; if (t.team_id) cur.teams.add(t.team_id); }
      else if (t.status === "failed") cur.failed = true;
      payoutByOm.set(t.open_match_id, cur);
    }
  }

  const enteredByOm = new Map<string, { team_id: string; team_name: string; payment_status: string | null }[]>();
  for (const row of (entered ?? []) as { open_match_id: string; team_id: string; team_name: string; payment_status: string | null }[]) {
    const list = enteredByOm.get(row.open_match_id) ?? [];
    list.push(row);
    enteredByOm.set(row.open_match_id, list);
  }

  const creditByBooking = new Map<string, number>();
  const creditByMatch = new Map<string, number>();
  for (const c of creditCaptures) {
    if (c.type !== "booking_capture") continue;
    const spent = Math.abs(c.amount_pence ?? 0);
    if (c.booking_id) creditByBooking.set(c.booking_id, (creditByBooking.get(c.booking_id) ?? 0) + spent);
    if (c.match_id) creditByMatch.set(c.match_id, (creditByMatch.get(c.match_id) ?? 0) + spent);
  }

  // ── Resolve each booking ──
  for (const b of bookings) {
    const stored = b.payment_status ?? "unpaid";
    const expected = expectedPenceFor(b);
    const om = omByBooking.get(b.id);

    if (om) {
      // Multi-payer listing: teams buy in one at a time.
      const teams = enteredByOm.get(om.id) ?? [];
      const price = om.price_per_team_pence ?? 0;
      const payout = payoutByOm.get(om.id);
      const paidTeams = teams.filter((t) => (t.payment_status ?? "paid") !== "unpaid");
      // Prefer the payout ledger's actual amounts; fall back to buy-in × entries
      // when the payout columns aren't in the DB yet or a transfer failed.
      const collected = payout && payout.paid > 0 ? payout.paid : paidTeams.length * price;
      const expectedTotal = price * (om.max_teams || teams.length || 1);
      const full = teams.length >= (om.max_teams || 0) && paidTeams.length === teams.length;

      out.set(b.id, {
        status: teams.length === 0
          ? (stored === "paid" ? "paid" : stored === "reception" ? "reception" : stored === "after_match" ? "after_match" : "unpaid")
          : full ? "paid" : "part_paid",
        collectedPence: collected,
        expectedPence: expectedTotal,
        entries: { joined: teams.length, max: om.max_teams ?? 0, pricePerTeamPence: price },
        payers: teams.map((t) => ({
          name: t.team_name,
          amountPence: price,
          paid: (t.payment_status ?? "paid") !== "unpaid",
        })),
        detail: teams.length === 0
          ? `No teams entered yet · £${(price / 100).toFixed(2)} per team`
          : `${teams.length}/${om.max_teams} team${teams.length === 1 ? "" : "s"} entered · £${(collected / 100).toFixed(2)} of £${(expectedTotal / 100).toFixed(2)} collected`,
        payoutFailed: Boolean(payout?.failed) && collected > 0,
      });
      continue;
    }

    // Single-payer booking. Manual entries have no in-app payment to reconcile
    // against — the venue collects those itself, so its own status stands.
    if (b.booking_type === "manual") {
      out.set(b.id, {
        status: (PAID_STORED.has(stored) ? "paid" : stored === "reception" ? "reception" : "unpaid"),
        collectedPence: PAID_STORED.has(stored) ? expected : 0,
        expectedPence: expected,
        payers: [],
        detail: PAID_STORED.has(stored) ? "Marked paid by the venue" : "Collected at the venue",
        payoutFailed: false,
      });
      continue;
    }

    const card = cardPaidByBooking.get(b.id) ?? 0;
    const payout = payoutByBooking.get(b.id);
    const creditDirect = creditByBooking.get(b.id) ?? 0;
    const matchId = b.post_id ? matchIdByPost.get(b.post_id) : undefined;
    const creditMatch = matchId ? (creditByMatch.get(matchId) ?? 0) : 0;

    let detail = "";
    let paid = false;
    if (PAID_STORED.has(stored)) { paid = true; detail = "Paid through Unitr"; }
    if (card > 0) { paid = true; detail = "Paid by card"; }
    else if (b.stripe_payment_intent_id) { paid = true; detail = "Paid by card"; }
    if (creditDirect > 0) { paid = true; detail = "Paid from team credit"; }
    else if (creditMatch > 0) { paid = true; detail = "Both teams' credit split at match confirmation"; }
    if (!paid && payout && payout.paid > 0) { paid = true; detail = "Paid — Unitr payout sent"; }

    const collected = paid ? Math.max(expected, card, creditDirect, creditMatch, payout?.paid ?? 0) : 0;

    out.set(b.id, {
      status: paid ? "paid" : stored === "after_match" ? "after_match" : stored === "reception" ? "reception" : "unpaid",
      collectedPence: paid ? (expected || collected) : 0,
      expectedPence: expected,
      payers: [],
      detail: paid ? detail : stored === "after_match" ? "Due after the match" : "Not paid yet",
      payoutFailed: Boolean(payout?.failed) && paid,
    });
  }

  return out;
}

// Write the derived truth back so the correction sticks (and so anything still
// reading payment_status directly — reports, exports — agrees with the portal).
export async function persistPaidCorrections(
  bookings: VenueBookingRef[],
  payments: Map<string, BookingPayment>
): Promise<void> {
  const ids = bookings
    .filter((b) => payments.get(b.id)?.status === "paid" && (b.payment_status ?? "unpaid") !== "paid")
    .map((b) => b.id);
  if (ids.length === 0) return;
  await supabase.from("pitch_bookings").update({ payment_status: "paid" }).in("id", ids);
}
