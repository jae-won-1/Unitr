"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Booking = {
  id: string;
  match_date: string;
  start_time: string;
  player_count: number;
  per_player_pence: number;
  unitr_fee_pence: number;
  status: string;
  booker_name: string;
};

const STATUS_FILTERS = ["All", "Confirmed", "Pending", "Cancelled"] as const;

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    confirmed: "bg-accent/10 text-accent",
    pending: "bg-yellow-500/10 text-yellow-400",
    cancelled: "bg-red-500/10 text-red-400",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${map[status] ?? map.pending}`}>
      {status}
    </span>
  );
}

export default function VenueBookingsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: p } = await supabase.from("pitches").select("id")
        .eq("venue_owner_id", user!.id).maybeSingle();
      if (!p) { setLoading(false); return; }

      const { data: bks } = await supabase.from("pitch_bookings")
        .select("id, match_date, start_time, player_count, per_player_pence, unitr_fee_pence, status, booked_by")
        .eq("pitch_id", p.id).order("match_date", { ascending: false });

      const enriched = await Promise.all((bks ?? []).map(async (b) => {
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", b.booked_by).maybeSingle();
        return { ...b, booker_name: (prof as { full_name: string } | null)?.full_name ?? "Unknown" } as Booking;
      }));
      setBookings(enriched);
      setLoading(false);
    }
    load();
  }, [user]);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("pitch_bookings").update({ status }).eq("id", id);
    setBookings((b) => b.map((x) => x.id === id ? { ...x, status } : x));
  };

  const filtered = filter === "All" ? bookings : bookings.filter((b) => b.status === filter.toLowerCase());

  const grouped: Record<string, Booking[]> = {};
  for (const b of filtered) {
    const key = b.match_date >= new Date().toISOString().slice(0, 10) ? "Upcoming" : "Past";
    grouped[key] = grouped[key] ? [...grouped[key], b] : [b];
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold">Bookings</h1>
        <p className="text-xs text-text-secondary mt-0.5">{bookings.length} total booking{bookings.length !== 1 ? "s" : ""}</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${filter === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-10 text-center">
          <p className="text-sm text-text-secondary">No {filter !== "All" ? filter.toLowerCase() : ""} bookings</p>
        </div>
      ) : (
        Object.entries(grouped).map(([group, items]) => (
          <div key={group}>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{group}</p>
            <div className="space-y-3">
              {items.map((b) => {
                const pitchRevenue = (b.per_player_pence * b.player_count) / 100;
                const isFuture = b.match_date >= new Date().toISOString().slice(0, 10);
                return (
                  <div key={b.id} className="bg-surface-2 border border-border rounded-2xl p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-sm">{b.booker_name}</p>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {new Date(b.match_date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {b.start_time}
                        </p>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs mb-3">
                      <span className="text-text-secondary">{b.player_count} players</span>
                      <span className="font-bold text-accent">£{pitchRevenue.toFixed(2)}</span>
                    </div>
                    {isFuture && b.status !== "cancelled" && (
                      <div className="flex gap-2">
                        {b.status === "pending" && (
                          <button onClick={() => updateStatus(b.id, "confirmed")}
                            className="flex-1 py-2 rounded-xl bg-accent text-black text-xs font-bold">
                            Confirm
                          </button>
                        )}
                        <button onClick={() => updateStatus(b.id, "cancelled")}
                          className="flex-1 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-semibold">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
