"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Pitch = { id: string; name: string; address: string; is_verified: boolean; price_per_hour: number };
type Booking = {
  id: string;
  pitch_id: string;
  match_date: string;
  start_time: string;
  player_count: number;
  per_player_pence: number;
  status: string;
  booked_by: string;
  booker_name?: string;
  pitch_name?: string;
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4 flex-1 min-w-0">
      <p className="text-xs text-text-secondary mb-1">{label}</p>
      <p className="text-2xl font-bold text-accent">{value}</p>
      {sub && <p className="text-[10px] text-text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    confirmed: { bg: "bg-accent/10", text: "text-accent", label: "Confirmed" },
    pending: { bg: "bg-yellow-500/10", text: "text-yellow-400", label: "Pending" },
    cancelled: { bg: "bg-red-500/10", text: "text-red-400", label: "Cancelled" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
  );
}

export default function VenueDashboard() {
  const { user } = useAuth();
  const [pitches, setPitches] = useState<Pitch[] | undefined>(undefined);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: ps } = await supabase
        .from("pitches").select("id, name, address, is_verified, price_per_hour")
        .eq("venue_owner_id", user!.id)
        .order("created_at", { ascending: true });
      const myPitches = (ps ?? []) as Pitch[];
      setPitches(myPitches);
      if (myPitches.length === 0) { setLoading(false); return; }

      const pitchIds = myPitches.map((p) => p.id);
      const { data: bks } = await supabase
        .from("pitch_bookings")
        .select("id, pitch_id, match_date, start_time, player_count, per_player_pence, status, booked_by")
        .in("pitch_id", pitchIds)
        .order("match_date", { ascending: false });

      const enriched = await Promise.all((bks ?? []).map(async (b) => {
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", b.booked_by).maybeSingle();
        const pitchName = myPitches.find((p) => p.id === b.pitch_id)?.name ?? "";
        return { ...b, booker_name: (prof as { full_name: string } | null)?.full_name ?? "Unknown", pitch_name: pitchName };
      }));
      setBookings(enriched);
      setLoading(false);
    }
    load();
  }, [user]);

  if (loading || pitches === undefined) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  if (pitches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center mb-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <p className="font-bold text-lg">No pitch registered</p>
        <p className="text-sm text-text-secondary">Register your venue to start managing bookings.</p>
        <Link href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register Your Pitch</Link>
      </div>
    );
  }

  const primaryPitch = pitches[0];
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const totalRevenue = confirmed.reduce((sum, b) => sum + (b.per_player_pence * b.player_count) / 100, 0);
  const upcoming = bookings.filter((b) => b.status !== "cancelled").slice(0, 10);

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      {/* Venue header */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-green-800 flex items-center justify-center flex-shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M2 12h20M12 2v20"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold truncate">{primaryPitch.name}</h1>
            {pitches.length > 1 && (
              <span className="flex-shrink-0 text-[10px] font-bold bg-surface-2 text-text-secondary border border-border px-2 py-0.5 rounded-full">
                +{pitches.length - 1} more
              </span>
            )}
            {primaryPitch.is_verified && (
              <span className="flex-shrink-0 text-[10px] font-bold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="#00E676"><polyline points="20 6 9 17 4 12"/></svg>
                Verified
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary truncate">{primaryPitch.address}</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-3">
        <StatCard label="Total bookings" value={String(bookings.length)} sub="all time" />
        <StatCard label="Confirmed" value={String(confirmed.length)} sub="bookings" />
        <StatCard label="Total revenue" value={`£${totalRevenue.toFixed(0)}`} sub="estimated" />
      </div>

      {/* Bookings list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Bookings</p>
          <Link href="/venue/bookings" className="text-xs text-accent font-medium">View all</Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="bg-surface-2 border border-border rounded-2xl px-4 py-6 text-center">
            <p className="text-sm text-text-secondary">No bookings yet</p>
            <p className="text-xs text-text-secondary mt-1">Bookings made through Unitr will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map((b) => (
              <div key={b.id} className="bg-surface-2 border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-accent text-center leading-tight">{b.start_time}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{b.booker_name}</p>
                  <p className="text-xs text-text-secondary truncate">{b.match_date} · {b.player_count} players · £{((b.per_player_pence * b.player_count) / 100).toFixed(0)}{pitches.length > 1 ? ` · ${b.pitch_name}` : ""}</p>
                </div>
                <StatusBadge status={b.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/venue/open-matches" className="bg-surface-2 border border-accent/30 rounded-2xl p-4 flex flex-col gap-2 col-span-2">
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>
            </svg>
            <p className="text-sm font-semibold">Host an Open Match</p>
            <span className="ml-auto text-[10px] font-bold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">New</span>
          </div>
          <p className="text-xs text-text-secondary">Fill empty slots — post a match teams can buy into.</p>
        </Link>
        <Link href="/venue/availability" className="bg-surface-2 border border-border rounded-2xl p-4 flex flex-col gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <p className="text-sm font-semibold">Set Availability</p>
          <p className="text-xs text-text-secondary">Manage weekly hours</p>
        </Link>
        <Link href="/venue/settings" className="bg-surface-2 border border-border rounded-2xl p-4 flex flex-col gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <p className="text-sm font-semibold">Pitch Settings</p>
          <p className="text-xs text-text-secondary">Edit venue details</p>
        </Link>
      </div>
    </div>
  );
}
