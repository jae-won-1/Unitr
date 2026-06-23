"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Booking = {
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

export default function VenueReportsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPitches, setHasPitches] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: ps } = await supabase.from("pitches").select("id").eq("venue_owner_id", user!.id);
      if (!ps || ps.length === 0) { setHasPitches(false); setLoading(false); return; }
      const { data: bks } = await supabase.from("pitch_bookings")
        .select("match_date, total_price_pence, per_player_pence, player_count, status, booking_type, payment_status")
        .in("pitch_id", ps.map((p) => p.id));
      setBookings((bks ?? []) as Booking[]);
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
  const paidRevenue = confirmed.filter((b) => b.payment_status === "paid").reduce((s, b) => s + priceOf(b), 0);
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
        <StatCard label="Collected" value={`£${paidRevenue.toFixed(0)}`} sub="paid via Unitr" />
      </div>

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
