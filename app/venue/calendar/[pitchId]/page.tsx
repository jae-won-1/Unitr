"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { TimePicker } from "@/components/DateTimePickers";
import { GenderCategoryPicker } from "@/components/GenderControls";
import { loadBookingPayments, persistPaidCorrections, type BookingPayment } from "@/lib/venue-payments";
import { loadVenuePitches, type VenuePitch } from "@/lib/venue-pitches";

// One pitch's calendar. Each pitch has its own (the sidebar lists them), so the
// columns are always days — a week of them, or one in the day view — and never
// pitches side by side.

// ── Constants ─────────────────────────────────────────────────
const SLOT_H = 32; // one half hour
const START_H = 7;
const END_H = 23;
const TOTAL_SLOTS = (END_H - START_H) * 2;
// Inset on every side of a booking block, so two back-to-back bookings read as
// two blocks rather than one tall one.
const GAP = 2;

// Booking colour is driven by what kind of booking it is — venues need to
// eyeball Uniter vs manual vs tournament slots at a glance. Solid fills, so
// each block stands off the white grid; league is the one light fill, so it
// takes dark text.
type BookingCategory = "uniter" | "manual" | "tournament" | "league" | "match";
const CATEGORY_COLORS: Record<BookingCategory, { bg: string; text: string }> = {
  uniter: { bg: "#1E9E5A", text: "#FFFFFF" },     // green — booked via Uniter (platform)
  manual: { bg: "#2563EB", text: "#FFFFFF" },     // blue — manual / external entry
  tournament: { bg: "#7C3AED", text: "#FFFFFF" }, // purple
  league: { bg: "#F5B800", text: "#3D2E00" },     // yellow
  match: { bg: "#E5484D", text: "#FFFFFF" },      // red — open match listing
};
const CATEGORY_LABELS: Record<BookingCategory, string> = {
  uniter: "Uniter booking",
  manual: "Manual",
  tournament: "Tournament",
  league: "League",
  match: "Open match",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// ── Types ─────────────────────────────────────────────────────
type Pitch = VenuePitch;
type Booking = {
  id: string;
  pitch_id: string;
  match_date: string;
  start_time: string;
  end_time: string | null;
  booker_name: string | null;
  status: string;
  booking_type: string;
  payment_status: string;
  notes: string | null;
  booked_by: string;
  total_price_pence?: number;
  per_player_pence?: number;
  player_count?: number;
  post_id?: string | null;
  stripe_payment_intent_id?: string | null;
  category?: BookingCategory;
  // Reconstructed from the payment ledgers — see lib/venue-payments. Absent
  // only for a booking added from this page before the next load.
  payment?: BookingPayment;
};

function categoryFor(booking: Booking, matchTypeByBooking: Map<string, string>): BookingCategory {
  if (booking.booking_type === "manual") return "manual";
  if (booking.booking_type === "open_match") {
    const mt = matchTypeByBooking.get(booking.id);
    if (mt === "tournament") return "tournament";
    if (mt === "league") return "league";
    return "match";
  }
  return "uniter"; // "platform" — booked by a team via the Uniter Book flow
}

// The view and date outlive switching pitch: moving from Pitch 1 to Pitch 2
// should show Pitch 2's same week, not jump back to today. Module state lasts
// as long as the tab, which is all this needs.
let remembered: { view: "day" | "week"; date: Date } | null = null;

// ── Helpers ───────────────────────────────────────────────────
const hhmm = (t: string) => t.slice(0, 5);

function timeToSlot(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h - START_H) * 2 + (m >= 30 ? 1 : 0);
}

function slotToTime(slot: number): string {
  const mins = START_H * 60 + slot * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function addOneHour(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function displayDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function toInputISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Normalise legacy "Sat, 13 Jun 2026" format to ISO "2026-06-13"
function normalizeMatchDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && MONTHS[m[2]] !== undefined) {
    const d = new Date(Number(m[3]), MONTHS[m[2]], Number(m[1]));
    return toInputISO(d);
  }
  return raw;
}

function fromInputISO(s: string): Date {
  const [y, mo, day] = s.split("-").map(Number);
  return new Date(y, mo - 1, day);
}

function getWeekDates(d: Date): Date[] {
  const mon = new Date(d);
  const dow = mon.getDay();
  mon.setDate(mon.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const nd = new Date(mon);
    nd.setDate(mon.getDate() + i);
    return nd;
  });
}

// The big heading: the month for a week (both months when it straddles two),
// the full date for a day.
function formatTitle(d: Date, view: "day" | "week"): string {
  if (view === "day") return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const wd = getWeekDates(d);
  const a = wd[0], b = wd[6];
  const short = (x: Date) => MONTHS[x.getMonth()].slice(0, 3);
  if (a.getMonth() === b.getMonth()) return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) return `${short(a)} – ${short(b)} ${b.getFullYear()}`;
  return `${short(a)} ${a.getFullYear()} – ${short(b)} ${b.getFullYear()}`;
}

function bookingPrice(b: Booking): number {
  if (b.payment?.entries) return b.payment.expectedPence;
  if (b.total_price_pence && b.total_price_pence > 0) return b.total_price_pence;
  if (b.per_player_pence && b.player_count) return b.per_player_pence * b.player_count;
  return 0;
}

const pounds = (pence: number) => `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;

// ── Booking block ─────────────────────────────────────────────
function BookingBlock({ booking, onClick }: {
  booking: Booking;
  onClick: () => void;
}) {
  const color = CATEGORY_COLORS[booking.category ?? "uniter"];
  const startSlot = Math.max(0, timeToSlot(booking.start_time));
  if (startSlot >= TOTAL_SLOTS) return null;
  const endTime = booking.end_time ?? addOneHour(booking.start_time);
  // An end at or before the start ran past midnight — draw it to the bottom.
  const rawEnd = timeToSlot(endTime);
  const endSlot = rawEnd <= startSlot ? TOTAL_SLOTS : Math.min(TOTAL_SLOTS, rawEnd);
  const span = Math.max(1, endSlot - startSlot);
  const compact = span < 2; // half an hour has room for one line

  const price = bookingPrice(booking);
  const pay = booking.payment;
  const payLabel = !pay ? null
    : pay.entries ? `${pay.entries.joined}/${pay.entries.max} teams · ${pounds(pay.collectedPence)} in`
    : pay.status === "paid" ? "Paid ✓"
    : pay.status === "part_paid" ? "Part paid"
    : pay.status === "after_match" ? "Due after match"
    : pay.status === "reception" ? "Pay at reception"
    : "Unpaid";
  const time = `${hhmm(booking.start_time)} – ${hhmm(endTime)}`;
  const name = booking.booker_name ?? "Booking";

  return (
    <button
      type="button"
      style={{
        position: "absolute",
        top: startSlot * SLOT_H + GAP,
        height: span * SLOT_H - GAP * 2,
        left: GAP * 2, right: GAP * 2,
        backgroundColor: color.bg,
        color: color.text,
      }}
      className="z-10 flex flex-col justify-start rounded-lg px-2 py-1 text-left overflow-hidden shadow-sm transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text-primary"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${time} · ${name}`}
    >
      {compact ? (
        <p className="text-[11px] font-bold leading-tight truncate">{hhmm(booking.start_time)} · {name}</p>
      ) : (
        <>
          <p className="text-[11px] font-bold leading-tight tabular-nums">{time}</p>
          <p className="text-[11px] font-medium leading-tight truncate mt-0.5">
            {name}{price > 0 && !pay?.entries ? ` · ${pounds(price)}` : ""}
          </p>
          {/* Payment at a glance: a listing shows how full it is, everything
              else whether the money is in. */}
          {payLabel && span >= 3 && (
            <p className="text-[10px] font-semibold leading-tight truncate mt-0.5 opacity-85">{payLabel}</p>
          )}
        </>
      )}
    </button>
  );
}

// ── Grid ──────────────────────────────────────────────────────
const HEADER_H = 52;

function TimeColumn() {
  return (
    <div className="w-14 flex-shrink-0 bg-surface sticky left-0 z-30 border-r border-border">
      <div style={{ height: HEADER_H }}
        className="bg-surface border-b border-border sticky top-0 z-30 flex items-end justify-center pb-2">
        <span className="text-[10px] font-medium text-text-secondary">Time</span>
      </div>
      {Array.from({ length: END_H - START_H }, (_, i) => (
        <div key={i} style={{ height: SLOT_H * 2 }} className="relative border-b border-border">
          <span className="absolute top-1 right-2 text-[11px] text-text-secondary tabular-nums">
            {String(START_H + i).padStart(2, "0")}:00
          </span>
        </div>
      ))}
    </div>
  );
}

function DayHeader({ date, isToday, wide }: { date: Date; isToday: boolean; wide: boolean }) {
  const dow = date.getDay();
  // Weekends stand out, as in a paper diary: Saturday blue, Sunday red.
  const tone = dow === 6 ? "text-accent-2" : dow === 0 ? "text-danger" : "text-text-primary";
  return (
    <div style={{ height: HEADER_H }}
      className="bg-surface border-b border-border sticky top-0 z-20 flex items-center justify-center gap-2 px-2">
      <span className={`text-xs font-semibold ${tone}`}>
        {wide ? WEEKDAYS[dow] : WEEKDAYS[dow].slice(0, 3)}
      </span>
      <span className={`text-sm font-bold w-7 h-7 rounded-full flex items-center justify-center tabular-nums ${
        isToday ? "bg-accent text-white" : tone
      }`}>
        {date.getDate()}
      </span>
    </div>
  );
}

function CalendarGrid({ dates, bookings, now, onCellClick, onBookingClick }: {
  dates: Date[];
  bookings: Booking[];
  now: Date;
  onCellClick: (date: Date, slotTime: string) => void;
  onBookingClick: (b: Booking) => void;
}) {
  const today = toInputISO(now);
  const single = dates.length === 1;
  const colMin = single ? 280 : 120;
  const nowMins = now.getHours() * 60 + now.getMinutes() - START_H * 60;
  const nowTop = nowMins >= 0 && nowMins < (END_H - START_H) * 60 ? (nowMins / 30) * SLOT_H : null;

  return (
    <div className="flex w-max min-w-full bg-surface">
      <TimeColumn />
      {/* Day columns — no overflow of their own: the grid wrapper is the one
          scroller for both axes, so the wheel always reaches it and the sticky
          headers stick to it. */}
      <div className="flex flex-1" style={{ minWidth: dates.length * colMin }}>
        {dates.map((date) => {
          const dateStr = toInputISO(date);
          const isToday = dateStr === today;
          const dayBookings = bookings.filter((b) => b.match_date === dateStr);
          return (
            <div key={dateStr} className="flex-1 border-r border-border last:border-r-0" style={{ minWidth: colMin }}>
              <DayHeader date={date} isToday={isToday} wide={single} />
              <div className={`relative ${isToday ? "bg-accent/[0.035]" : ""}`} style={{ height: TOTAL_SLOTS * SLOT_H }}>
                {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                  <div key={i} style={{ height: SLOT_H }}
                    role="button" aria-label={`Add a booking at ${slotToTime(i)}`}
                    className={`border-b ${i % 2 === 0 ? "border-dashed border-border/70" : "border-border"} cursor-pointer hover:bg-accent/[0.07] transition-colors`}
                    onClick={() => onCellClick(date, slotToTime(i))}
                  />
                ))}
                {isToday && nowTop !== null && (
                  <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                    <div className="h-0.5 bg-danger" />
                    <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-danger" />
                  </div>
                )}
                {dayBookings.map((b) => (
                  <BookingBlock key={b.id} booking={b} onClick={() => onBookingClick(b)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Add Booking Modal ─────────────────────────────────────────
// Booking types the venue can drop onto a slot. The last three all create an
// `open_matches` listing (so they appear in the players' Play feed) and reserve
// the slot via a `pitch_bookings` row; only `match_type` differs.
type BookingType = "manual" | "open_match" | "tournament" | "league";

const BOOKING_TYPES: { k: BookingType; label: string; desc: string; matchType?: string }[] = [
  { k: "manual", label: "Regular booking", desc: "Private hire, maintenance or a team paying directly." },
  { k: "open_match", label: "Open match", desc: "Block the slot and let teams buy in.", matchType: "match" },
  { k: "tournament", label: "Tournament", desc: "Multi-team event teams can enter.", matchType: "tournament" },
  { k: "league", label: "League", desc: "A league fixture teams can register for.", matchType: "league" },
];

// The booking type a form produces, as the calendar colours it.
const TYPE_CATEGORY: Record<BookingType, BookingCategory> = {
  manual: "manual", open_match: "match", tournament: "tournament", league: "league",
};

function TypeIcon({ type }: { type: BookingType }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };
  if (type === "manual") return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  if (type === "open_match") return <svg {...common}><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>;
  if (type === "tournament") return <svg {...common}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>;
  return <svg {...common}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
}

const inputCls = "bg-background border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-accent/60 placeholder:text-text-secondary text-text-primary";

function AddBookingModal({ pitches, defaults, onSave, onClose }: {
  pitches: Pitch[];
  defaults: { pitchId: string; date: string; startTime: string };
  onSave: (b: Booking) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  // null = on the type-picker step; otherwise we're on the form for that type.
  const [bookingType, setBookingType] = useState<BookingType | null>(null);
  const [form, setForm] = useState({
    pitch_id: defaults.pitchId,
    date: defaults.date,
    start_time: defaults.startTime,
    end_time: addOneHour(defaults.startTime),
    booker_name: "",
    notes: "",
  });
  // Manual bookings: how the team is paying. "reception" = pay in person at
  // the desk (often after the game) → recorded unpaid until the desk collects.
  const [manualPayment, setManualPayment] = useState<"paid" | "reception">("reception");
  const [omForm, setOmForm] = useState({
    title: "",
    format: "5-a-side",
    skill_level: "Mixed",
    price_per_team: "",
    max_teams: "2",
    description: "",
    // Men's or women's (lib/gender.ts) — only teams of it can enter. No default.
    gender_category: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setOm = (k: string, v: string) => setOmForm((f) => ({ ...f, [k]: v }));

  const isListing = bookingType !== null && bookingType !== "manual";
  const typeMeta = BOOKING_TYPES.find((t) => t.k === bookingType);
  const teamWord = bookingType === "league" ? "Teams in the league" : "Teams that can join";

  const handleSaveManual = async () => {
    if (!user) return;
    if (!form.booker_name.trim()) { setError("Booker / team name is required."); return; }
    if (form.start_time >= form.end_time) { setError("End time must be after start time."); return; }
    setSaving(true);
    setError(null);

    const matchDate = toInputISO(fromInputISO(form.date));
    const pitch = pitches.find((p) => p.id === form.pitch_id);

    const { data, error: dbErr } = await supabase.from("pitch_bookings").insert({
      pitch_id: form.pitch_id,
      booked_by: user.id,
      match_date: matchDate,
      start_time: form.start_time,
      end_time: form.end_time,
      total_price_pence: (pitch?.price_per_hour ?? 0) * 100,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: 0,
      status: "confirmed",
      booking_type: "manual",
      // Manager's choice: paid online now, or to be collected at reception.
      payment_status: manualPayment === "paid" ? "paid" : "reception",
      booker_name: form.booker_name.trim(),
      notes: form.notes.trim() || null,
    }).select().single();

    setSaving(false);
    if (dbErr) { setError(`Failed to save: ${dbErr.message}`); return; }
    onSave({ ...(data as Booking), category: "manual" });
  };

  const handleSaveListing = async () => {
    if (!user || !typeMeta) return;
    if (!omForm.title.trim()) { setError(`Give the ${typeMeta.label.toLowerCase()} a title.`); return; }
    if (!omForm.gender_category) { setError(`Choose whether this is a men's or women's ${typeMeta.label.toLowerCase()}.`); return; }
    if (form.start_time >= form.end_time) { setError("End time must be after start time."); return; }
    const maxTeams = Number(omForm.max_teams);
    if (!maxTeams || maxTeams < 2) { setError("Allow at least 2 teams."); return; }
    setSaving(true);
    setError(null);

    const matchDate = toInputISO(fromInputISO(form.date));
    const pitch = pitches.find((p) => p.id === form.pitch_id);
    const pricePence = Math.round(Number(omForm.price_per_team || "0") * 100);

    // 1) Reserve the slot on the calendar (also blocks /book and syncs to player portal)
    const { data: booking, error: bookErr } = await supabase.from("pitch_bookings").insert({
      pitch_id: form.pitch_id,
      booked_by: user.id,
      match_date: matchDate,
      start_time: form.start_time,
      end_time: form.end_time,
      booker_name: `${typeMeta.label}: ${omForm.title.trim()}`,
      booking_type: "open_match",
      total_price_pence: pricePence * maxTeams,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: 0,
      status: "confirmed",
      payment_status: "after_match",
    }).select().single();

    if (bookErr) { setSaving(false); setError(`Couldn't reserve the slot: ${bookErr.message}`); return; }

    // 2) Create the open match / tournament / league listing
    const { error: omErr } = await supabase.from("open_matches").insert({
      pitch_id: form.pitch_id,
      venue_owner_id: user.id,
      pitch_name: pitch?.name ?? "",
      venue_address: null,
      match_date: matchDate,
      start_time: form.start_time,
      end_time: form.end_time,
      title: omForm.title.trim(),
      match_type: typeMeta.matchType,
      format: omForm.format,
      skill_level: omForm.skill_level,
      price_per_team_pence: pricePence,
      max_teams: maxTeams,
      description: omForm.description.trim() || null,
      status: "open",
      booking_id: booking.id,
      gender_category: omForm.gender_category,
    });

    if (omErr) {
      await supabase.from("pitch_bookings").delete().eq("id", booking.id);
      setSaving(false);
      setError(
        omErr.code === "42P01"
          ? "The open_matches table doesn't exist yet — run supabase_open_matches.sql in Supabase first."
          : omErr.message.includes("gender_category")
          ? "Run supabase_gender_categories.sql in Supabase first."
          : `Couldn't create the listing: ${omErr.message}`
      );
      return;
    }

    setSaving(false);
    onSave({ ...(booking as Booking), category: TYPE_CATEGORY[typeMeta.k] });
  };

  const handleSave = () => bookingType === "manual" ? handleSaveManual() : handleSaveListing();

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface text-text-primary rounded-t-2xl md:rounded-2xl shadow-xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="px-5 pt-2 md:pt-5 pb-8 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {bookingType && (
                <button onClick={() => { setBookingType(null); setError(null); }}
                  className="w-8 h-8 rounded-full bg-surface-2 text-text-secondary flex items-center justify-center" title="Back">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
              )}
              <p className="text-lg font-bold">{bookingType ? typeMeta?.label : "New booking"}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 text-text-secondary flex items-center justify-center" title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* ── Step 1: pick a booking type ── */}
          {!bookingType && (
            <>
              <p className="text-sm text-text-secondary -mt-1">What kind of booking is this slot for?</p>
              <div className="grid grid-cols-1 gap-2">
                {BOOKING_TYPES.map((t) => {
                  const c = CATEGORY_COLORS[TYPE_CATEGORY[t.k]];
                  return (
                    <button key={t.k} onClick={() => { setBookingType(t.k); setError(null); }}
                      className="flex items-center gap-3 p-3 rounded-btn border border-border bg-surface hover:border-accent/60 hover:bg-accent/[0.03] transition-colors text-left">
                      {/* Tinted in the colour the booking will take on the calendar. */}
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${c.bg}1F`, color: c.bg === "#F5B800" ? "#9A7400" : c.bg }}>
                        <TypeIcon type={t.k} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{t.label}</p>
                        <p className="text-xs text-text-secondary">{t.desc}</p>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0 text-text-secondary"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Step 2: the form ── */}
          {bookingType && (
            <>
              {isListing && (
                <p className="text-xs text-text-secondary -mt-1">Block this slot and let teams buy in — it appears in the players&apos; Play feed.</p>
              )}

              {pitches.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">Pitch</label>
                  <select value={form.pitch_id} onChange={(e) => set("pitch_id", e.target.value)} className={inputCls}>
                    {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {bookingType === "manual" ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">Booker / Team Name</label>
                  <input value={form.booker_name} onChange={(e) => set("booker_name", e.target.value)}
                    placeholder="e.g. Hackney United" autoFocus className={inputCls} />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium">Title</label>
                    <input value={omForm.title} onChange={(e) => setOm("title", e.target.value)}
                      placeholder={bookingType === "tournament" ? "e.g. Summer 7s Cup" : bookingType === "league" ? "e.g. Tuesday Night League" : "e.g. Friday Night Friendly"} autoFocus
                      className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium">Format</label>
                      <select value={omForm.format} onChange={(e) => setOm("format", e.target.value)} className={inputCls}>
                        {["5-a-side", "7-a-side", "8-a-side", "11-a-side"].map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium">Level</label>
                      <select value={omForm.skill_level} onChange={(e) => setOm("skill_level", e.target.value)} className={inputCls}>
                        {["Mixed", "Casual", "Competitive"].map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium">Men&rsquo;s or women&rsquo;s</label>
                    <GenderCategoryPicker
                      value={omForm.gender_category === "male" || omForm.gender_category === "female" ? omForm.gender_category : null}
                      onChange={(v) => setOm("gender_category", v)} />
                  </div>
                </>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Date</label>
                <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">Start time</label>
                  <TimePicker value={form.start_time} selectedDate={form.date}
                    label="Start time" onChange={(t) => set("start_time", t)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">End time</label>
                  <TimePicker value={form.end_time} selectedDate={form.date}
                    label="End time" onChange={(t) => set("end_time", t)} />
                </div>
              </div>

              {bookingType === "manual" ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium">Notes <span className="text-text-secondary font-normal">(optional)</span></label>
                    <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
                      placeholder="e.g. Maintenance, private hire, league game…" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium">Payment</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { k: "paid", label: "Paid online", desc: "Already paid" },
                        { k: "reception", label: "Pay at reception", desc: "Collect in person" },
                      ] as const).map((opt) => {
                        const active = manualPayment === opt.k;
                        return (
                          <button key={opt.k} type="button" onClick={() => setManualPayment(opt.k)}
                            className={`rounded-btn border p-3 text-left transition-colors ${active ? "border-accent bg-accent/10" : "border-border bg-surface"}`}>
                            <p className={`text-sm font-semibold ${active ? "text-accent-ink" : ""}`}>{opt.label}</p>
                            <p className="text-[11px] text-text-secondary mt-0.5">{opt.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium">{bookingType === "league" ? "Entry fee per team (£)" : "Price per team (£)"}</label>
                      <input type="number" inputMode="decimal" value={omForm.price_per_team} onChange={(e) => setOm("price_per_team", e.target.value)}
                        placeholder="e.g. 40" className={inputCls} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium">{teamWord}</label>
                      <input type="number" inputMode="numeric" min={2} value={omForm.max_teams} onChange={(e) => setOm("max_teams", e.target.value)}
                        className={inputCls} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium">Description <span className="text-text-secondary font-normal">(optional)</span></label>
                    <input value={omForm.description} onChange={(e) => setOm("description", e.target.value)}
                      placeholder="Anything teams should know…" className={inputCls} />
                  </div>
                  {omForm.price_per_team && omForm.max_teams && (
                    <div className="bg-success-bg border border-success-border rounded-btn px-3 py-2.5">
                      <p className="text-xs text-text-secondary">Potential revenue if full</p>
                      <p className="text-sm font-bold text-accent-ink">£{(Number(omForm.price_per_team || 0) * Number(omForm.max_teams || 0)).toFixed(2)}</p>
                    </div>
                  )}
                </>
              )}

              {error && <p className="text-xs text-danger">{error}</p>}

              <button onClick={handleSave} disabled={saving}
                className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
                {saving ? "Saving…" : bookingType === "manual" ? "Add to Calendar" : `Post ${typeMeta?.label}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── View Booking Modal ────────────────────────────────────────
function ViewBookingModal({ booking, pitch, onClose, onCancel, onPaymentUpdate }: {
  booking: Booking;
  pitch: Pitch | undefined;
  onClose: () => void;
  onCancel: () => void;
  onPaymentUpdate: (id: string, status: string) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const endTime = booking.end_time ?? addOneHour(booking.start_time);
  const category = booking.category ?? "uniter";

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  };

  const payment = booking.payment;
  const paymentStatus = payment?.status ?? booking.payment_status ?? "unpaid";
  const price = bookingPrice(booking) / 100;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface text-text-primary rounded-t-2xl md:rounded-2xl shadow-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>

        {/* Scrollable content */}
        <div className="flex-1 px-5 pt-2 md:pt-5 pb-6 space-y-4 overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight">{booking.booker_name ?? "Uniter Booking"}</p>
              <p className="text-xs text-text-secondary mt-1 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[category].bg }} />
                {booking.booking_type === "platform" ? "Booked via Uniter" : CATEGORY_LABELS[category]}
              </p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 text-text-secondary flex items-center justify-center flex-shrink-0" title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div className="bg-panel border border-border rounded-btn p-4 space-y-2.5 text-sm">
            {[
              { label: "Pitch", value: pitch?.name ?? "—" },
              { label: "Date", value: /^\d{4}-\d{2}-\d{2}$/.test(booking.match_date) ? displayDate(fromInputISO(booking.match_date)) : booking.match_date },
              { label: "Time", value: `${hhmm(booking.start_time)} – ${hhmm(endTime)}` },
              ...(booking.notes ? [{ label: "Notes", value: booking.notes }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-text-secondary flex-shrink-0">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            ))}
          </div>

          {/* Payment status */}
          <div className="bg-panel border border-border rounded-btn p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Payment</p>
              {price > 0 && (
                <span className="text-sm font-bold text-accent-ink">£{price.toFixed(2)}</span>
              )}
            </div>

            {payment && (
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  payment.status === "paid" || payment.status === "part_paid" ? "bg-success-bg border-success-border text-accent-ink"
                    : payment.status === "unpaid" ? "bg-red-50 border-red-200 text-red-600"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                }`}>
                  {payment.status === "paid" ? "Paid" : payment.status === "part_paid" ? "Part paid"
                    : payment.status === "reception" ? "At reception" : payment.status === "after_match" ? "After match" : "Unpaid"}
                </span>
                <span className="text-[11px] text-text-secondary">{payment.detail}</span>
              </div>
            )}

            {payment?.payoutFailed && (
              <p className="text-[11px] text-amber-700">The customer paid, but Uniter&apos;s payout to your account failed — see Reports.</p>
            )}

            {/* Listing: many teams pay in over time, so show entries + money in. */}
            {payment?.entries && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">
                    {payment.entries.joined}/{payment.entries.max} teams entered
                    <span className="text-text-secondary/70"> · £{(payment.entries.pricePerTeamPence / 100).toFixed(2)} per team</span>
                  </span>
                  <span className="font-bold text-accent-ink">
                    £{(payment.collectedPence / 100).toFixed(2)}
                    <span className="text-text-secondary font-medium"> / £{(payment.expectedPence / 100).toFixed(2)}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div className="h-full bg-accent rounded-full"
                    style={{ width: `${payment.expectedPence > 0 ? Math.min(100, Math.round((payment.collectedPence / payment.expectedPence) * 100)) : 0}%` }} />
                </div>
                {payment.payers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {payment.payers.map((p) => (
                      <span key={p.name} className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                        p.paid ? "bg-success-bg border-success-border text-accent-ink" : "bg-surface border-border text-text-secondary"
                      }`}>
                        {p.name} · £{(p.amountPence / 100).toFixed(2)}{p.paid ? " ✓" : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Manual override — pointless for a listing, whose status is the
                sum of its entries. */}
            {!payment?.entries && (
            <div className="flex gap-2">
              {(() => {
                // Show the payment states that make sense for this booking kind:
                // manual → reception (pay in person); open_match → after_match.
                const labels: Record<string, string> = {
                  unpaid: "Unpaid", reception: "At Reception", after_match: "After Match", paid: "Paid",
                };
                const middle = booking.booking_type === "manual" ? "reception"
                  : booking.booking_type === "open_match" ? "after_match" : null;
                const options = (middle ? ["unpaid", middle, "paid"] : ["unpaid", "paid"]) as string[];
                return options.map((s) => {
                  const active = paymentStatus === s;
                  return (
                    <button key={s} onClick={() => onPaymentUpdate(booking.id, s)}
                      className={`flex-1 py-2 rounded-btn text-xs font-bold border transition-colors ${
                        active
                          ? s === "paid" ? "bg-accent text-white border-accent"
                            : s === "unpaid" ? "bg-red-50 text-red-600 border-red-300"
                            : "bg-amber-50 text-amber-700 border-amber-300"
                          : "bg-surface border-border text-text-secondary hover:text-text-primary"
                      }`}>
                      {labels[s]}
                    </button>
                  );
                });
              })()}
            </div>
            )}
          </div>

          <div className="flex gap-2 pb-2">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-btn border border-border text-sm font-semibold text-text-secondary">
              Close
            </button>
            <button onClick={handleCancel} disabled={cancelling}
              className="flex-1 py-3 rounded-btn border border-red-200 bg-red-50 text-red-600 text-sm font-semibold disabled:opacity-40">
              {cancelling ? "Cancelling…" : "Cancel Booking"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function PitchCalendarPage({ params }: { params: { pitchId: string } }) {
  const { pitchId } = params;
  const { user } = useAuth();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => remembered?.date ?? new Date());
  const [view, setView] = useState<"day" | "week">(() => remembered?.view ?? "week");
  const [loading, setLoading] = useState(true);
  const [addDefaults, setAddDefaults] = useState<{ pitchId: string; date: string; startTime: string } | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => { remembered = { view, date: selectedDate }; }, [view, selectedDate]);

  // Moves the "now" line and keeps "today" right across midnight.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    let live = true;
    async function load() {
      setLoading(true);
      const ps = await loadVenuePitches(user!.id);
      if (!live) return;
      setPitches(ps);
      // Only this venue's own pitch — an id from another venue shows nothing.
      if (!ps.some((p) => p.id === pitchId)) { setBookings([]); setLoading(false); return; }

      const { data: bks } = await supabase.from("pitch_bookings")
        .select("id, pitch_id, match_date, start_time, end_time, booker_name, status, booking_type, notes, booked_by, payment_status, total_price_pence, per_player_pence, player_count, post_id, stripe_payment_intent_id")
        .eq("pitch_id", pitchId)
        .neq("status", "cancelled");

      const rows = bks ?? [];
      const openMatchIds = rows.filter((b) => b.booking_type === "open_match").map((b) => b.id);
      const { data: oms } = openMatchIds.length
        ? await supabase.from("open_matches").select("booking_id, match_type").in("booking_id", openMatchIds)
        : { data: [] as { booking_id: string; match_type: string }[] };
      const matchTypeByBooking = new Map((oms ?? []).map((o) => [o.booking_id, o.match_type]));

      // What has actually been paid against each booking — a match settled from
      // team credit, a tournament filling up team by team. The stored
      // payment_status is only ever written at booking time, so on its own it
      // shows everything as unpaid forever.
      const payments = await loadBookingPayments(rows);

      // Platform bookings carry no name of their own — use the booker's profile.
      const unnamed = Array.from(new Set(rows.filter((b) => !b.booker_name).map((b) => b.booked_by)));
      const { data: profs } = unnamed.length
        ? await supabase.from("profiles").select("id, full_name").in("id", unnamed)
        : { data: [] as { id: string; full_name: string | null }[] };
      const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name]));

      const enriched = rows.map((b) => {
        const booker_name = b.booker_name ?? nameById.get(b.booked_by) ?? "Uniter Booking";
        const payment = payments.get(b.id);
        const withName = { ...b, booker_name, payment, payment_status: payment?.status ?? b.payment_status } as Booking;
        return { ...withName, category: categoryFor(withName, matchTypeByBooking), match_date: normalizeMatchDate(b.match_date) };
      });

      await persistPaidCorrections(rows, payments);
      if (!live) return;
      setBookings(enriched);
      setLoading(false);
    }
    load();
    return () => { live = false; };
  }, [user, pitchId]);

  const pitch = pitches.find((p) => p.id === pitchId);

  const navigate = (dir: -1 | 1) => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + (view === "week" ? dir * 7 : dir));
      return nd;
    });
  };

  const openAdd = (date: Date, startTime: string) => {
    setAddDefaults({ pitchId, date: toInputISO(date), startTime });
  };

  const handleCancelBooking = async () => {
    if (!selectedBooking) return;
    await supabase.from("pitch_bookings").update({ status: "cancelled" }).eq("id", selectedBooking.id);
    setBookings((prev) => prev.filter((b) => b.id !== selectedBooking.id));
    setSelectedBooking(null);
  };

  const handlePaymentUpdate = async (id: string, status: string) => {
    await supabase.from("pitch_bookings").update({ payment_status: status }).eq("id", id);
    const apply = (b: Booking): Booking => ({
      ...b,
      payment_status: status,
      payment: b.payment && {
        ...b.payment,
        status: status as BookingPayment["status"],
        collectedPence: status === "paid" ? b.payment.expectedPence : 0,
        detail: status === "paid" ? "Marked paid by the venue"
          : status === "reception" ? "Collected at the venue" : "Due after the match",
      },
    });
    setBookings((prev) => prev.map((b) => b.id === id ? apply(b) : b));
    setSelectedBooking((b) => b && b.id === id ? apply(b) : b);
  };

  const weekDates = getWeekDates(selectedDate);
  const dates = view === "day" ? [selectedDate] : weekDates;
  const visibleDates = new Set(dates.map((d) => toInputISO(d)));
  // A booking added from the modal onto another pitch belongs on that pitch's calendar.
  const visibleBookings = bookings.filter((b) => b.pitch_id === pitchId && visibleDates.has(b.match_date));

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );

  if (!pitch) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">Pitch not found</p>
      <p className="text-sm text-text-secondary max-w-xs">It may have been removed, or it belongs to another venue.</p>
      <a href="/venue/calendar" className="px-6 py-3 bg-accent text-white rounded-btn font-bold text-sm">Open your calendar</a>
    </div>
  );

  const navBtn = "w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors";

  return (
    <div className="flex flex-col h-venue-pane">
      {/* Toolbar */}
      <div className="px-4 md:px-6 pt-4 pb-3 border-b border-border bg-surface flex-shrink-0 space-y-3">
        <div className="flex items-center gap-x-2 gap-y-3 flex-wrap">
          <div className="min-w-0 mr-2">
            <p className="text-xs font-semibold text-text-secondary truncate flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="12" y1="5" x2="12" y2="19"/><circle cx="12" cy="12" r="2.5"/></svg>
              {pitch.name}
            </p>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight leading-tight">{formatTitle(selectedDate, view)}</h1>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => setSelectedDate(new Date())}
              className="h-9 px-3.5 rounded-btn bg-surface-2 text-sm font-semibold text-text-primary hover:bg-border transition-colors">
              Today
            </button>
            <button onClick={() => navigate(-1)} className={navBtn} title={view === "week" ? "Previous week" : "Previous day"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button onClick={() => navigate(1)} className={navBtn} title={view === "week" ? "Next week" : "Next day"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          <div className="flex bg-surface-2 rounded-btn p-1 gap-0.5">
            {(["day", "week"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 h-7 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  view === v ? "bg-accent text-white shadow-sm" : "text-text-secondary hover:text-text-primary"
                }`}>
                {v}
              </button>
            ))}
          </div>

          <button
            onClick={() => openAdd(selectedDate, "09:00")}
            className="ml-auto flex items-center gap-1.5 h-9 px-4 rounded-btn bg-accent text-white text-sm font-bold hover:brightness-110 transition-[filter]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add booking
          </button>
        </div>

        {/* Colour key — always all five, so it never changes shape. */}
        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
          {(Object.keys(CATEGORY_COLORS) as BookingCategory[]).map((c) => (
            <div key={c} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[c].bg }} />
              <span className="text-xs text-text-secondary">{CATEGORY_LABELS[c]}</span>
            </div>
          ))}
          <span className="ml-auto text-xs text-text-secondary">
            {visibleBookings.length} {visibleBookings.length === 1 ? "booking" : "bookings"} {view === "week" ? "this week" : "this day"}
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain bg-surface">
        <CalendarGrid
          dates={dates}
          bookings={visibleBookings}
          now={now}
          onCellClick={openAdd}
          onBookingClick={setSelectedBooking}
        />
      </div>

      {addDefaults && (
        <AddBookingModal
          pitches={pitches}
          defaults={addDefaults}
          onSave={(b) => { setBookings((prev) => [...prev, b]); setAddDefaults(null); }}
          onClose={() => setAddDefaults(null)}
        />
      )}

      {selectedBooking && (
        <ViewBookingModal
          booking={selectedBooking}
          pitch={pitches.find((p) => p.id === selectedBooking.pitch_id)}
          onClose={() => setSelectedBooking(null)}
          onCancel={handleCancelBooking}
          onPaymentUpdate={handlePaymentUpdate}
        />
      )}
    </div>
  );
}
