"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { toDateKey } from "@/lib/match-dates";

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
  category: Category;
  payerLabel: string | null;
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

// A booking's payment counts as settled only when it's "paid". Everything else
// (unpaid, pay-at-reception, pay-after-match) is money still to collect.
function isPaid(status: string) { return status === "paid"; }

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
        .select("id, match_date, start_time, end_time, total_price_pence, per_player_pence, player_count, status, booking_type, payment_status, booker_name, booked_by, stripe_payment_intent_id")
        .in("pitch_id", ps.map((p) => p.id)).order("match_date", { ascending: false });

      const rows = bks ?? [];
      const bookingIds = rows.map((b) => b.id);

      // Fetch the payment picture in three batched queries:
      //  • open_matches → the match_type (match / tournament / league) so we can
      //    categorise the listing bookings.
      //  • player_payments → a paid card charge for a booking (direct Book flow).
      //  • venue_transfers → the payout Unitr sent the venue. A paid transfer is
      //    the definitive "the venue got its money" signal and fires for BOTH
      //    credit- and card-paid Unitr bookings, so we reconcile against it.
      const [{ data: oms }, { data: pays }, { data: transfers }] = await Promise.all([
        bookingIds.length
          ? supabase.from("open_matches").select("id, booking_id, match_type").in("booking_id", bookingIds)
          : Promise.resolve({ data: [] as { id: string; booking_id: string; match_type: string }[] }),
        bookingIds.length
          ? supabase.from("player_payments").select("booking_id, status").in("booking_id", bookingIds)
          : Promise.resolve({ data: [] as { booking_id: string; status: string }[] }),
        bookingIds.length
          // team_id comes from supabase_venue_payouts.sql; without that migration
          // this select errors and would wipe out the whole payment picture, so
          // fall back to the columns that always exist.
          ? supabase.from("venue_transfers").select("booking_id, status, team_id").in("booking_id", bookingIds)
              .then(async (r) => r.error
                ? { data: ((await supabase.from("venue_transfers").select("booking_id, status").in("booking_id", bookingIds)).data ?? [])
                    .map((t) => ({ ...t, team_id: null })) }
                : r)
          : Promise.resolve({ data: [] as { booking_id: string; status: string; team_id: string | null }[] }),
      ]);
      const matchTypeByBooking = new Map((oms ?? []).map((o) => [o.booking_id, o.match_type]));
      const paidBookingIds = new Set((pays ?? []).filter((p) => p.status === "paid").map((p) => p.booking_id));
      const paidOutBookingIds = new Set((transfers ?? []).filter((t) => t.status === "paid" && t.booking_id).map((t) => t.booking_id));

      // Which team paid: for a single-team booking (match/direct), read the
      // team_id off its venue_transfers row. For a tournament, many teams
      // share one booking — list every team that entered via open_match_teams.
      const transferTeamIds = [...new Set((transfers ?? []).map((t) => t.team_id).filter(Boolean))] as string[];
      const { data: payerTeams } = transferTeamIds.length
        ? await supabase.from("teams").select("id, name").in("id", transferTeamIds)
        : { data: [] as { id: string; name: string }[] };
      const payerTeamName = new Map((payerTeams ?? []).map((t) => [t.id, t.name as string]));
      const teamIdByBooking = new Map((transfers ?? []).filter((t) => t.team_id).map((t) => [t.booking_id, t.team_id as string]));

      const tournamentOmIds = (oms ?? []).filter((o) => o.match_type === "tournament").map((o) => o.id);
      const { data: enteredTeams } = tournamentOmIds.length
        ? await supabase.from("open_match_teams").select("open_match_id, team_name").in("open_match_id", tournamentOmIds)
        : { data: [] as { open_match_id: string; team_name: string }[] };
      const omIdByBooking = new Map((oms ?? []).map((o) => [o.booking_id, o.id]));
      const enteredTeamsByOm = new Map<string, string[]>();
      for (const row of enteredTeams ?? []) {
        const list = enteredTeamsByOm.get(row.open_match_id) ?? [];
        list.push(row.team_name);
        enteredTeamsByOm.set(row.open_match_id, list);
      }

      // Reconcile Unitr (platform) bookings: if the money actually moved — a paid
      // card charge, a Stripe intent on the booking, or a completed venue payout —
      // mark it paid and persist the correction so it stays fixed.
      const toMarkPaid: string[] = [];
      const enriched = await Promise.all(rows.map(async (b) => {
        let name = b.booker_name;
        if (!name) {
          const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", b.booked_by).maybeSingle();
          name = (prof as { full_name: string } | null)?.full_name ?? "Unknown";
        }

        let payment = b.payment_status ?? "unpaid";
        const paidViaUnitr = b.booking_type === "platform" &&
          (paidBookingIds.has(b.id) || paidOutBookingIds.has(b.id) || Boolean(b.stripe_payment_intent_id));
        if (paidViaUnitr && payment !== "paid") { payment = "paid"; toMarkPaid.push(b.id); }

        const category: Category = b.booking_type === "manual" ? "manual"
          : b.booking_type === "open_match"
            ? (matchTypeByBooking.get(b.id) === "tournament" ? "tournament"
              : matchTypeByBooking.get(b.id) === "league" ? "league" : "match")
            : "match"; // platform = a team's match booked through Unitr

        const omId = omIdByBooking.get(b.id);
        const enteredNames = category === "tournament" && omId ? enteredTeamsByOm.get(omId) : undefined;
        const payerLabel = enteredNames && enteredNames.length > 0
          ? `${enteredNames.length} team${enteredNames.length === 1 ? "" : "s"} · ${enteredNames.join(", ")}`
          : teamIdByBooking.has(b.id) ? (payerTeamName.get(teamIdByBooking.get(b.id)!) ?? null) : null;

        return { ...b, booker_name: name, payment_status: payment, category, payerLabel, match_date: normalizeMatchDate(b.match_date) } as Booking;
      }));

      if (toMarkPaid.length) {
        await supabase.from("pitch_bookings").update({ payment_status: "paid" }).in("id", toMarkPaid);
      }
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

      {/* Category tabs — highlight matches / tournaments / leagues separately */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CATEGORY_TABS.map((c) => {
          const count = c.k === "all" ? bookings.length : bookings.filter((b) => b.category === c.k).length;
          return (
            <button key={c.k} onClick={() => setCategory(c.k)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${category === c.k ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
              {c.label}{count > 0 ? ` · ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filter === f ? "bg-text-primary/10 text-text-primary border-text-primary/30" : "bg-surface-2 text-text-secondary border-border"}`}>
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate">{b.booker_name}</p>
                          <CategoryBadge category={b.category} />
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {formatMatchDate(b.match_date)} · {b.start_time}{endTime ? `–${endTime}` : ""}
                        </p>
                        {b.payerLabel && <p className="text-[11px] text-text-secondary mt-0.5 truncate">Paid by {b.payerLabel}</p>}
                        <span className="text-[10px] text-text-secondary italic">
                          {b.booking_type === "manual" ? "External booking"
                            : b.booking_type === "platform" ? "Booked via Unitr" : "Listing"}
                        </span>
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
