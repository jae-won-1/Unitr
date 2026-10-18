"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { toDateKey } from "@/lib/match-dates";
import { loadBookingPayments, persistPaidCorrections, type BookingPayment } from "@/lib/venue-payments";

// Legacy dates are stored uppercase ("Wed, 03 JUN 2026"), which the previous
// case-sensitive month lookup here missed — toDateKey is case-insensitive.
function normalizeMatchDate(raw: string): string {
  return toDateKey(raw) || raw;
}
function formatMatchDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

type Category = "match" | "tournament" | "league" | "manual";

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
  post_id: string | null;
  stripe_payment_intent_id: string | null;
  category: Category;
  payerLabel: string | null;
  // What actually got paid, reconstructed from the ledgers — see lib/venue-payments.
  payment: BookingPayment;
};

const STATUS_FILTERS = ["All", "Confirmed", "Pending", "Cancelled"] as const;

const CATEGORY_TABS: { k: "all" | Category; label: string }[] = [
  { k: "all", label: "All" },
  { k: "match", label: "Matches" },
  { k: "tournament", label: "Tournaments" },
  { k: "league", label: "Leagues" },
  { k: "manual", label: "Manual" },
];

const CATEGORY_META: Record<Category, { label: string; cls: string }> = {
  match: { label: "Match", cls: "bg-accent/10 text-accent" },
  tournament: { label: "Tournament", cls: "bg-purple-500/10 text-purple-400" },
  league: { label: "League", cls: "bg-blue-500/10 text-blue-400" },
  manual: { label: "Manual", cls: "bg-surface text-text-secondary" },
};

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

function CategoryBadge({ category }: { category: Category }) {
  const m = CATEGORY_META[category];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
}

function PaymentBadge({ status }: { status: string }) {
  if (status === "paid") return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent">Paid</span>
  );
  if (status === "part_paid") return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent/80 border border-accent/20">Part paid</span>
  );
  if (status === "reception") return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">Pay at reception</span>
  );
  if (status === "after_match") return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">Pay after match</span>
  );
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Unpaid</span>
  );
}

// A button that names the filter and its current choice; the choices open in
// a menu under it. Green once narrowed, so a filtered list never passes for
// the whole one.
function FilterDropdown<K extends string>({ label, value, options, onChange }: {
  label: string;
  value: K;
  options: { k: K; label: string; count?: number }[];
  onChange: (k: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.k === value) ?? options[0];
  const narrowed = value !== options[0].k;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={`flex items-center gap-2 h-9 pl-3.5 pr-3 rounded-btn border text-sm transition-colors ${
          narrowed ? "bg-accent/10 border-accent/40 text-accent-ink" : "bg-surface border-border text-text-primary hover:border-text-secondary/40"
        }`}>
        <span className={narrowed ? "" : "text-text-secondary"}>{label}:</span>
        <span className="font-semibold">{current.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full mt-1.5 z-50 min-w-[12rem] bg-surface border border-border rounded-btn shadow-lg py-1">
          {options.map((o) => {
            const active = o.k === value;
            return (
              <button key={o.k} role="option" aria-selected={active}
                onClick={() => { onChange(o.k); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-2 ${active ? "text-accent-ink font-semibold" : "text-text-primary"}`}>
                <span className="w-4 flex-shrink-0">
                  {active && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </span>
                <span className="flex-1">{o.label}</span>
                {o.count !== undefined && <span className="text-xs text-text-secondary tabular-nums">{o.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function VenueBookingsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [category, setCategory] = useState<"all" | Category>("all");

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: ps } = await supabase.from("pitches").select("id")
        .eq("venue_owner_id", user!.id);
      if (!ps || ps.length === 0) { setLoading(false); return; }

      const { data: bks } = await supabase.from("pitch_bookings")
        .select("id, match_date, start_time, end_time, total_price_pence, per_player_pence, player_count, status, booking_type, payment_status, booker_name, booked_by, post_id, stripe_payment_intent_id")
        .in("pitch_id", ps.map((p) => p.id)).order("match_date", { ascending: false });

      const rows = bks ?? [];
      const bookingIds = rows.map((b) => b.id);

      // Categorise the listing bookings (match / tournament / league)…
      const { data: oms } = bookingIds.length
        ? await supabase.from("open_matches").select("id, booking_id, match_type").in("booking_id", bookingIds)
        : { data: [] as { id: string; booking_id: string; match_type: string }[] };
      const matchTypeByBooking = new Map((oms ?? []).map((o) => [o.booking_id, o.match_type]));

      // …and reconstruct what has actually been paid against each one.
      const payments = await loadBookingPayments(rows);

      const enriched = await Promise.all(rows.map(async (b) => {
        let name = b.booker_name;
        if (!name) {
          const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", b.booked_by).maybeSingle();
          name = (prof as { full_name: string } | null)?.full_name ?? "Unknown";
        }

        const payment = payments.get(b.id)!;
        const category: Category = b.booking_type === "manual" ? "manual"
          : b.booking_type === "open_match"
            ? (matchTypeByBooking.get(b.id) === "tournament" ? "tournament"
              : matchTypeByBooking.get(b.id) === "league" ? "league" : "match")
            : "match"; // platform = a team's match booked through Uniter

        const paidNames = payment.payers.filter((p) => p.paid).map((p) => p.name);
        const payerLabel = paidNames.length > 0 ? paidNames.join(", ") : null;

        return {
          ...b,
          booker_name: name,
          payment_status: payment.status,
          payment,
          category,
          payerLabel,
          match_date: normalizeMatchDate(b.match_date),
        } as Booking;
      }));

      // Persist the correction so anything still reading payment_status agrees.
      await persistPaidCorrections(rows, payments);
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
    setBookings((b) => b.map((x) => x.id === id ? {
      ...x,
      payment_status,
      payment: {
        ...x.payment,
        status: payment_status as BookingPayment["status"],
        collectedPence: payment_status === "paid" ? x.payment.expectedPence : 0,
        detail: payment_status === "paid" ? "Marked paid by the venue" : "Due after the match",
      },
    } : x));
  };

  const filtered = bookings
    .filter((b) =>
      (filter === "All" || b.status === filter.toLowerCase()) &&
      (category === "all" || b.category === category)
    )
    // Most recent first — match_date is already normalized to ISO above, so
    // this sorts correctly even for legacy display-string rows.
    .sort((a, b) => `${b.match_date} ${b.start_time}`.localeCompare(`${a.match_date} ${a.start_time}`));

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

      {/* Filters — booking type and status, one dropdown each */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterDropdown
          label="Type"
          value={category}
          options={CATEGORY_TABS.map((c) => ({
            k: c.k,
            label: c.label,
            count: c.k === "all" ? bookings.length : bookings.filter((b) => b.category === c.k).length,
          }))}
          onChange={setCategory}
        />
        <FilterDropdown
          label="Status"
          value={filter}
          options={STATUS_FILTERS.map((f) => ({ k: f, label: f }))}
          onChange={setFilter}
        />
        {(category !== "all" || filter !== "All") && (
          <button onClick={() => { setCategory("all"); setFilter("All"); }}
            className="px-2 py-2 text-xs font-medium text-text-secondary hover:text-text-primary">
            Clear
          </button>
        )}
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate">{b.booker_name}</p>
                          <CategoryBadge category={b.category} />
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {formatMatchDate(b.match_date)} · {b.start_time}{endTime ? `–${endTime}` : ""}
                        </p>
                        {b.payerLabel && <p className="text-[11px] text-text-secondary mt-0.5 truncate">Paid by {b.payerLabel}</p>}
                        {b.payment.payoutFailed && (
                          <p className="text-[11px] text-yellow-400 mt-0.5">Customer paid · Uniter payout failed</p>
                        )}
                        <span className="text-[10px] text-text-secondary italic">
                          {b.booking_type === "manual" ? "External booking"
                            : b.booking_type === "platform" ? "Booked via Uniter" : "Listing"}
                        </span>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>

                    {/* Price + payment status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PaymentBadge status={b.payment_status} />
                        <span className="text-[11px] text-text-secondary">{b.payment.detail}</span>
                      </div>
                      {(b.payment.entries ? b.payment.expectedPence > 0 : price > 0) && (
                        <span className="text-sm font-bold text-accent">
                          £{((b.payment.entries ? b.payment.expectedPence / 100 : price)).toFixed(2)}
                        </span>
                      )}
                    </div>

                    {/* Multi-payer listing: teams buy in one at a time, so show the
                        entries filled and the money in so far rather than one flag. */}
                    {b.payment.entries && (
                      <div className="bg-surface border border-border rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-text-secondary">
                            {b.payment.entries.joined}/{b.payment.entries.max} teams entered
                            <span className="text-text-secondary/70"> · £{(b.payment.entries.pricePerTeamPence / 100).toFixed(2)} per team</span>
                          </span>
                          <span className="font-bold text-accent">
                            £{(b.payment.collectedPence / 100).toFixed(2)}
                            <span className="text-text-secondary font-medium"> / £{(b.payment.expectedPence / 100).toFixed(2)}</span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-border overflow-hidden">
                          <div className="h-full bg-accent rounded-full transition-all"
                            style={{ width: `${b.payment.expectedPence > 0 ? Math.min(100, Math.round((b.payment.collectedPence / b.payment.expectedPence) * 100)) : 0}%` }} />
                        </div>
                        {b.payment.payers.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {b.payment.payers.map((p) => (
                              <span key={p.name} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                                p.paid ? "bg-accent/10 border-accent/30 text-accent" : "bg-surface-2 border-border text-text-secondary"
                              }`}>
                                {p.name} · £{(p.amountPence / 100).toFixed(2)}{p.paid ? " ✓" : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Payment status controls. A listing's status comes from its
                        entries, so there's nothing sensible to override there. */}
                    {b.status !== "cancelled" && b.payment_status !== "paid" && !b.payment.entries && (
                      <div className="flex gap-2">
                        <button onClick={() => updatePaymentStatus(b.id, "paid")}
                          className="flex-1 py-2 rounded-xl bg-accent text-white text-xs font-bold">
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
