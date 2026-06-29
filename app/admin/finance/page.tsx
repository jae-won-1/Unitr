"use client";

// Platform finance — two SEPARATE ledgers, side by side:
//   1) In-app CREDIT activity (team_credit_transactions) — virtual money that
//      moves between teams; no bank involved.
//   2) Real CASH activity via Stripe — actual card charges in (player_payments,
//      credit top-ups) and payouts out to venues (venue_transfers).
// Prototype view, reachable at /admin/finance (not yet role-guarded).

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

function fmt(pence: number) { return `£${(pence / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-border pt-2 mt-1" : ""}`}>
      <span className={strong ? "font-semibold text-text-primary text-sm" : "text-text-secondary text-xs"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-bold text-accent text-sm" : "font-semibold text-text-primary text-xs"}`}>{value}</span>
    </div>
  );
}

export default function AdminFinancePage() {
  const [loading, setLoading] = useState(true);
  const [creditByType, setCreditByType] = useState<Record<string, { in: number; out: number; count: number }>>({});
  const [creditInCirculation, setCreditInCirculation] = useState(0);
  const [cash, setCash] = useState({ chargesPence: 0, feesPence: 0, payoutsPence: 0, payoutCount: 0, chargeCount: 0 });

  useEffect(() => {
    async function load() {
      const [{ data: tx }, { data: balances }, { data: pays }, { data: transfers }] = await Promise.all([
        supabase.from("team_credit_transactions").select("type, amount_pence"),
        supabase.from("team_credits").select("balance_pence"),
        supabase.from("player_payments").select("amount_pence, unitr_fee_pence, total_pence, status, purpose"),
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

      // ── 2) Real cash via Stripe ──
      // Real card charges that left a record: player_payments (settlement /
      // replenishment / ringer). Credit top-ups also run through Stripe but are
      // booked into the credit ledger as 'deposit' (shown in section 1), so they
      // aren't double-counted here.
      const paid = (pays ?? []).filter((p) => p.status === "paid");
      const paidTransfers = (transfers ?? []).filter((t) => t.status === "paid");
      setCash({
        chargesPence: paid.reduce((s, p) => s + (p.total_pence ?? 0), 0),
        feesPence: paid.reduce((s, p) => s + (p.unitr_fee_pence ?? 0), 0),
        payoutsPence: paidTransfers.reduce((s, t) => s + (t.amount_pence ?? 0), 0),
        payoutCount: paidTransfers.length,
        chargeCount: paid.length,
      });
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  const creditIn = Object.values(creditByType).reduce((s, v) => s + v.in, 0);
  const creditOut = Object.values(creditByType).reduce((s, v) => s + v.out, 0);
  const cashIn = cash.chargesPence;
  const netUnitr = cashIn - cash.payoutsPence;

  return (
    <div className="px-4 md:px-8 pt-12 pb-10 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Finance</h1>
        <p className="text-xs text-text-secondary mt-0.5">In-app credit and real Stripe cash, tracked separately.</p>
      </div>

      {/* ── 1) In-app credit ── */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">In-app credit activity</p>
          <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full">virtual</span>
        </div>
        <div className="space-y-2">
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
        </div>
      </div>

      {/* ── 2) Real cash (Stripe) ── */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Real money (Stripe)</p>
          <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">cash</span>
        </div>
        <div className="space-y-2">
          <Row label={`Card charges in (${cash.chargeCount})`} value={fmt(cashIn)} />
          <Row label="Of which Unitr platform fees" value={fmt(cash.feesPence)} />
          <Row label={`Venue payouts out (${cash.payoutCount})`} value={`−${fmt(cash.payoutsPence)}`} />
          <Row label="Net held by Unitr" value={fmt(netUnitr)} strong />
        </div>
        <p className="text-[10px] text-text-secondary mt-3">
          Card charges − venue payouts. Credit top-ups also run through Stripe but are booked as
          &lsquo;deposit&rsquo; in the credit ledger above. Credit in circulation is a liability against this cash.
        </p>
      </div>
    </div>
  );
}
