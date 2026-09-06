"use client";

// Platform finance — the three numbers that actually matter, then the detail.
//
//   1) Player top-ups      real money players have put in, via Stripe
//   2) Unitr revenue       entry fees from Unitr-HOSTED events — earned, ours
//   3) Owed to teams       credit still sitting on team balances — a liability
//
// The first version of this page showed "Net held by Unitr" as
// `player_payments − venue_transfers` and deliberately excluded credit
// top-ups to avoid double-counting them against the credit ledger. That made
// the headline read £0.00 while £1.00 of real money sat in Stripe, and set
// £0.50 of credit liability against £0.00 of stated cash — two figures that
// cannot both be true. A top-up is genuinely both things at once: real cash
// in, and credit issued. It belongs on both sides, and netting them is what
// produces a number worth reading.
//
// Unitr's revenue is identified exactly, not inferred: /api/tournaments/join
// stamps `open_match_id` onto the booking_capture row it writes, so a capture
// against an open_match whose `organiser_admin_id` is set is a buy-in that
// stayed with the platform (the admin paid the venue in cash outside the app).
//
// Reachable at /admin/finance; app/admin/layout.tsx gates it to admin accounts.

import { useEffect, useState } from "react";
import { authedGet, authedPost } from "@/lib/authed-fetch";
import { supabase } from "@/lib/supabase";
import { UNITR_FEE_ENABLED, UNITR_FEE_LABEL } from "@/lib/unitr-fee";

const CREDIT_LABELS: Record<string, string> = {
  deposit: "Top-ups / manual credit",
  booking_hold: "Holds (earmarks)",
  booking_capture: "Pitch & entry captures",
  opponent_settlement: "Opponent settlements",
  player_replenish: "Player replenishments",
  refund: "Refunds",
};

function fmt(pence: number) {
  return `£${(pence / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-border pt-2 mt-1" : ""}`}>
      <span className={strong ? "font-semibold text-text-primary text-sm" : `text-xs ${muted ? "text-text-secondary" : "text-text-secondary"}`}>{label}</span>
      <span className={`tabular-nums flex-shrink-0 ${strong ? "font-bold text-accent text-sm" : "font-semibold text-text-primary text-xs"}`}>{value}</span>
    </div>
  );
}

// The three headline figures, side by side. Deliberately the first thing on
// the page — everything below exists to explain these.
function Headline({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone: "in" | "ours" | "owed";
}) {
  const ring = tone === "ours"
    ? "border-accent/40 bg-accent/5"
    : tone === "owed"
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-border bg-surface-2";
  const ink = tone === "ours" ? "text-accent" : tone === "owed" ? "text-amber-500" : "text-text-primary";
  return (
    <div className={`border rounded-2xl p-4 ${ring}`}>
      <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-extrabold tabular-nums mt-1 ${ink}`}>{value}</p>
      <p className="text-[10px] text-text-secondary mt-1 leading-snug">{sub}</p>
    </div>
  );
}

type EventRevenue = { id: string; title: string; pence: number; entries: number };

export default function AdminFinancePage() {
  const [loading, setLoading] = useState(true);
  const [creditByType, setCreditByType] = useState<Record<string, { in: number; out: number; count: number }>>({});
  const [owedToTeams, setOwedToTeams] = useState(0);
  const [topUps, setTopUps] = useState({ cardPence: 0, cardCount: 0, cashPence: 0, cashCount: 0, refundPence: 0, refundCount: 0 });
  const [revenue, setRevenue] = useState({ totalPence: 0, byEvent: [] as EventRevenue[] });
  const [legacyFeesPence, setLegacyFeesPence] = useState(0);
  const [payouts, setPayouts] = useState({ pence: 0, count: 0 });
  const [stripeBalance, setStripeBalance] = useState<{ availablePence: number; pendingPence: number } | null>(null);
  const [funding, setFunding] = useState(false);
  const [showLedger, setShowLedger] = useState(false);

  // Test-mode Stripe platform balance. /api/dev/fund-test-balance refuses a
  // live key by design, so on production this stays null and the panel hides.
  const loadBalance = () =>
    authedGet("/api/dev/fund-test-balance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setStripeBalance(d); })
      .catch(() => {});

  const handleFund = async () => {
    setFunding(true);
    try {
      const res = await authedPost("/api/dev/fund-test-balance", { amountPence: 20000 });
      const d = await res.json();
      if (res.ok) setStripeBalance((prev) => ({ availablePence: d.availablePence, pendingPence: prev?.pendingPence ?? 0 }));
    } finally {
      setFunding(false);
    }
  };

  useEffect(() => {
    async function load() {
      const [{ data: tx }, { data: balances }, { data: events }, { data: pays }, { data: transfers }] = await Promise.all([
        supabase.from("team_credit_transactions").select("type, amount_pence, open_match_id, stripe_payment_intent_id"),
        supabase.from("team_credits").select("balance_pence"),
        // Missing migration degrades to "no admin-hosted events" rather than
        // failing the page — revenue then reads £0 with the ledger intact.
        supabase.from("open_matches").select("id, title, organiser_admin_id"),
        supabase.from("player_payments").select("unitr_fee_pence, status"),
        supabase.from("venue_transfers").select("amount_pence, status"),
      ]);

      const rows = tx ?? [];

      // ── Per-type ledger summary (the detail table at the bottom) ──
      const byType: Record<string, { in: number; out: number; count: number }> = {};
      for (const t of rows) {
        const k = t.type ?? "other";
        byType[k] = byType[k] ?? { in: 0, out: 0, count: 0 };
        if (t.amount_pence >= 0) byType[k].in += t.amount_pence; else byType[k].out += t.amount_pence;
        byType[k].count += 1;
      }
      setCreditByType(byType);

      // ── 1) Money in ──
      // A deposit carrying a PaymentIntent id is real money that reached
      // Stripe. One without is cash a captain recorded by hand
      // (record_cash_credit) — credit was issued but no money moved, so the
      // two can never be added together and called "cash held".
      let cardPence = 0, cardCount = 0, cashPence = 0, cashCount = 0, refundPence = 0, refundCount = 0;
      for (const t of rows) {
        if (t.type === "deposit" && t.amount_pence > 0) {
          if (t.stripe_payment_intent_id) { cardPence += t.amount_pence; cardCount += 1; }
          else { cashPence += t.amount_pence; cashCount += 1; }
        } else if (t.type === "refund" && t.amount_pence < 0) {
          refundPence += -t.amount_pence; refundCount += 1;
        }
      }
      setTopUps({ cardPence, cardCount, cashPence, cashCount, refundPence, refundCount });

      // ── 2) Unitr's revenue ──
      const adminHosted = new Map<string, string>();
      for (const e of events ?? []) {
        if (e.organiser_admin_id) adminHosted.set(e.id as string, (e.title as string) || "Untitled event");
      }
      const perEvent = new Map<string, EventRevenue>();
      let revenueTotal = 0;
      for (const t of rows) {
        // A buy-in in ('booking_capture', negative) and, if the event was
        // taken down, the same money back out ('buyin_refund', positive —
        // /api/events/take-down). Reading only the captures would leave a
        // cancelled event still counted as revenue Unitr kept.
        if (t.type !== "booking_capture" && t.type !== "buyin_refund") continue;
        if (!t.open_match_id) continue;
        const title = adminHosted.get(t.open_match_id as string);
        if (!title) continue; // team- or venue-hosted: that money left for someone else
        const pence = -t.amount_pence; // captures are negative on the team's ledger
        revenueTotal += pence;
        const prev = perEvent.get(t.open_match_id as string);
        perEvent.set(t.open_match_id as string, {
          id: t.open_match_id as string, title,
          pence: (prev?.pence ?? 0) + pence,
          // Entries counts buy-ins, not ledger rows: a refund reverses one.
          entries: (prev?.entries ?? 0) + (t.type === "booking_capture" ? 1 : -1),
        });
      }
      setRevenue({
        totalPence: revenueTotal,
        byEvent: [...perEvent.values()].sort((a, b) => b.pence - a.pence),
      });

      // ── 3) Owed back to teams ──
      setOwedToTeams((balances ?? []).reduce((s, b) => s + (b.balance_pence ?? 0), 0));

      // Platform fees charged before the rate was set to 0. Historic only —
      // unitr_fee_pence is a snapshot, never recomputed.
      setLegacyFeesPence(
        (pays ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + (p.unitr_fee_pence ?? 0), 0),
      );
      const paidTransfers = (transfers ?? []).filter((t) => t.status === "paid");
      setPayouts({
        pence: paidTransfers.reduce((s, t) => s + (t.amount_pence ?? 0), 0),
        count: paidTransfers.length,
      });
      setLoading(false);
    }
    load();
    loadBalance();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  const totalIn = topUps.cardPence + topUps.cashPence;
  const netIn = totalIn - topUps.refundPence;
  // What the three headline figures imply the balances should be. Anything
  // else that moved credit — a friendly's pitch capture, a team-to-team
  // settlement, a replenishment — shows up as the gap.
  const expectedOwed = netIn - revenue.totalPence;
  const otherMovement = owedToTeams - expectedOwed;

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-secondary">
        Real money in, what Unitr has earned, and what is still owed back to teams.
      </p>

      {/* ── The three numbers ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Headline tone="in" label="Player top-ups" value={fmt(netIn)}
          sub={topUps.refundPence > 0 ? `${fmt(totalIn)} in, less ${fmt(topUps.refundPence)} refunded` : "Total put in by players"} />
        <Headline tone="ours" label="Unitr revenue" value={fmt(revenue.totalPence)}
          sub="Entry fees from Unitr-hosted events" />
        <Headline tone="owed" label="Owed back to teams" value={fmt(owedToTeams)}
          sub="Credit still on team balances" />
      </div>

      {/* ── Money in ── */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <p className="text-sm font-semibold mb-3">Money in</p>
        <div className="space-y-2">
          <Row label={`Card top-ups via Stripe (${topUps.cardCount})`} value={fmt(topUps.cardPence)} />
          <Row label={`Cash recorded by captains (${topUps.cashCount})`} value={fmt(topUps.cashPence)} />
          {topUps.refundPence > 0 && (
            <Row label={`Refunded back to cards (${topUps.refundCount})`} value={`−${fmt(topUps.refundPence)}`} />
          )}
          <Row label="Net taken in" value={fmt(netIn)} strong />
        </div>
        <p className="text-[10px] text-text-secondary mt-3 leading-relaxed">
          Only the card line is money that reached Stripe. Cash recorded by a captain issues credit
          without any money moving, so it is a liability with nothing behind it — useful to see, never
          to spend.
        </p>
      </div>

      {/* ── Unitr's revenue ── */}
      <div className="bg-surface-2 border border-accent/30 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Unitr revenue</p>
          <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">earned</span>
        </div>
        <div className="space-y-2">
          {revenue.byEvent.length === 0 ? (
            <p className="text-xs text-text-secondary">No Unitr-hosted events have taken an entry fee yet.</p>
          ) : (
            revenue.byEvent.map((e) => (
              <Row key={e.id} label={`${e.title} (${e.entries} ${e.entries === 1 ? "team" : "teams"})`} value={fmt(e.pence)} />
            ))
          )}
          <Row label="Total earned" value={fmt(revenue.totalPence)} strong />
        </div>
        <p className="text-[10px] text-text-secondary mt-3 leading-relaxed">
          Buy-ins from events Unitr hosted. The venue for these is paid in cash outside the app, so the
          whole entry fee stays with the platform. Team- and venue-hosted events are excluded — that
          money is passed on.
          {UNITR_FEE_ENABLED
            ? ` A ${UNITR_FEE_LABEL} platform fee is also charged on pitch splits.`
            : " The per-transaction platform fee is currently switched off (lib/unitr-fee.ts)."}
        </p>
        {legacyFeesPence > 0 && (
          <p className="text-[10px] text-text-secondary mt-2">
            Plus {fmt(legacyFeesPence)} of platform fees charged before the rate was set to 0.
          </p>
        )}
      </div>

      {/* ── Owed back ── */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <p className="text-sm font-semibold mb-3">Owed back to teams</p>
        <div className="space-y-2">
          <Row label="Net taken in" value={fmt(netIn)} />
          <Row label="Less Unitr revenue" value={`−${fmt(revenue.totalPence)}`} />
          {otherMovement !== 0 && (
            <Row label="Other credit movement" value={`${otherMovement > 0 ? "+" : "−"}${fmt(Math.abs(otherMovement))}`} />
          )}
          <Row label="Credit held by teams" value={fmt(owedToTeams)} strong />
        </div>
        {otherMovement !== 0 && (
          <p className="text-[10px] text-text-secondary mt-3 leading-relaxed">
            &ldquo;Other credit movement&rdquo; is credit that moved for a reason other than a Unitr-hosted
            entry fee — a friendly&rsquo;s pitch capture, a team-to-team settlement or a player
            replenishment. It is not drift; the full breakdown is in the ledger below.
          </p>
        )}
      </div>

      {/* ── Venue payouts ── */}
      {(payouts.count > 0 || payouts.pence > 0) && (
        <div className="bg-surface-2 border border-border rounded-2xl p-5">
          <p className="text-sm font-semibold mb-3">Venue payouts</p>
          <Row label={`Transferred to venues (${payouts.count})`} value={`−${fmt(payouts.pence)}`} />
          <p className="text-[10px] text-text-secondary mt-3">
            Stripe Connect transfers for venue-hosted events. Out of scope for the pilot — Unitr-hosted
            events pay the venue in cash outside the app.
          </p>
        </div>
      )}

      {/* ── Full ledger, on demand ── */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <button onClick={() => setShowLedger((v) => !v)} className="w-full flex items-center justify-between">
          <p className="text-sm font-semibold">All credit ledger movement</p>
          <span className="text-xs text-text-secondary">{showLedger ? "Hide" : "Show"}</span>
        </button>
        {showLedger && (
          <div className="space-y-2 mt-3">
            {Object.keys(creditByType).length === 0 ? (
              <p className="text-xs text-text-secondary">No credit movement yet.</p>
            ) : (
              Object.entries(creditByType).sort((a, b) => b[1].count - a[1].count).map(([type, v]) => (
                <Row key={type} label={`${CREDIT_LABELS[type] ?? type} (${v.count})`} value={`${fmt(v.in)} in · ${fmt(v.out)} out`} />
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Stripe platform balance (test mode only) ── */}
      {stripeBalance && (
        <div className="bg-surface-2 border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Stripe platform balance</p>
            <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">test mode</span>
          </div>
          <div className="space-y-2">
            <Row label="Available (backs venue transfers)" value={fmt(stripeBalance.availablePence)} strong />
            <Row label="Pending (settling card charges)" value={fmt(stripeBalance.pendingPence)} />
          </div>
          <button onClick={handleFund} disabled={funding}
            className="w-full mt-4 py-2.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
            {funding ? "Funding…" : "Add £200 test funds"}
          </button>
          <p className="text-[10px] text-text-secondary mt-2">
            Venue transfers draw from the available balance. In test mode, normal card charges sit in
            pending — this button charges Stripe&rsquo;s bypass-pending test card so funds land instantly.
          </p>
        </div>
      )}
    </div>
  );
}
