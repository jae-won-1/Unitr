"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Booking = {
  pitch_id: string;
  match_date: string;
  total_price_pence: number;
  per_player_pence: number;
  player_count: number;
  status: string;
  booking_type: string;
  payment_status: string;
};

function priceOf(b: Booking): number {
  if (b.total_price_pence && b.total_price_pence > 0) return b.total_price_pence / 100;
  if (b.per_player_pence && b.player_count) return (b.per_player_pence * b.player_count) / 100;
  return 0;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4">
      <p className="text-xs text-text-secondary mb-1">{label}</p>
      <p className="text-2xl font-bold text-accent">{value}</p>
      {sub && <p className="text-[10px] text-text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type VenuePitch = { id: string; name: string; stripe_account_id: string | null; payouts_enabled: boolean };
type Transfer = {
  id: string; pitch_id: string | null; amount_pence: number; status: string; created_at: string;
  stripe_transfer_id: string | null; team_id: string | null; booking_id: string | null; payerLabel: string;
};

export default function VenueReportsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPitches, setHasPitches] = useState(true);
  const [pitches, setPitches] = useState<VenuePitch[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: ps } = await supabase.from("pitches")
        .select("id, name, stripe_account_id, payouts_enabled").eq("venue_owner_id", user!.id);
      if (!ps || ps.length === 0) { setHasPitches(false); setLoading(false); return; }
      setPitches(ps as VenuePitch[]);

      const pitchIds = ps.map((p) => p.id);
      const [{ data: bks }, { data: trs }] = await Promise.all([
        supabase.from("pitch_bookings")
          .select("pitch_id, match_date, total_price_pence, per_player_pence, player_count, status, booking_type, payment_status")
          .in("pitch_id", pitchIds),
        supabase.from("venue_transfers")
          .select("id, pitch_id, amount_pence, status, created_at, stripe_transfer_id, team_id, booking_id")
          .in("pitch_id", pitchIds).order("created_at", { ascending: false }).limit(25),
      ]);
      setBookings((bks ?? []) as Booking[]);

      // Resolve a paying-team label per transfer: prefer the direct team_id
      // link, falling back to the booking's booker_name for legacy rows
      // written before that column existed (for a matched game that string
      // is already "Team A vs Team B" — see app/play/page.tsx).
      const rows = trs ?? [];
      const teamIds = [...new Set(rows.map((t) => t.team_id).filter(Boolean))] as string[];
      const bookingIds = [...new Set(rows.map((t) => t.booking_id).filter(Boolean))] as string[];
      const [{ data: teams }, { data: legacyBookings }] = await Promise.all([
        teamIds.length ? supabase.from("teams").select("id, name").in("id", teamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        bookingIds.length ? supabase.from("pitch_bookings").select("id, booker_name").in("id", bookingIds) : Promise.resolve({ data: [] as { id: string; booker_name: string | null }[] }),
      ]);
      const teamName = new Map((teams ?? []).map((t) => [t.id, t.name as string]));
      const bookerName = new Map((legacyBookings ?? []).map((b) => [b.id, b.booker_name as string | null]));

      setTransfers(rows.map((t) => ({
        ...t,
        payerLabel: t.team_id
          ? (teamName.get(t.team_id) ?? "Unknown team")
          : (t.booking_id ? (bookerName.get(t.booking_id) ?? null) : null) ?? "—",
      })) as Transfer[]);
      setLoading(false);
    }
    load();
  }, [user]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  if (!hasPitches) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">No pitches registered</p>
      <a href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register a Pitch</a>
    </div>
  );

  const active = bookings.filter((b) => b.status !== "cancelled");
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const revenue = confirmed.reduce((s, b) => s + priceOf(b), 0);
  const payoutsEnabled = pitches.some((p) => p.payouts_enabled);
  const payoutTotal = transfers.filter((t) => t.status === "paid").reduce((s, t) => s + t.amount_pence, 0) / 100;

  // Per-pitch breakdown: the venue has ONE payout account, but revenue and
  // payouts are still attributed to the individual pitch they came from.
  const byPitch = pitches.map((p) => {
    const pitchConfirmed = confirmed.filter((b) => b.pitch_id === p.id);
    return {
      id: p.id,
      name: p.name,
      bookings: bookings.filter((b) => b.pitch_id === p.id && b.status !== "cancelled").length,
      revenue: pitchConfirmed.reduce((s, b) => s + priceOf(b), 0),
      paidOut: transfers.filter((t) => t.pitch_id === p.id && t.status === "paid")
        .reduce((s, t) => s + t.amount_pence, 0) / 100,
    };
  });
  const maxPitchRevenue = Math.max(1, ...byPitch.map((p) => p.revenue));
  const cancelRate = bookings.length ? Math.round((bookings.filter((b) => b.status === "cancelled").length / bookings.length) * 100) : 0;

  // Revenue by month (current year, ISO dates only)
  const byMonth = new Array(12).fill(0);
  for (const b of confirmed) {
    const m = b.match_date.match(/^\d{4}-(\d{2})-\d{2}$/);
    if (m) byMonth[Number(m[1]) - 1] += priceOf(b);
  }
  const maxMonth = Math.max(1, ...byMonth);

  // Booking type breakdown
  const types: Record<string, number> = {};
  for (const b of active) {
    const key = b.booking_type === "open_match" ? "Open / events" : b.booking_type === "platform" ? "Via Unitr" : "Manual";
    types[key] = (types[key] ?? 0) + 1;
  }

  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Reports</h1>
        <p className="text-xs text-text-secondary mt-0.5">Performance across all your pitches.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total bookings" value={String(bookings.length)} sub="all time" />
        <StatCard label="Confirmed" value={String(confirmed.length)} sub={`${cancelRate}% cancel rate`} />
        <StatCard label="Revenue" value={`£${revenue.toFixed(0)}`} sub="confirmed" />
        <StatCard label="Paid out" value={`£${payoutTotal.toFixed(0)}`} sub="received from Unitr" />
      </div>

      {/* ── Payout history (account management lives in Settings → Payouts) ── */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold">Payouts</p>
          {payoutsEnabled ? (
            <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">Payouts enabled</span>
          ) : (
            <a href="/venue/settings?connect=setup"
              className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
              Set up in Settings →
            </a>
          )}
        </div>
        <p className="text-xs text-text-secondary mb-3">
          When a booking is paid on one of your pitches, the pitch fee is transferred from Unitr to your
          venue&apos;s payout account. Manage the account in Settings → Payouts.
        </p>

        {/* Recent transfers */}
        {transfers.length === 0 ? (
          <p className="text-xs text-text-secondary">No transfers yet — confirm a match on your pitch to see one here.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Recent payouts</p>
            {transfers.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-background border border-border rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">£{(t.amount_pence / 100).toFixed(2)} <span className="text-xs font-normal text-text-secondary">from {t.payerLabel}</span></p>
                  <p className="text-[10px] text-text-secondary truncate">
                    {new Date(t.created_at).toLocaleDateString()}
                    {" · "}{pitches.find((p) => p.id === t.pitch_id)?.name ?? "—"}
                    {" · "}{t.stripe_transfer_id ?? "—"}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  t.status === "paid" ? "bg-accent/10 text-accent border border-accent/30"
                  : t.status === "failed" ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-surface border border-border text-text-secondary"
                }`}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revenue by pitch — one payout account per venue, earnings broken down per pitch */}
      {pitches.length > 1 && (
        <div className="bg-surface-2 border border-border rounded-2xl p-5">
          <p className="text-sm font-semibold mb-1">Revenue by pitch</p>
          <p className="text-xs text-text-secondary mb-4">All pitches pay out to the same venue account — here&apos;s where the money came from.</p>
          <div className="space-y-3">
            {byPitch.map((p) => {
              const pct = Math.round((p.revenue / maxPitchRevenue) * 100);
              return (
                <div key={p.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold truncate">{p.name}</span>
                    <span className="text-text-secondary flex-shrink-0 ml-2">
                      {p.bookings} bookings · £{p.revenue.toFixed(0)} earned · £{p.paidOut.toFixed(0)} paid out
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-background overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Revenue by month */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <p className="text-sm font-semibold mb-4">Revenue by month</p>
        <div className="flex items-end gap-2 h-40">
          {byMonth.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="w-full flex-1 flex items-end">
                <div className="w-full rounded-t-md bg-accent/70" style={{ height: `${(v / maxMonth) * 100}%`, minHeight: v > 0 ? 4 : 0 }} title={`£${v.toFixed(0)}`} />
              </div>
              <span className="text-[9px] text-text-secondary">{MONTH_NAMES[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Booking mix */}
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <p className="text-sm font-semibold mb-4">Booking mix</p>
        {Object.keys(types).length === 0 ? (
          <p className="text-xs text-text-secondary">No bookings yet.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(types).map(([k, n]) => {
              const pct = Math.round((n / active.length) * 100);
              return (
                <div key={k}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-secondary">{k}</span>
                    <span className="font-semibold">{n} · {pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-background overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
