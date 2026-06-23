"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
function normalizeMatchDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && MONTHS[m[2]] !== undefined) {
    const d = new Date(Number(m[3]), MONTHS[m[2]], Number(m[1]));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return raw;
}
function formatMatchDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

type Booking = {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string | null;
  total_price_pence: number;
  per_player_pence: number;
  player_count: number;
  status: string;
  booking_type: string;
  payment_status: string;
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

function PaymentBadge({ status }: { status: string }) {
  if (status === "paid") return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent">Paid</span>
  );
  if (status === "after_match") return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">Pay after match</span>
  );
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Unpaid</span>
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
      const { data: ps } = await supabase.from("pitches").select("id")
        .eq("venue_owner_id", user!.id);
      if (!ps || ps.length === 0) { setLoading(false); return; }

      const { data: bks } = await supabase.from("pitch_bookings")
        .select("id, match_date, start_time, end_time, total_price_pence, per_player_pence, player_count, status, booking_type, payment_status, booker_name, booked_by")
        .in("pitch_id", ps.map((p) => p.id)).order("match_date", { ascending: false });

      // Use booker_name from DB if set (manual bookings), otherwise look up profile
      const enriched = await Promise.all((bks ?? []).map(async (b) => {
        let name = b.booker_name;
        if (!name) {
          const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", b.booked_by).maybeSingle();
          name = (prof as { full_name: string } | null)?.full_name ?? "Unknown";
        }
        return { ...b, booker_name: name, payment_status: b.payment_status ?? "unpaid", match_date: normalizeMatchDate(b.match_date) } as Booking;
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

  const updatePaymentStatus = async (id: string, payment_status: string) => {
    await supabase.from("pitch_bookings").update({ payment_status }).eq("id", id);
    setBookings((b) => b.map((x) => x.id === id ? { ...x, payment_status } : x));
  };

  const filtered = filter === "All" ? bookings : bookings.filter((b) => b.status === filter.toLowerCase());

  // Group by upcoming vs past using match_date string comparison
  const today = new Date();
  const grouped: Record<string, Booking[]> = {};
  for (const b of filtered) {
    // match_date is display string like "Fri, 12 Jun 2026" — compare loosely by parsing
    const isPast = (() => {
      try {
        return new Date(b.match_date + "T12:00:00") < today;
      } catch { return false; }
    })();
    const key = isPast ? "Past" : "Upcoming";
    grouped[key] = grouped[key] ? [...grouped[key], b] : [b];
  }

  const getPrice = (b: Booking) => {
    if (b.total_price_pence && b.total_price_pence > 0) return b.total_price_pence / 100;
    if (b.per_player_pence && b.player_count) return (b.per_player_pence * b.player_count) / 100;
    return 0;
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto space-y-5">
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
        ["Upcoming", "Past"].filter((g) => grouped[g]?.length).map((group) => (
          <div key={group}>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{group}</p>
            <div className="space-y-3">
              {grouped[group].map((b) => {
                const price = getPrice(b);
                const endTime = b.end_time ?? "";
                return (
                  <div key={b.id} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="font-semibold text-sm truncate">{b.booker_name}</p>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {formatMatchDate(b.match_date)} · {b.start_time}{endTime ? `–${endTime}` : ""}
                        </p>
                        {b.booking_type === "manual" && (
                          <span className="text-[10px] text-text-secondary italic">External booking</span>
                        )}
                      </div>
                      <StatusBadge status={b.status} />
                    </div>

                    {/* Price + payment status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PaymentBadge status={b.payment_status} />
                      </div>
                      {price > 0 && (
                        <span className="text-sm font-bold text-accent">£{price.toFixed(2)}</span>
                      )}
                    </div>

                    {/* Payment status controls */}
                    {b.status !== "cancelled" && b.payment_status !== "paid" && (
                      <div className="flex gap-2">
                        <button onClick={() => updatePaymentStatus(b.id, "paid")}
                          className="flex-1 py-2 rounded-xl bg-accent text-black text-xs font-bold">
                          Mark as Paid
                        </button>
                        {b.payment_status !== "after_match" && (
                          <button onClick={() => updatePaymentStatus(b.id, "after_match")}
                            className="flex-1 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-semibold">
                            Pay After Match
                          </button>
                        )}
                      </div>
                    )}

                    {/* Booking status controls */}
                    {b.status !== "cancelled" && (
                      <div className="flex gap-2">
                        {b.status === "pending" && (
                          <button onClick={() => updateStatus(b.id, "confirmed")}
                            className="flex-1 py-2 rounded-xl border border-accent/40 text-accent text-xs font-semibold">
                            Confirm Booking
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
