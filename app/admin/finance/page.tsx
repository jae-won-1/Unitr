"use client";

// Platform finance — three questions, kept deliberately separate:
//
//   1) CREDIT (virtual)  — team_credit_transactions. Credit is a LIABILITY:
//      cash Unitr holds but still owes back as spendable balance.
//   2) REVENUE (earned)  — the moments a liability is extinguished or a fee is
//      charged, i.e. money Unitr has actually earned rather than merely holds.
//   3) CASH (real)       — what settled in Stripe, read from Stripe itself.
//
// The distinction that motivates the split: topping up team credit is a real
// card charge, but it is NOT revenue — at that moment Unitr owes it back. It
// becomes earned when the credit is spent on something Unitr keeps, which for
// an admin-hosted event is the moment a team joins (see
// app/api/tournaments/join/route.ts — the admin branch takes the buy-in from
// credit and makes no venue payout, because the admin paid the venue in cash).
//
// Reachable at /admin/finance; app/admin/layout.tsx gates it to admin accounts.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const CREDIT_LABELS: Record<string, string> = {
  deposit: "Top-ups / manual credit",
  booking_hold: "Holds (earmarks)",
  booking_capture: "Pitch captures",
  opponent_settlement: "Opponent settlements",
  player_replenish: "Player replenishments",
  refund: "Refunds",
};

// Stripe metadata.type → how it reads on this page. dev_fund_test_balance is
// test plumbing (Unitr charging itself to back transfers), never customer cash.
const CASH_LABELS: Record<string, string> = {
  team_credits: "Credit top-ups",
  match_settlement: "Match / tournament settlements",
  ringer_fee: "Ringer fees",
  untyped: "Other card charges",
};
const EXCLUDED_FROM_CASH = new Set(["dev_fund_test_balance"]);

function fmt(pence: number) {
  return `£${(pence / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-border pt-2 mt-1" : ""}`}>
      <span className={strong ? "font-semibold text-text-primary text-sm" : `text-xs ${muted ? "text-text-secondary/70" : "text-text-secondary"}`}>{label}</span>
      <span className={`tabular-nums flex-shrink-0 ${strong ? "font-bold text-accent text-sm" : "font-semibold text-text-primary text-xs"}`}>{value}</span>
    </div>
  );
}

function Card({ title, badge, badgeClass, children, footnote }: {
  title: string; badge: string; badgeClass: string;
  children: React.ReactNode; footnote?: React.ReactNode;
}) {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${badgeClass}`}>{badge}</span>
      </div>
      <div className="space-y-2">{children}</div>
      {footnote && <p className="text-[10px] text-text-secondary mt-3 leading-relaxed">{footnote}</p>}
    </div>
  );
}

type StripeCash = {
  byType: Record<string, { pence: number; count: number }>;
  topUps: { id: string; amountPence: number; teamId: string | null; created: number }[];
  topUpPence: number;
  topUpCount: number;
  truncated: boolean;
  testMode: boolean;
};

type LedgerTopUps = { pence: number; intentIds: Set<string> };

export default function AdminFinancePage() {
  const [loading, setLoading] = useState(true);
  const [creditByType, setCreditByType] = useState<Record<string, { in: number; out: number; count: number }>>({});
  const [creditInCirculation, setCreditInCirculation] = useState(0);
  const [feesPence, setFeesPence] = useState(0);
  const [payouts, setPayouts] = useState({ pence: 0, count: 0 });
  // null = the migration behind it hasn't been run, so we can't answer honestly.
  const [adminHosted, setAdminHosted] = useState<{ pence: number; count: number } | null>(null);
  const [ledgerTopUps, setLedgerTopUps] = useState<LedgerTopUps | null>(null);
  const [cash, setCash] = useState<StripeCash | null>(null);
  const [cashError, setCashError] = useState<string | null>(null);
  const [stripeBalance, setStripeBalance] = useState<{ availablePence: number; pendingPence: number } | null>(null);
  const [funding, setFunding] = useState(false);

  const loadBalance = () =>
    fetch("/api/dev/fund-test-balance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setStripeBalance(d); })
      .catch(() => {});

  const handleFund = async () => {
    setFunding(true);
    try {
      const res = await fetch("/api/dev/fund-test-balance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPence: 20000 }),
      });
      const d = await res.json();
      if (res.ok) setStripeBalance((prev) => ({ availablePence: d.availablePence, pendingPence: prev?.pendingPence ?? 0 }));
    } finally {
      setFunding(false);
    }
  };

  useEffect(() => {
    async function load() {
      const [{ data: tx }, { data: balances }, { data: pays }, { data: transfers }] = await Promise.all([
        supabase.from("team_credit_transactions").select("type, amount_pence"),
        supabase.from("team_credits").select("balance_pence"),
        supabase.from("player_payments").select("unitr_fee_pence, status"),
        supabase.from("venue_transfers").select("amount_pence, status"),
      ]);

      // ── 1) In-app credit ledger ──
      const byType: Record<string, { in: number; out: number; count: number }> = {};
      for (const t of tx ?? []) {
        const k = t.type ?? "other";
        byType[k] = byType[k] ?? { in: 0, out: 0, count: 0 };
        if (t.amount_pence >= 0) byType[k].in += t.amount_pence; else byType[k].out += t.amount_pence;
        byType[k].count += 1;
      }
      setCreditByType(byType);
      setCreditInCirculation((balances ?? []).reduce((s, b) => s + (b.balance_pence ?? 0), 0));

      const paid = (pays ?? []).filter((p) => p.status === "paid");
      setFeesPence(paid.reduce((s, p) => s + (p.unitr_fee_pence ?? 0), 0));

      const paidTransfers = (transfers ?? []).filter((t) => t.status === "paid");
      setPayouts({
        pence: paidTransfers.reduce((s, t) => s + (t.amount_pence ?? 0), 0),
        count: paidTransfers.length,
      });

      // ── 2) Admin-hosted buy-ins = recognised revenue ──
      // The join debits the team's credit and pays nobody out, so the whole
      // buy-in stops being owed and becomes earned. Two steps because
      // open_matches has no usable FK to embed across (see CLAUDE.md), and both
      // degrade to "unknown" rather than zero if their migration is missing —
      // reporting £0 earned would be a worse lie than admitting we can't tell.
      const { data: adminOms, error: omErr } = await supabase
        .from("open_matches").select("id").not("organiser_admin_id", "is", null);
      if (omErr) {
        setAdminHosted(null);
      } else {
        const ids = (adminOms ?? []).map((o) => o.id);
        if (ids.length === 0) {
          setAdminHosted({ pence: 0, count: 0 });
        } else {
          const { data: caps, error: capErr } = await supabase
            .from("team_credit_transactions")
            .select("amount_pence, open_match_id")
            .eq("type", "booking_capture")
            .in("open_match_id", ids);
          setAdminHosted(capErr ? null : {
            pence: (caps ?? []).reduce((s, c) => s + Math.abs(c.amount_pence ?? 0), 0),
            count: (caps ?? []).length,
          });
        }
      }

      // ── 3) Ledger side of the top-up reconciliation ──
      // Only deposits carrying a PaymentIntent are card top-ups; the untagged
      // ones are cash-settled dues, manual grants and join refunds, which have
      // no Stripe counterpart and would show as a permanent false gap.
      const { data: deposits, error: depErr } = await supabase
        .from("team_credit_transactions")
        .select("amount_pence, stripe_payment_intent_id")
        .eq("type", "deposit")
        .not("stripe_payment_intent_id", "is", null);
      setLedgerTopUps(depErr ? null : {
        pence: (deposits ?? []).reduce((s, d) => s + (d.amount_pence ?? 0), 0),
        intentIds: new Set((deposits ?? []).map((d) => d.stripe_payment_intent_id as string)),
      });

      setLoading(false);
    }

    load();
    loadBalance();
    fetch("/api/admin/stripe-cash")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || d.error) { setCashError(d.error ?? "Could not read Stripe activity"); return; }
        setCash(d as StripeCash);
      })
      .catch(() => setCashError("Could not reach Stripe"));
  }, []);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  const creditIn = Object.values(creditByType).reduce((s, v) => s + v.in, 0);
  const creditOut = Object.values(creditByType).reduce((s, v) => s + v.out, 0);

  // ── Cash, from Stripe ──
  const cashRows = Object.entries(cash?.byType ?? {})
    .filter(([type]) => !EXCLUDED_FROM_CASH.has(type))
    .sort((a, b) => b[1].pence - a[1].pence);
  const cashIn = cashRows.reduce((s, [, v]) => s + v.pence, 0);
  const netHeld = cashIn - payouts.pence;

  // ── Revenue ──
  // Ringer fees are Unitr's in full (flat £5, never touches the pitch split).
  const ringerPence = cash?.byType?.ringer_fee?.pence ?? 0;
  const revenueKnown = adminHosted !== null && cash !== null;
  const revenueTotal = feesPence + ringerPence + (adminHosted?.pence ?? 0);

  // ── Top-up reconciliation ──
  const unmatched = cash && ledgerTopUps
    ? cash.topUps.filter((t) => !ledgerTopUps.intentIds.has(t.id))
    : [];
  const unmatchedPence = unmatched.reduce((s, t) => s + t.amountPence, 0);

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-secondary">
        Credit is money Unitr <span className="font-semibold text-text-primary">owes</span>; revenue is money it has
        <span className="font-semibold text-text-primary"> earned</span>; cash is what actually settled in Stripe.
      </p>

      {/* ── 1) In-app credit (a liability) ── */}
      <Card title="In-app credit activity" badge="liability" badgeClass="bg-blue-500/10 text-blue-300 border-blue-500/20">
        {Object.keys(creditByType).length === 0 ? (
          <p className="text-xs text-text-secondary">No credit movement yet.</p>
        ) : (
          Object.entries(creditByType).sort((a, b) => b[1].count - a[1].count).map(([type, v]) => (
            <Row key={type} label={`${CREDIT_LABELS[type] ?? type} (${v.count})`} value={`${fmt(v.in)} in · ${fmt(v.out)} out`} />
          ))
        )}
        <Row label="Total credited" value={fmt(creditIn)} />
        <Row label="Total debited" value={fmt(creditOut)} />
        <Row label="Credit balance in circulation" value={fmt(creditInCirculation)} strong />
        <p className="text-[10px] text-text-secondary pt-1 leading-relaxed">
          Virtual balances, not cash. Every pound in circulation is owed back to a team as spendable
          credit — it is backed by the real money below, not additional to it.
        </p>
      </Card>

      {/* ── 2) Recognised revenue ── */}
      <Card title="Revenue recognised" badge="earned" badgeClass="bg-accent/10 text-accent border-accent/30"
        footnote={
          <>
            A top-up is <span className="font-semibold">not</span> revenue — it is cash held against a credit
            liability. It is earned only when that credit is spent on something Unitr keeps. For an
            admin-hosted event that is the moment a team joins: the buy-in leaves team credit and no venue
            payout follows, because the admin paid the venue outside the app.
          </>
        }>
        <Row label="Platform fees (5% on settlements)" value={fmt(feesPence)} />
        <Row label={`Ringer fees${cash ? ` (${cash.byType?.ringer_fee?.count ?? 0})` : ""}`}
          value={cash ? fmt(ringerPence) : "—"} muted={!cash} />
        <Row
          label={adminHosted ? `Admin-hosted event buy-ins (${adminHosted.count})` : "Admin-hosted event buy-ins"}
          value={adminHosted ? fmt(adminHosted.pence) : "unavailable"}
          muted={!adminHosted}
        />
        <Row label={revenueKnown ? "Total earned" : "Total earned (partial)"} value={fmt(revenueTotal)} strong />
        {!adminHosted && (
          <p className="text-[10px] text-yellow-500 leading-relaxed">
            Admin-hosted buy-ins can&rsquo;t be counted: run <span className="font-mono">supabase_admin_hosting.sql</span> and
            <span className="font-mono"> supabase_credit_ledger.sql</span> so <span className="font-mono">organiser_admin_id</span> and
            <span className="font-mono"> open_match_id</span> exist. Showing £0 here would understate revenue.
          </p>
        )}
      </Card>

      {/* ── 3) Real cash, as Stripe sees it ── */}
      <Card title="Real money (Stripe)" badge="cash" badgeClass="bg-accent/10 text-accent border-accent/30"
        footnote={
          <>
            Read from Stripe rather than inferred from our own tables. Credit top-ups are included here —
            they are genuine card charges, and previously this total omitted them entirely because a top-up
            writes a credit-ledger row and no <span className="font-mono">player_payments</span> row.
            Test-mode self-funding is excluded.
            {cash?.truncated && " Only the most recent 1,000 intents were scanned, so these totals are partial."}
          </>
        }>
        {cashError ? (
          <p className="text-xs text-yellow-500">{cashError} — cash totals unavailable.</p>
        ) : !cash ? (
          <p className="text-xs text-text-secondary">Loading Stripe activity…</p>
        ) : (
          <>
            {cashRows.length === 0 && <p className="text-xs text-text-secondary">No settled charges yet.</p>}
            {cashRows.map(([type, v]) => (
              <Row key={type} label={`${CASH_LABELS[type] ?? type} (${v.count})`} value={fmt(v.pence)} />
            ))}
            <Row label="Total card charges in" value={fmt(cashIn)} />
            <Row label={`Venue payouts out (${payouts.count})`} value={`−${fmt(payouts.pence)}`} />
            <Row label="Net held by Unitr" value={fmt(netHeld)} strong />
            <Row label="of which owed back as credit" value={`−${fmt(creditInCirculation)}`} muted />
          </>
        )}
      </Card>

      {/* ── 4) Top-up reconciliation ── */}
      <Card title="Top-up reconciliation" badge="integrity"
        badgeClass={unmatched.length > 0 ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-blue-500/10 text-blue-300 border-blue-500/20"}
        footnote={
          <>
            Credit is granted client-side after <span className="font-mono">confirmPayment</span> resolves, and there is
            no Stripe webhook — so a tab closed at the wrong moment leaves Stripe holding money the ledger never
            credited. This compares the two directly. Only deposits tagged with a PaymentIntent are counted;
            cash-settled dues and manual grants have no Stripe side by design.
          </>
        }>
        {ledgerTopUps === null ? (
          <p className="text-[11px] text-yellow-500 leading-relaxed">
            Run <span className="font-mono">supabase_credit_topup_reconciliation.sql</span> to tag top-up deposits with
            their PaymentIntent. Until then, credit deposits can&rsquo;t be matched to Stripe charges.
          </p>
        ) : !cash ? (
          <p className="text-xs text-text-secondary">{cashError ?? "Loading Stripe activity…"}</p>
        ) : (
          <>
            <Row label={`Stripe top-up charges (${cash.topUpCount})`} value={fmt(cash.topUpPence)} />
            <Row label={`Credited in ledger (${ledgerTopUps.intentIds.size})`} value={fmt(ledgerTopUps.pence)} />
            <Row
              label={unmatched.length === 0 ? "Reconciled" : `Charged but never credited (${unmatched.length})`}
              value={unmatched.length === 0 ? "£0.00" : fmt(unmatchedPence)}
              strong
            />
            {unmatched.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                <p className="text-[11px] text-red-400 font-semibold">
                  These teams were charged but their credit was never added:
                </p>
                {unmatched.slice(0, 10).map((t) => (
                  <div key={t.id} className="flex justify-between gap-3 text-[11px]">
                    <span className="font-mono text-text-secondary truncate">{t.id}</span>
                    <span className="tabular-nums font-semibold flex-shrink-0">{fmt(t.amountPence)}</span>
                  </div>
                ))}
                {unmatched.length > 10 && (
                  <p className="text-[10px] text-text-secondary">+{unmatched.length - 10} more.</p>
                )}
              </div>
            )}
            {ledgerTopUps.pence > cash.topUpPence && !cash.truncated && (
              <p className="text-[10px] text-yellow-500 leading-relaxed">
                The ledger credits more than Stripe charged. Expected if credit was granted manually against a
                tagged intent, or if top-ups predate this reconciliation.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ── 5) Stripe platform balance (test mode) ── */}
      {stripeBalance && (
        <Card title="Stripe platform balance" badge="test mode" badgeClass="bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
          footnote="Venue transfers draw from the available balance. In test mode, normal card charges sit in pending — this button charges Stripe's bypass-pending test card so funds land instantly.">
          <Row label="Available (backs venue transfers)" value={fmt(stripeBalance.availablePence)} strong />
          <Row label="Pending (settling card charges)" value={fmt(stripeBalance.pendingPence)} />
          <button onClick={handleFund} disabled={funding}
            className="w-full mt-4 py-2.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
            {funding ? "Funding…" : "Add £200 test funds"}
          </button>
        </Card>
      )}
    </div>
  );
}
