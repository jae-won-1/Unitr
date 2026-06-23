"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

// ── Constants ─────────────────────────────────────────────────
const SLOT_H = 52;
const START_H = 7;
const END_H = 23;
const TOTAL_SLOTS = (END_H - START_H) * 2;

const COLORS = [
  { bg: "#00E676", text: "#000" },
  { bg: "#3B82F6", text: "#fff" },
  { bg: "#A855F7", text: "#fff" },
  { bg: "#F97316", text: "#fff" },
  { bg: "#EC4899", text: "#fff" },
  { bg: "#14B8A6", text: "#fff" },
];

// ── Types ─────────────────────────────────────────────────────
type Pitch = { id: string; name: string; price_per_hour: number };
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
};

// ── Helpers ───────────────────────────────────────────────────
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

function formatHeaderDate(d: Date, view: "day" | "week"): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  if (view === "day") return `${weekdays[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  const wd = getWeekDates(d);
  return `${wd[0].getDate()} – ${wd[6].getDate()} ${months[wd[6].getMonth()]} ${wd[6].getFullYear()}`;
}

// ── Time labels (left column) ─────────────────────────────────
const TIME_LABELS: string[] = [];
for (let h = START_H; h < END_H; h++) {
  TIME_LABELS.push(`${String(h).padStart(2, "0")}:00`);
  TIME_LABELS.push("");
}

// ── Booking block ─────────────────────────────────────────────
function BookingBlock({ booking, color, onClick }: {
  booking: Booking;
  color: typeof COLORS[0];
  onClick: () => void;
}) {
  const startSlot = Math.max(0, timeToSlot(booking.start_time));
  const endTime = booking.end_time ?? addOneHour(booking.start_time);
  const endSlot = Math.min(TOTAL_SLOTS, timeToSlot(endTime));
  const height = Math.max(SLOT_H / 2, (endSlot - startSlot) * SLOT_H - 2);
  const top = startSlot * SLOT_H + 1;

  return (
    <div
      style={{
        position: "absolute", top, left: 2, right: 2, height,
        backgroundColor: `${color.bg}CC`,
        borderLeft: `3px solid ${color.bg}`,
        borderRadius: 8,
        zIndex: 10,
      }}
      className="cursor-pointer overflow-hidden px-2 py-1"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <p className="text-[11px] font-bold leading-tight truncate" style={{ color: color.text }}>
        {booking.booker_name ?? "Booking"}
      </p>
      <p className="text-[10px] leading-tight" style={{ color: color.text, opacity: 0.75 }}>
        {booking.start_time}–{endTime}
      </p>
      {booking.booking_type === "manual" && (
        <p className="text-[9px] leading-tight" style={{ color: color.text, opacity: 0.6 }}>Manual</p>
      )}
    </div>
  );
}

// ── Day View ──────────────────────────────────────────────────
function DayView({ pitches, bookings, onCellClick, onBookingClick }: {
  pitches: Pitch[];
  bookings: Booking[];
  onCellClick: (pitchId: string, slotTime: string) => void;
  onBookingClick: (b: Booking) => void;
}) {
  const gridH = TOTAL_SLOTS * SLOT_H;

  return (
    <div className="flex">
      {/* Time column */}
      <div className="w-14 flex-shrink-0 border-r border-border">
        <div style={{ height: 40 }} className="border-b border-border bg-[#0e0e0e] sticky top-0 z-30" />
        {TIME_LABELS.map((label, i) => (
          <div key={i} style={{ height: SLOT_H }}
            className={`border-b ${i % 2 === 0 ? "border-border/50" : "border-border/20"} flex items-start justify-end pr-2 pt-1`}>
            {label && <span className="text-[10px] text-text-secondary">{label}</span>}
          </div>
        ))}
      </div>

      {/* Pitch columns */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex" style={{ minWidth: Math.max(pitches.length * 150, 300) }}>
          {pitches.map((pitch, pi) => {
            const color = COLORS[pi % COLORS.length];
            const pitchBookings = bookings.filter((b) => b.pitch_id === pitch.id);
            return (
              <div key={pitch.id} className="flex-1 min-w-[150px] border-r border-border/30">
                {/* Pitch header */}
                <div style={{ height: 40 }}
                  className="border-b border-border bg-[#0e0e0e] sticky top-0 z-20 flex items-center justify-center px-2">
                  <span className="text-xs font-bold truncate" style={{ color: color.bg }}>{pitch.name}</span>
                </div>
                {/* Slots — explicit height so full day renders and parent scrolls */}
                <div className="relative" style={{ height: gridH }}>
                  {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                    <div key={i} style={{ height: SLOT_H }}
                      className={`border-b ${i % 2 === 0 ? "border-border/50" : "border-border/20"} cursor-pointer hover:bg-white/[0.03] transition-colors`}
                      onClick={() => onCellClick(pitch.id, slotToTime(i))}
                    />
                  ))}
                  {pitchBookings.map((b) => (
                    <BookingBlock key={b.id} booking={b} color={color} onClick={() => onBookingClick(b)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Week View ─────────────────────────────────────────────────
function WeekView({ pitches, bookings, weekDates, onCellClick, onBookingClick }: {
  pitches: Pitch[];
  bookings: Booking[];
  weekDates: Date[];
  onCellClick: (pitchId: string, date: Date, slotTime: string) => void;
  onBookingClick: (b: Booking) => void;
}) {
  const today = toInputISO(new Date());
  const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  const gridH = TOTAL_SLOTS * SLOT_H;

  return (
    <div className="flex">
      {/* Time column */}
      <div className="w-12 flex-shrink-0 border-r border-border">
        <div style={{ height: 48 }} className="border-b border-border bg-[#0e0e0e] sticky top-0 z-30" />
        {TIME_LABELS.map((label, i) => (
          <div key={i} style={{ height: SLOT_H }}
            className={`border-b ${i % 2 === 0 ? "border-border/50" : "border-border/20"} flex items-start justify-end pr-1.5 pt-1`}>
            {label && <span className="text-[9px] text-text-secondary">{label}</span>}
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex" style={{ minWidth: 7 * 110 }}>
          {weekDates.map((date, di) => {
            const dateStr = toInputISO(date);
            const isToday = dateStr === today;
            const dayBookings = bookings.filter((b) => b.match_date === dateStr);

            return (
              <div key={dateStr} className="flex-1 min-w-[110px] border-r border-border/30 flex flex-col">
                {/* Day header */}
                <div style={{ height: 48 }}
                  className="border-b border-border bg-[#0e0e0e] sticky top-0 z-20 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-[10px] text-text-secondary font-semibold">{DAY_LABELS[di]}</span>
                  <span className={`text-lg font-bold leading-tight ${isToday ? "text-accent" : ""}`}>{date.getDate()}</span>
                </div>
                {/* Slots */}
                <div className="relative" style={{ height: gridH }}>
                  {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                    <div key={i} style={{ height: SLOT_H }}
                      className={`border-b ${i % 2 === 0 ? "border-border/50" : "border-border/20"} cursor-pointer hover:bg-white/[0.03] transition-colors`}
                      onClick={() => onCellClick(pitches[0]?.id ?? "", date, slotToTime(i))}
                    />
                  ))}
                  {dayBookings.map((b) => {
                    const pi = pitches.findIndex((p) => p.id === b.pitch_id);
                    const color = COLORS[Math.max(0, pi) % COLORS.length];
                    return (
                      <BookingBlock key={b.id} booking={b} color={color} onClick={() => onBookingClick(b)} />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Add Booking Modal ─────────────────────────────────────────
function AddBookingModal({ pitches, defaults, onSave, onClose }: {
  pitches: Pitch[];
  defaults: { pitchId: string; date: string; startTime: string } | null;
  onSave: (b: Booking) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<"manual" | "open_match">("manual");
  const [form, setForm] = useState({
    pitch_id: defaults?.pitchId ?? pitches[0]?.id ?? "",
    date: defaults?.date ?? toInputISO(new Date()),
    start_time: defaults?.startTime ?? "09:00",
    end_time: defaults?.startTime ? addOneHour(defaults.startTime) : "10:00",
    booker_name: "",
    notes: "",
  });
  const [omForm, setOmForm] = useState({
    title: "",
    match_type: "match",
    format: "5-a-side",
    skill_level: "Mixed",
    price_per_team: "",
    max_teams: "2",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setOm = (k: string, v: string) => setOmForm((f) => ({ ...f, [k]: v }));

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
      payment_status: "unpaid",
      booker_name: form.booker_name.trim(),
      notes: form.notes.trim() || null,
    }).select().single();

    setSaving(false);
    if (dbErr) { setError(`Failed to save: ${dbErr.message}`); return; }
    onSave(data as Booking);
  };

  const handleSaveOpenMatch = async () => {
    if (!user) return;
    if (!omForm.title.trim()) { setError("Give the match a title."); return; }
    if (form.start_time >= form.end_time) { setError("End time must be after start time."); return; }
    const maxTeams = Number(omForm.max_teams);
    if (!maxTeams || maxTeams < 2) { setError("Allow at least 2 teams."); return; }
    setSaving(true);
    setError(null);

    const matchDate = toInputISO(fromInputISO(form.date));
    const pitch = pitches.find((p) => p.id === form.pitch_id);
    const pricePence = Math.round(Number(omForm.price_per_team || "0") * 100);

    // 1) Reserve the slot on the calendar
    const { data: booking, error: bookErr } = await supabase.from("pitch_bookings").insert({
      pitch_id: form.pitch_id,
      booked_by: user.id,
      match_date: matchDate,
      start_time: form.start_time,
      end_time: form.end_time,
      booker_name: `Open match: ${omForm.title.trim()}`,
      booking_type: "open_match",
      total_price_pence: pricePence * maxTeams,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: 0,
      status: "confirmed",
      payment_status: "after_match",
    }).select().single();

    if (bookErr) { setSaving(false); setError(`Couldn't reserve the slot: ${bookErr.message}`); return; }

    // 2) Create the open match listing
    const { error: omErr } = await supabase.from("open_matches").insert({
      pitch_id: form.pitch_id,
      venue_owner_id: user.id,
      pitch_name: pitch?.name ?? "",
      venue_address: null,
      match_date: matchDate,
      start_time: form.start_time,
      end_time: form.end_time,
      title: omForm.title.trim(),
      match_type: omForm.match_type,
      format: omForm.format,
      skill_level: omForm.skill_level,
      price_per_team_pence: pricePence,
      max_teams: maxTeams,
      description: omForm.description.trim() || null,
      status: "open",
      booking_id: booking.id,
    });

    if (omErr) {
      await supabase.from("pitch_bookings").delete().eq("id", booking.id);
      setSaving(false);
      setError(
        omErr.code === "42P01"
          ? "The open_matches table doesn't exist yet — run supabase_open_matches.sql in Supabase first."
          : `Couldn't create the match: ${omErr.message}`
      );
      return;
    }

    setSaving(false);
    onSave(booking as Booking);
  };

  const handleSave = () => mode === "manual" ? handleSaveManual() : handleSaveOpenMatch();

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="px-5 pt-2 pb-8 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="font-bold">{mode === "manual" ? "Add Booking" : "Create Open Match"}</p>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Mode toggle */}
          <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-0.5">
            {([{ k: "manual", l: "Manual Booking" }, { k: "open_match", l: "Open Match" }] as const).map((m) => (
              <button key={m.k} onClick={() => { setMode(m.k); setError(null); }}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${mode === m.k ? "bg-accent text-black" : "text-text-secondary"}`}>
                {m.l}
              </button>
            ))}
          </div>
          {mode === "open_match" && (
            <p className="text-xs text-text-secondary -mt-1">Block this slot and let teams buy in — it appears in the players&apos; Play feed.</p>
          )}

          {pitches.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Pitch</label>
              <select value={form.pitch_id} onChange={(e) => set("pitch_id", e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {mode === "manual" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Booker / Team Name</label>
              <input value={form.booker_name} onChange={(e) => set("booker_name", e.target.value)}
                placeholder="e.g. Hackney United" autoFocus
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
          ) : (
            <>
              <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-0.5">
                {(["match", "tournament"] as const).map((t) => (
                  <button key={t} onClick={() => setOm("match_type", t)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${omForm.match_type === t ? "bg-accent text-black" : "text-text-secondary"}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Title</label>
                <input value={omForm.title} onChange={(e) => setOm("title", e.target.value)}
                  placeholder="e.g. Friday Night Friendly" autoFocus
                  className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">Format</label>
                  <select value={omForm.format} onChange={(e) => setOm("format", e.target.value)}
                    className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                    {["5-a-side", "7-a-side", "11-a-side"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">Level</label>
                  <select value={omForm.skill_level} onChange={(e) => setOm("skill_level", e.target.value)}
                    className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                    {["Mixed", "Casual", "Competitive"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Date</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)}
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 [color-scheme:dark]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Start time</label>
              <input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 [color-scheme:dark]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">End time</label>
              <input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 [color-scheme:dark]" />
            </div>
          </div>

          {mode === "manual" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Notes <span className="text-text-secondary font-normal">(optional)</span></label>
              <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. Maintenance, private hire, league game…"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">Price per team (£)</label>
                  <input type="number" inputMode="decimal" value={omForm.price_per_team} onChange={(e) => setOm("price_per_team", e.target.value)}
                    placeholder="e.g. 40"
                    className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">Teams that can join</label>
                  <input type="number" inputMode="numeric" min={2} value={omForm.max_teams} onChange={(e) => setOm("max_teams", e.target.value)}
                    className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Description <span className="text-text-secondary font-normal">(optional)</span></label>
                <input value={omForm.description} onChange={(e) => setOm("description", e.target.value)}
                  placeholder="Anything teams should know…"
                  className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
              </div>
              {omForm.price_per_team && omForm.max_teams && (
                <div className="bg-accent/5 border border-accent/20 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-text-secondary">Potential revenue if full</p>
                  <p className="text-sm font-bold text-accent">£{(Number(omForm.price_per_team || 0) * Number(omForm.max_teams || 0)).toFixed(2)}</p>
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40">
            {saving ? "Saving…" : mode === "manual" ? "Add to Calendar" : "Post Open Match"}
          </button>
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

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  };

  const paymentStatus = booking.payment_status ?? "unpaid";

  const price = (() => {
    if (booking.total_price_pence && booking.total_price_pence > 0) return booking.total_price_pence / 100;
    if (booking.per_player_pence && booking.player_count) return (booking.per_player_pence * booking.player_count) / 100;
    return 0;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-border" /></div>

        {/* Scrollable content */}
        <div className="flex-1 px-5 pb-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold">{booking.booker_name ?? "Unitr Booking"}</p>
              <p className="text-xs text-text-secondary mt-0.5">
                {booking.booking_type === "platform" ? "Booked via Unitr" : "External / manual entry"}
              </p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div className="bg-surface-2 border border-border rounded-xl p-4 space-y-2.5 text-sm">
            {[
              { label: "Pitch", value: pitch?.name ?? "—" },
              { label: "Date", value: booking.match_date },
              { label: "Time", value: `${booking.start_time} – ${endTime}` },
              ...(booking.notes ? [{ label: "Notes", value: booking.notes }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-text-secondary flex-shrink-0">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            ))}
          </div>

          {/* Payment status */}
          <div className="bg-surface-2 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Payment</p>
              {price > 0 && (
                <span className="text-sm font-bold text-accent">£{price.toFixed(2)}</span>
              )}
            </div>
            <div className="flex gap-2">
              {(["unpaid", "after_match", "paid"] as const).map((s) => {
                const labels = { unpaid: "Unpaid", after_match: "After Match", paid: "Paid" };
                const active = paymentStatus === s;
                return (
                  <button key={s} onClick={() => onPaymentUpdate(booking.id, s)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${
                      active
                        ? s === "paid" ? "bg-accent text-black border-accent"
                          : s === "after_match" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                          : "bg-red-500/20 text-red-400 border-red-500/40"
                        : "bg-surface border-border text-text-secondary"
                    }`}>
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 pb-2">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">
              Close
            </button>
            <button onClick={handleCancel} disabled={cancelling}
              className="flex-1 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm font-semibold disabled:opacity-40">
              {cancelling ? "Cancelling…" : "Cancel Booking"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function VenueCalendarPage() {
  const { user } = useAuth();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<"day" | "week">("day");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addDefaults, setAddDefaults] = useState<{ pitchId: string; date: string; startTime: string } | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: ps } = await supabase.from("pitches")
        .select("id, name, price_per_hour")
        .eq("venue_owner_id", user!.id)
        .order("name");
      setPitches(ps ?? []);
      if (!ps || ps.length === 0) { setLoading(false); return; }

      // Fetch all non-cancelled bookings for this venue's pitches
      const { data: bks } = await supabase.from("pitch_bookings")
        .select("id, pitch_id, match_date, start_time, end_time, booker_name, status, booking_type, notes, booked_by, payment_status, total_price_pence, per_player_pence, player_count")
        .in("pitch_id", ps.map((p) => p.id))
        .neq("status", "cancelled");

      // Enrich platform bookings with profile names
      const enriched = await Promise.all((bks ?? []).map(async (b) => {
        if (b.booker_name) return b;
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", b.booked_by).maybeSingle();
        return { ...b, booker_name: prof?.full_name ?? "Unitr Booking" };
      }));

      setBookings((enriched as Booking[]).map(b => ({ ...b, match_date: normalizeMatchDate(b.match_date) })));
      setLoading(false);
    }
    load();
  }, [user]);

  const navigate = (dir: -1 | 1) => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + (view === "week" ? dir * 7 : dir));
      return nd;
    });
  };

  const handleCellClick = (pitchId: string, date: Date | null, startTime: string) => {
    setAddDefaults({
      pitchId,
      date: toInputISO(date ?? selectedDate),
      startTime,
    });
    setShowAdd(true);
  };

  const handleCancelBooking = async () => {
    if (!selectedBooking) return;
    await supabase.from("pitch_bookings").update({ status: "cancelled" }).eq("id", selectedBooking.id);
    setBookings((prev) => prev.filter((b) => b.id !== selectedBooking.id));
    setSelectedBooking(null);
  };

  const handlePaymentUpdate = async (id: string, status: string) => {
    await supabase.from("pitch_bookings").update({ payment_status: status }).eq("id", id);
    setBookings((prev) => prev.map((b) => b.id === id ? { ...b, payment_status: status } : b));
    setSelectedBooking((b) => b && b.id === id ? { ...b, payment_status: status } : b);
  };

  // Filter bookings for current view — case-insensitive to handle "JUN" vs "Jun"
  const weekDates = getWeekDates(selectedDate);
  const visibleDates = view === "day"
    ? new Set([toInputISO(selectedDate)])
    : new Set(weekDates.map((d) => toInputISO(d)));
  const visibleBookings = bookings.filter((b) => visibleDates.has(b.match_date));

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );

  if (pitches.length === 0) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">No pitches registered</p>
      <a href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register a Pitch</a>
    </div>
  );

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 6rem)" }}>
      {/* Toolbar */}
      <div className="px-4 pt-3 pb-3 border-b border-border flex-shrink-0 space-y-2.5">
        {/* Date navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <p className="flex-1 text-center text-sm font-semibold truncate">{formatHeaderDate(selectedDate, view)}</p>
          <button onClick={() => navigate(1)}
            className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>

        {/* View toggle + actions */}
        <div className="flex items-center gap-2">
          <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-0.5">
            {(["day", "week"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${view === v ? "bg-accent text-black" : "text-text-secondary"}`}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => setSelectedDate(new Date())}
            className="px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-text-secondary">
            Today
          </button>
          <button
            onClick={() => { setAddDefaults(null); setShowAdd(true); }}
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent text-black text-xs font-bold">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add
          </button>
        </div>

        {/* Pitch legend (day view, multiple pitches) */}
        {view === "week" && pitches.length > 1 && (
          <div className="flex gap-3 flex-wrap">
            {pitches.map((p, i) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length].bg }} />
                <span className="text-xs text-text-secondary">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {view === "day" ? (
          <DayView
            pitches={pitches}
            bookings={visibleBookings}
            onCellClick={(pitchId, startTime) => handleCellClick(pitchId, selectedDate, startTime)}
            onBookingClick={setSelectedBooking}
          />
        ) : (
          <WeekView
            pitches={pitches}
            bookings={visibleBookings}
            weekDates={weekDates}
            onCellClick={(pitchId, date, startTime) => handleCellClick(pitchId, date, startTime)}
            onBookingClick={setSelectedBooking}
          />
        )}
      </div>

      {showAdd && (
        <AddBookingModal
          pitches={pitches}
          defaults={addDefaults}
          onSave={(b) => { setBookings((prev) => [...prev, b]); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
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
