"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { pitchFormatFor } from "@/lib/formations";
import { loadLedTeam } from "@/lib/team-leadership";
import "leaflet/dist/leaflet.css";

// Leaflet must be client-only — no SSR
const PitchMap = dynamic(() => import("@/components/PitchMap"), { ssr: false, loading: () => (
  <div className="mx-4 rounded-2xl bg-surface-2 border border-border flex items-center justify-center" style={{ height: 900 }}>
    <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
  </div>
) });

type Pitch = {
  id: string;
  name: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  price_per_hour: number;
  formats: string[];
  surfaces: string[];
  amenities: string[];
  rating: number;
  is_verified: boolean;
};

type PostingSlot = { matchDate: string; time: string; dayName: string };
type SlotStatus = "available" | "booked" | "closed";

const DAY_MAP: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

const rankLabels = ["1st choice", "2nd choice", "3rd choice"];
const FALLBACK_SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

const NORM_MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function normalizeSlotDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    if (NORM_MONTHS[monthKey] !== undefined) {
      const d = new Date(Number(m[3]), NORM_MONTHS[monthKey], Number(m[1]));
      return localISO(d);
    }
  }
  return raw;
}
function fmtSlotDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`;
}

function generateSlots(openTime: string, closeTime: string): string[] {
  const slots: string[] = [];
  const [oh, om] = openTime.split(":").map(Number);
  const [ch] = closeTime.split(":").map(Number);
  let h = oh + (om > 0 ? 1 : 0);
  while (h < ch) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    h++;
  }
  return slots;
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-bold text-yellow-600">{Number(rating).toFixed(1)}</span>
      {[1,2,3,4,5].map((i) => (
        <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill={i <= Math.round(rating) ? "#FACC15" : "none"} stroke="#FACC15" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

// ── Booking Panel ─────────────────────────────────────────────
function BookingPanel({ pitch, onClose, onBook }: { pitch: Pitch; onClose: () => void; onBook: (date: string, time: string) => void }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>(FALLBACK_SLOTS);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const perPlayer = (pitch.price_per_hour * 1.05 / 22).toFixed(2);

  // Generate next 14 days
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return {
      key: localISO(d),
      day: d.toLocaleDateString("en-GB", { weekday: "short" }),
      date: d.getDate(),
      month: d.toLocaleDateString("en-GB", { month: "short" }),
    };
  });

  // Fetch real availability when a date is selected
  useEffect(() => {
    if (!selectedDate) return;
    setLoadingSlots(true);
    setSelectedTime(null);
    const dayOfWeek = new Date(selectedDate).getDay(); // 0=Sun, 1=Mon ...

    Promise.all([
      supabase.from("pitch_availability")
        .select("open_time, close_time, is_active")
        .eq("pitch_id", pitch.id)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle(),
      supabase.from("pitch_bookings")
        .select("start_time")
        .eq("pitch_id", pitch.id)
        .eq("match_date", selectedDate)
        .neq("status", "cancelled"),
      supabase.from("pitch_blocks")
        .select("start_time, end_time")
        .eq("pitch_id", pitch.id)
        .eq("block_date", selectedDate),
    ]).then(([{ data: avail }, { data: booked }, { data: blocks }]) => {
      if (!avail || !avail.is_active) {
        setAvailableSlots([]);
        setLoadingSlots(false);
        return;
      }
      const allSlots = generateSlots(avail.open_time, avail.close_time);
      const bookedTimes = new Set((booked ?? []).map((b) => b.start_time));
      const blockedTimes = new Set<string>();
      for (const blk of blocks ?? []) {
        if (!blk.start_time) { setAvailableSlots([]); setLoadingSlots(false); return; }
        allSlots.forEach((s) => { if (s >= blk.start_time! && s < blk.end_time!) blockedTimes.add(s); });
      }
      const free = allSlots.filter((s) => !bookedTimes.has(s) && !blockedTimes.has(s));
      setAvailableSlots(free.length > 0 ? free : []);
      setLoadingSlots(false);
    });
  }, [selectedDate, pitch.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-t-2xl overflow-y-auto max-h-[85dvh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="px-5 pb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="font-bold">{pitch.name}</p>
              <p className="text-xs text-text-secondary">{pitch.address}</p>
            </div>
            <div className="text-right ml-3 flex-shrink-0">
              <p className="text-lg font-bold text-accent-ink">£{(pitch.price_per_hour * 1.05 / 2).toFixed(2)}/hr</p>
              <button onClick={onClose} className="text-xs text-text-secondary mt-1">✕ close</button>
            </div>
          </div>

          <p className="text-sm font-semibold mb-3">Select Date</p>
          <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
            {days.map((d) => (
              <button key={d.key} onClick={() => setSelectedDate(d.key)}
                className={`flex-shrink-0 w-16 h-20 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${selectedDate === d.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}>
                <span className={`text-xs font-medium ${selectedDate === d.key ? "text-accent-ink" : "text-text-secondary"}`}>{d.day}</span>
                <span className={`text-2xl font-extrabold leading-none ${selectedDate === d.key ? "text-accent-ink" : "text-text-primary"}`}>{d.date}</span>
                <span className={`text-xs font-medium ${selectedDate === d.key ? "text-accent-ink" : "text-text-secondary"}`}>{d.month}</span>
              </button>
            ))}
          </div>

          <p className="text-sm font-semibold mb-3">Select Time</p>
          {loadingSlots ? (
            <div className="flex items-center justify-center h-16 mb-5">
              <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : availableSlots.length === 0 ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-5 text-center">
              <p className="text-xs text-red-600">No available slots on this date</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 mb-5">
              {availableSlots.map((t) => (
                <button key={t} onClick={() => setSelectedTime(t)}
                  className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${selectedTime === t ? "border-accent bg-accent/10 text-accent-ink" : "border-border text-text-secondary"}`}>
                  {t}
                </button>
              ))}
            </div>
          )}

          <div className="bg-surface border border-border rounded-btn p-3 mb-5">
            <p className="text-xs font-semibold mb-1">Payment breakdown</p>
            <div className="space-y-1 text-xs text-text-secondary">
              <div className="flex justify-between"><span>Pitch hire (1hr)</span><span className="font-semibold text-text-primary">£{pitch.price_per_hour}</span></div>
              <div className="flex justify-between"><span>Split across 22 players (both teams)</span><span className="font-semibold text-text-primary">£{perPlayer}/player</span></div>
              <div className="flex justify-between"><span>Unitr fee (5%)</span><span className="font-semibold text-text-primary">£{(Number(perPlayer) * 0.05).toFixed(2)}/player</span></div>
              <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="font-semibold text-text-primary">Total per player</span><span className="font-bold text-accent-ink">£{(Number(perPlayer) * 1.05).toFixed(2)}</span></div>
            </div>
          </div>

          <button
            disabled={!selectedDate || !selectedTime}
            onClick={() => selectedDate && selectedTime && onBook(selectedDate, selectedTime)}
            className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm Booking
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Booking Confirmed ─────────────────────────────────────────
function BookingConfirmed({ pitch, date, time, onDone }: { pitch: Pitch; date: string; time: string; onDone: () => void }) {
  const perPlayer = (pitch.price_per_hour / 22 * 1.05).toFixed(2);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim px-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="text-lg font-bold mb-1">Pitch Booked!</p>
        <p className="text-sm font-semibold mb-0.5">{pitch.name}</p>
        <p className="text-xs text-text-secondary mb-1">{pitch.address}</p>
        <p className="text-xs text-accent-ink font-medium mb-4">{date} · {time}</p>
        <div className="bg-surface border border-border rounded-btn p-3 mb-5 text-left space-y-1">
          <div className="flex justify-between text-xs"><span className="text-text-secondary">Per player (inc. 5% fee)</span><span className="font-bold text-accent-ink">£{perPlayer}</span></div>
          <p className="text-[10px] text-text-secondary">Charged automatically 3 hours after match confirmation via Stripe.</p>
        </div>
        <button onClick={onDone} className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">Done</button>
      </div>
    </div>
  );
}

// ── Pitch Availability Panel (Select Mode) ────────────────────
function PitchAvailabilityPanel({
  pitch, postingSlots, pitchSlotStatuses, isPicked, pickIndex,
  slotOverrides, onClose, onToggle, onReplaceSlot, canAdd,
}: {
  pitch: Pitch;
  postingSlots: PostingSlot[];
  pitchSlotStatuses: SlotStatus[];
  isPicked: boolean;
  pickIndex: number;
  slotOverrides: Record<string, string>;
  onClose: () => void;
  onToggle: () => void;
  onReplaceSlot: (date: string, newTime: string) => void;
  canAdd: boolean;
}) {
  const firstPostingDate = normalizeSlotDate(postingSlots[0]?.matchDate ?? localISO(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(firstPostingDate);
  const [daySlots, setDaySlots] = useState<{ time: string; status: SlotStatus }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const ALL_HOURS = Array.from({ length: 16 }, (_, i) => `${String(i + 7).padStart(2, "0")}:00`);

  const days = (() => {
    const todayISO = localISO(new Date());
    // Start from whichever is earlier: today or the earliest posting slot.
    const slotDates = postingSlots.map(s => s.matchDate).filter(Boolean).sort();
    const startISO = slotDates.length > 0 && slotDates[0] < todayISO ? slotDates[0] : todayISO;
    const latestSlot = slotDates[slotDates.length - 1] ?? todayISO;
    // Show at least 21 days from start, or up to 7 days past the latest posting slot.
    const startDate = new Date(startISO + "T12:00:00");
    const endDate = new Date(latestSlot + "T12:00:00");
    endDate.setDate(endDate.getDate() + 7);
    const totalDays = Math.max(21, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(startISO + "T12:00:00");
      d.setDate(d.getDate() + i);
      const key = localISO(d);
      return {
        key,
        day: d.toLocaleDateString("en-GB", { weekday: "short" }),
        date: d.getDate(),
        month: d.toLocaleDateString("en-GB", { month: "short" }),
        isPostingDate: postingSlots.some(s => s.matchDate === key),
      };
    });
  })();

  useEffect(() => {
    if (!selectedDate) return;
    setLoadingSlots(true);
    const postingSlot = postingSlots.find(s => normalizeSlotDate(s.matchDate) === selectedDate);
    setSelectedTime(postingSlot?.time ?? null);
    const dayOfWeek = new Date(selectedDate + "T12:00:00").getDay();

    Promise.all([
      supabase.from("pitch_availability")
        .select("open_time, close_time, is_active")
        .eq("pitch_id", pitch.id)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle(),
      supabase.from("pitch_bookings")
        .select("start_time, end_time")
        .eq("pitch_id", pitch.id)
        .eq("match_date", selectedDate)
        .neq("status", "cancelled"),
      supabase.from("pitch_blocks")
        .select("start_time, end_time")
        .eq("pitch_id", pitch.id)
        .eq("block_date", selectedDate),
    ]).then(([{ data: avail }, { data: booked }, { data: blocks }]) => {
      const taken = new Set<string>();
      for (const b of [...(booked ?? []), ...(blocks ?? [])]) {
        const [sh] = b.start_time.split(":").map(Number);
        const eh = b.end_time ? b.end_time.split(":").map(Number)[0] : sh + 1;
        for (let h = sh; h < eh; h++) taken.add(`${String(h).padStart(2, "0")}:00`);
      }
      if (avail && !avail.is_active) {
        setDaySlots(ALL_HOURS.map(t => ({ time: t, status: "closed" })));
      } else {
        const oh = avail ? Number(avail.open_time.split(":")[0]) : 7;
        const ch = avail ? Number(avail.close_time.split(":")[0]) : 22;
        setDaySlots(ALL_HOURS.map(t => {
          const h = Number(t.split(":")[0]);
          if (h < oh || h >= ch) return { time: t, status: "closed" };
          if (taken.has(t)) return { time: t, status: "booked" };
          return { time: t, status: "available" };
        }));
      }
      setLoadingSlots(false);
    });
  }, [selectedDate, pitch.id, postingSlots]);

  const postingSlotForDate = postingSlots.find(s => normalizeSlotDate(s.matchDate) === selectedDate);
  const postingTime = postingSlotForDate?.time;
  const allPostingSlotsUnavailable = pitchSlotStatuses.length > 0 && pitchSlotStatuses.every(s => s !== "available");
  // How many of the captain's posting dates already have a chosen slot for THIS pitch.
  const confirmedCount = postingSlots.filter(s => slotOverrides[normalizeSlotDate(s.matchDate)] !== undefined).length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim px-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-2xl flex flex-col max-h-[85dvh]" onClick={e => e.stopPropagation()}>
        <div className="overflow-y-auto flex-1 px-5 pt-5 pb-3">

          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="font-bold">{pitch.name}</p>
              <p className="text-xs text-text-secondary">{pitch.address}</p>
            </div>
            <div className="text-right ml-3 flex-shrink-0">
              <p className="text-base font-bold text-accent-ink">£{(pitch.price_per_hour * 1.05 / 2).toFixed(2)}/hr</p>
              <button onClick={onClose} className="text-xs text-text-secondary mt-0.5">✕ close</button>
            </div>
          </div>

          {/* Posting slot status chips */}
          {postingSlots.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Your Posting Times</p>
              <div className="flex flex-wrap gap-1.5">
                {postingSlots.map((slot, i) => {
                  const isoDate = normalizeSlotDate(slot.matchDate);
                  const dayLabel = new Date(isoDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" });
                  const st = pitchSlotStatuses[i];
                  const confirmed = slotOverrides[isoDate] !== undefined;
                  const confirmedTime = slotOverrides[isoDate];
                  return (
                    <button key={i}
                      onClick={() => setSelectedDate(isoDate)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                        selectedDate === isoDate ? "ring-1 ring-white/20" : ""
                      } ${
                        confirmed ? "bg-accent/20 text-accent-ink border-accent" :
                        st === "available" ? "bg-accent/10 text-accent-ink border-accent/20" :
                        st === "booked" ? "bg-red-500/10 text-red-600 border-red-500/20" :
                        "bg-surface text-text-secondary border-border"
                      }`}>
                      {confirmed && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      {!confirmed && st === "available" && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      {!confirmed && (st === "booked" || st === "closed") && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>}
                      {dayLabel} {fmtSlotDate(isoDate)} · {confirmed ? confirmedTime : slot.time}
                      {confirmed ? " · ✓" : st === "booked" ? " · Taken" : st === "closed" ? " · Unavailable" : ""}
                    </button>
                  );
                })}
              </div>
              {allPostingSlotsUnavailable && (
                <p className="text-[11px] text-yellow-600 mt-1.5 font-medium">None of your posting times are free — browse below for an alternative slot.</p>
              )}
            </div>
          )}

          {/* Date picker */}
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Browse Availability</p>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {days.map(d => (
              <button key={d.key} onClick={() => setSelectedDate(d.key)}
                className={`flex-shrink-0 w-14 rounded-xl border flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                  selectedDate === d.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"
                }`}>
                <span className={`text-[10px] font-medium ${selectedDate === d.key ? "text-accent-ink" : "text-text-secondary"}`}>{d.day}</span>
                <span className={`text-xl font-extrabold leading-none ${selectedDate === d.key ? "text-accent-ink" : "text-text-primary"}`}>{d.date}</span>
                <span className={`text-[10px] ${selectedDate === d.key ? "text-accent-ink" : "text-text-secondary"}`}>{d.month}</span>
                {d.isPostingDate && (
                  <div className={`w-1.5 h-1.5 rounded-full ${selectedDate === d.key ? "bg-accent" : "bg-accent/50"}`} />
                )}
              </button>
            ))}
          </div>

          {/* Time grid */}
          {loadingSlots ? (
            <div className="flex items-center justify-center h-20 mb-4">
              <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                {daySlots.map(({ time, status }) => {
                  const isPosting = time === postingTime;
                  const isSelected = time === selectedTime;
                  return (
                    <button key={time}
                      disabled={status !== "available"}
                      onClick={() => setSelectedTime(isSelected ? null : time)}
                      className={`py-2.5 rounded-lg text-[13px] font-medium transition-colors relative ${
                        isSelected
                          ? "bg-accent text-white"
                          : status === "available"
                            ? isPosting
                              ? "border border-accent/70 bg-accent/5 text-accent-ink"
                              : "border border-white/20 text-text-primary"
                            : "line-through text-text-secondary/30 cursor-not-allowed"
                      }`}>
                      {time}
                      {isPosting && !isSelected && status === "available" && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent border border-[#FFFFFF]" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mb-4 text-[10px] text-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-accent/10 border border-accent/60 inline-block" />
                  Your time
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded border border-white/20 inline-block" />
                  Available
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-surface-2 inline-block opacity-40" />
                  Taken / Closed
                </span>
              </div>
            </>
          )}

          {/* Changed-time note */}
          {selectedTime && selectedTime !== postingTime && postingSlotForDate && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 mb-3">
              <p className="text-xs text-yellow-600 font-semibold mb-0.5">Different time for this pitch?</p>
              <p className="text-[11px] text-text-secondary">
                Booking at <span className="line-through text-red-600 font-medium">{postingSlotForDate.time}</span>{" → "}
                <span className="text-accent-ink font-semibold">{selectedTime}</span> on {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}.
              </p>
            </div>
          )}

          {/* No posting slot for this date — info */}
          {selectedTime && !postingSlotForDate && (
            <div className="bg-surface border border-border rounded-btn px-4 py-3 mb-3">
              <p className="text-[11px] text-text-secondary">
                <span className="text-text-primary font-medium">{selectedTime}</span> isn&apos;t one of your posting dates — update your schedule to include it.
              </p>
            </div>
          )}

        </div>

        {/* Sticky footer — compact, always visible regardless of scroll */}
        <div className="px-5 pb-4 pt-3 border-t border-border flex-shrink-0">

          {/* Progress hint — how many of your dates have a slot set for this pitch */}
          {postingSlots.length > 1 && (
            <p className="text-[11px] text-text-secondary text-center mb-2">
              {confirmedCount} of {postingSlots.length} date{postingSlots.length > 1 ? "s" : ""} set for this pitch
              {confirmedCount < postingSlots.length && confirmedCount > 0 ? " — pick a slot for the rest" : ""}
            </p>
          )}

          {/* Primary: confirm this date's slot, then auto-advance to next unconfirmed date */}
          {selectedTime && postingSlotForDate && (
            <button
              onClick={() => {
                onReplaceSlot(selectedDate, selectedTime!);
                onClose();
              }}
              className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm mb-2">
              {slotOverrides[selectedDate] !== undefined
                ? `Update ${new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" })} to ${selectedTime} ✓`
                : `Confirm ${new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" })} at ${selectedTime}`}
            </button>
          )}

          <div className="flex gap-2">
            {/* Done — close panel once pitch is added */}
            {isPicked && (
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-btn bg-accent/20 text-accent-ink border border-accent font-bold text-sm">
                ✓ {rankLabels[pickIndex]} · Done
              </button>
            )}

            {/* Remove button — only shown once a pitch is picked */}
            {isPicked && (
              <button
                onClick={onToggle}
                className="flex-1 py-3 rounded-xl font-bold text-sm transition-colors bg-red-500/10 text-red-600 border border-red-500/20">
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Content ──────────────────────────────────────────────
function PitchesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const selectMode = searchParams.get("mode") === "select";

  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedPitch, setSelectedPitch] = useState<Pitch | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [bookedInfo, setBookedInfo] = useState<{ date: string; time: string } | null>(null);
  const [filterFormat, setFilterFormat] = useState("All");
  const [pickedPitches, setPickedPitches] = useState<Pitch[]>([]);
  const [teamCredits, setTeamCredits] = useState<number | null>(null);
  const [paymentMode, setPaymentMode] = useState<string | null>(null);
  const [postingSlots, setPostingSlots] = useState<PostingSlot[]>([]);
  // Per-pitch time overrides: pitchId → { matchDate(ISO) → chosen time }.
  // Lets a captain pick a different time for one pitch without affecting the others.
  const [pitchOverrides, setPitchOverrides] = useState<Record<string, Record<string, string>>>({});
  const [pitchSlotMap, setPitchSlotMap] = useState<Record<string, SlotStatus[]>>({});
  const [checkingSlots, setCheckingSlots] = useState(false);
  const [detailPitch, setDetailPitch] = useState<Pitch | null>(null);
  const [squadCount, setSquadCount] = useState<number | null>(null);

  // Fetch pitches from DB — only real registered pitches (exclude seeded dummy data)
  useEffect(() => {
    supabase.from("pitches").select("*")
      .not("venue_owner_id", "is", null)
      .order("rating", { ascending: false })
      .then(({ data }) => { setPitches((data ?? []) as Pitch[]); setLoading(false); });
  }, []);

  // Read payment mode + fetch team credits in select mode
  useEffect(() => {
    if (!selectMode) return;
    const mode = localStorage.getItem("unitr_payment_mode");
    setPaymentMode(mode);
    if (mode === "individual") {
      const sc = localStorage.getItem("unitr_squad_count");
      if (sc) setSquadCount(parseInt(sc));
    }
    if (mode !== "credit" || !user) return;
    async function loadCredits() {
      const team = await loadLedTeam<{ id: string }>(user!.id, "id");
      if (!team?.id) return;
      const { data } = await supabase.from("team_credits").select("balance_pence, reserved_pence").eq("team_id", team.id).maybeSingle();
      setTeamCredits(((data?.balance_pence ?? 0) - (data?.reserved_pence ?? 0)) / 100);
    }
    loadCredits();
  }, [selectMode, user]);

  // Load captain's posting slots (for availability display in select mode)
  useEffect(() => {
    if (!selectMode) return;
    const saved = localStorage.getItem("unitr_posting_slots");
    if (saved) {
      const parsed: PostingSlot[] = JSON.parse(saved);
      setPostingSlots(parsed.map(s => ({ ...s, matchDate: normalizeSlotDate(s.matchDate) })));
    }
    const savedOv = localStorage.getItem("unitr_pitch_overrides");
    if (savedOv) setPitchOverrides(JSON.parse(savedOv));
  }, [selectMode]);

  // Check pitch availability against the captain's posting slots
  useEffect(() => {
    if (!selectMode || pitches.length === 0 || postingSlots.length === 0) return;
    setCheckingSlots(true);

    const pitchIds = pitches.map((p) => p.id);
    const daysNeeded = Array.from(new Set(postingSlots.map((s) => DAY_MAP[s.dayName]).filter((d) => d !== undefined)));
    const matchDates = Array.from(new Set(postingSlots.map((s) => s.matchDate)));

    Promise.all([
      supabase.from("pitch_availability")
        .select("pitch_id, day_of_week, open_time, close_time, is_active")
        .in("pitch_id", pitchIds)
        .in("day_of_week", daysNeeded),
      supabase.from("pitch_bookings")
        .select("pitch_id, match_date, start_time, end_time")
        .in("pitch_id", pitchIds)
        .in("match_date", matchDates)
        .neq("status", "cancelled"),
    ]).then(([{ data: avails }, { data: bookings }]) => {
      const map: Record<string, SlotStatus[]> = {};
      for (const pitch of pitches) {
        map[pitch.id] = postingSlots.map((slot) => {
          // Use this pitch's overridden time for the date, if the captain set one.
          const time = pitchOverrides[pitch.id]?.[slot.matchDate] ?? slot.time;
          const dow = DAY_MAP[slot.dayName];
          const avail = avails?.find((a) => a.pitch_id === pitch.id && a.day_of_week === dow);
          if (avail && !avail.is_active) return "closed";
          if (avail && (time < avail.open_time || time >= avail.close_time)) return "closed";
          const isBooked = bookings?.some(
            (b) =>
              b.pitch_id === pitch.id &&
              b.match_date === slot.matchDate &&
              (b.end_time
                ? b.start_time <= time && time < b.end_time
                : b.start_time === time)
          );
          return isBooked ? "booked" : "available";
        });
      }
      setPitchSlotMap(map);
      setCheckingSlots(false);
    });
  }, [selectMode, pitches, postingSlots, pitchOverrides]);

  // Restore existing pitch selections
  useEffect(() => {
    if (!selectMode || pitches.length === 0) return;
    const saved = localStorage.getItem("unitr_pitch_options");
    if (saved) {
      const savedIds = (JSON.parse(saved) as { id: string }[]).map((s) => s.id);
      const full = savedIds.map((id) => pitches.find((p) => p.id === id)).filter(Boolean) as Pitch[];
      setPickedPitches(full);
    }
  }, [selectMode, pitches]);

  const formats = ["All", "5-a-side", "7-a-side", "8-a-side", "11-a-side"];
  const filteredPitches = filterFormat === "All" ? pitches : pitches.filter((p) => p.formats.includes(filterFormat));

  const isAffordable = (pitch: Pitch) =>
    paymentMode !== "credit" || teamCredits === null || pitch.price_per_hour <= teamCredits;

  const minPlayersForFormats = (formats: string[]) => {
    const nums = formats.flatMap((f) => { const m = f.match(/(\d+)/); return m ? [parseInt(m[1])] : []; });
    return nums.length > 0 ? Math.min(...nums) : 5;
  };

  // TODO: re-enable min-player check before launch
  // const isEnoughPlayers = (pitch: Pitch) =>
  //   paymentMode !== "individual" || squadCount === null || squadCount >= minPlayersForFormats(pitch.formats);
  const isEnoughPlayers = (_pitch: Pitch) => true;

  const isAllSlotsTaken = (pitch: Pitch) => {
    const statuses = pitchSlotMap[pitch.id];
    return !checkingSlots && statuses !== undefined && statuses.length > 0 && statuses.every((s) => s !== "available");
  };

  // The captain's posting slots with this pitch's time overrides applied.
  const effectiveSlots = (pitchId: string): PostingSlot[] =>
    postingSlots.map((s) => ({ ...s, time: pitchOverrides[pitchId]?.[s.matchDate] ?? s.time }));

  // Stable reference for the currently-open panel so its DB effect doesn't re-fire each render.
  const detailSlots = useMemo(
    () => (detailPitch ? effectiveSlots(detailPitch.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailPitch, postingSlots, pitchOverrides]
  );

  const togglePitch = (pitch: Pitch) => {
    if (!isAffordable(pitch) || !isEnoughPlayers(pitch) || isAllSlotsTaken(pitch)) return;
    setPickedPitches((prev) => {
      if (prev.find((p) => p.id === pitch.id)) return prev.filter((p) => p.id !== pitch.id);
      if (prev.length >= 3) return prev;
      return [...prev, pitch];
    });
  };

  const handleMapSelect = (pitch: Pitch) => {
    if (selectMode) {
      setDetailPitch(pitch);
    } else {
      setSelectedPitch(pitch);
      setShowBooking(true);
    }
  };

  const confirmSelection = () => {
    const options = pickedPitches.map((p) => ({
      id: p.id, name: p.name, address: p.address,
      // The filter chip is the captain saying which game this is — take it when
      // the pitch actually offers it, rather than guessing at its first format.
      price: p.price_per_hour, format: pitchFormatFor(p.formats, filterFormat === "All" ? null : filterFormat), distance: "",
      // Per-date times for this pitch (overrides baked in) so each post books the right slot.
      slotTimes: Object.fromEntries(effectiveSlots(p.id).map((s) => [s.matchDate, s.time])),
    }));
    localStorage.setItem("unitr_pitch_options", JSON.stringify(options));
    router.push("/play/create");
  };

  const handleBook = (date: string, time: string) => {
    setShowBooking(false);
    setBookedInfo({ date, time });
  };

  // Set an alternative time for ONE pitch on a given date. Panel stays open
  // so the captain can confirm additional dates for the same pitch.
  const replaceSlot = (pitchId: string, date: string, newTime: string) => {
    setPitchOverrides((prev) => {
      const next = { ...prev, [pitchId]: { ...(prev[pitchId] ?? {}), [date]: newTime } };
      localStorage.setItem("unitr_pitch_overrides", JSON.stringify(next));
      return next;
    });
    setPickedPitches((prev) => {
      if (prev.find((p) => p.id === pitchId)) return prev;
      if (prev.length >= 3) return prev;
      const p = pitches.find((x) => x.id === pitchId);
      return p ? [...prev, p] : prev;
    });
  };

  return (
    <div className="flex flex-col min-h-screen pt-16 pb-40">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 mb-4">
        <a href={selectMode ? "/play/create" : "/"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1">
          <h1 className="text-xl font-extrabold">Find a Pitch</h1>
          <p className="text-xs text-text-secondary">
            {selectMode ? "Rank up to 3 pitches — tap to select" : "Browse and book a venue"}
          </p>
        </div>
        <div className="flex bg-surface border border-border rounded-btn p-1">
          {(["map", "list"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${view === v ? "bg-accent text-white" : "text-text-secondary"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {selectMode && (
        <div className="mx-4 mb-3 bg-accent/10 border border-accent/30 rounded-xl px-4 py-2.5">
          <p className="text-xs text-accent-ink font-medium">Tap to rank up to 3 pitches. First tap = preferred, next = backup.</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : (
        <>
          {/* MAP VIEW */}
          {view === "map" && (
            <div className="px-4 mb-4">
              <PitchMap
                pitches={pitches}
                pickedPitches={pickedPitches}
                onSelect={handleMapSelect}
                selectMode={selectMode}
                unaffordableIds={selectMode ? new Set(pitches.filter(p => !isAffordable(p) || !isEnoughPlayers(p)).map(p => p.id)) : new Set()}
              />
            </div>
          )}

          {/* Format filter (list view) */}
          {view === "list" && (
            <div className="flex gap-2 overflow-x-auto pb-1 px-4 mb-3">
              {formats.map((f) => (
                <button key={f} onClick={() => setFilterFormat(f)}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${filterFormat === f ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {f}
                </button>
              ))}
            </div>
          )}

          {/* LIST VIEW */}
          {view === "list" && (
            <div className="flex flex-col gap-4 px-4">
              {filteredPitches.map((pitch) => {
                const pickIndex = pickedPitches.findIndex((p) => p.id === pitch.id);
                const isPicked = pickIndex !== -1;

                return (
                  <div key={pitch.id} className={`bg-surface-2 border rounded-2xl overflow-hidden relative transition-all ${isPicked ? "border-accent/60" : "border-border"}`}>
                    {isPicked && (
                      <div className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center font-bold text-sm shadow">
                        {pickIndex + 1}
                      </div>
                    )}
                    {/* Pitch image placeholder */}
                    <div className={`w-full h-24 relative flex items-center justify-center ${isPicked ? "bg-gradient-to-br from-green-800 to-green-600" : "bg-gradient-to-br from-green-900 to-green-700"}`}>
                      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(255,255,255,.1) 20px,rgba(255,255,255,.1) 21px),repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(255,255,255,.1) 40px,rgba(255,255,255,.1) 41px)" }} />
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M2 12h20M12 2v20"/></svg>
                      {pitch.is_verified && (
                        <div className="absolute top-2 left-2 bg-accent/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>
                          Verified
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-1">
                        <p className="font-semibold text-sm pr-8">{pitch.name}</p>
                        <div className="text-right flex-shrink-0">
                          <span className={`text-lg font-bold ${selectMode && !isAffordable(pitch) ? "text-red-600" : "text-accent-ink"}`}>£{(pitch.price_per_hour * 1.05 / 2).toFixed(2)}</span>
                          <p className="text-[10px] text-text-secondary">per hour</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-text-secondary mb-2">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        {pitch.address}
                      </div>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Stars rating={pitch.rating} />
                        {pitch.surfaces.map((s) => <span key={s} className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md">{s}</span>)}
                        {pitch.formats.map((f) => <span key={f} className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md">{f}</span>)}
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {pitch.amenities.map((a) => (
                          <span key={a} className="text-[10px] text-text-secondary flex items-center gap-0.5">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                            {a}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-text-secondary mb-3">
                        ≈ <span className="font-semibold text-accent-ink">£{(pitch.price_per_hour / 22 * 1.05).toFixed(2)}/player</span> inc. 5% Unitr fee
                      </p>

                      {/* Slot availability for captain's posting dates */}
                      {selectMode && postingSlots.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Your Match Dates</p>
                          {checkingSlots ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-3 h-3 rounded-full border border-accent border-t-transparent animate-spin" />
                              <span className="text-[10px] text-text-secondary">Checking availability…</span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {effectiveSlots(pitch.id).map((slot, i) => {
                                const status = pitchSlotMap[pitch.id]?.[i];
                                const overridden = pitchOverrides[pitch.id]?.[slot.matchDate] !== undefined;
                                return (
                                  <span key={i} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border ${
                                    status === "available" ? "bg-accent/10 text-accent-ink border-accent/20" :
                                    status === "booked" ? "bg-red-500/10 text-red-600 border-red-500/20" :
                                    "bg-surface text-text-secondary border-border opacity-60"
                                  }`}>
                                    {status === "available" && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                    {status === "booked" && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>}
                                    {slot.dayName.slice(0, 3)} {slot.time}
                                    {overridden ? " · adjusted" : status === "booked" ? " · Taken" : status === "closed" ? " · Closed" : ""}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {!checkingSlots && isAllSlotsTaken(pitch) && (
                            <p className="text-[10px] text-red-600 mt-1.5">All your slots are taken at this pitch.</p>
                          )}
                        </div>
                      )}

                      {selectMode ? (
                        <>
                          {!isAffordable(pitch) && (
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className="w-4 h-4 rounded-full border border-red-400 flex items-center justify-center flex-shrink-0">
                                <span className="text-[9px] font-bold text-red-600">i</span>
                              </div>
                              <span className="text-[11px] text-red-600">Insufficient team credits to book this pitch</span>
                            </div>
                          )}
                          {!isEnoughPlayers(pitch) && (
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className="w-4 h-4 rounded-full border border-red-400 flex items-center justify-center flex-shrink-0">
                                <span className="text-[9px] font-bold text-red-600">i</span>
                              </div>
                              <span className="text-[11px] text-red-600">Not enough available players for this pitch size</span>
                            </div>
                          )}
                          <button
                            onClick={() => setDetailPitch(pitch)}
                            className={`w-full py-2.5 rounded-xl font-bold text-sm transition-colors ${
                              isPicked ? "bg-accent/20 text-accent-ink border border-accent" :
                              isAllSlotsTaken(pitch) || !isAffordable(pitch) || !isEnoughPlayers(pitch) ? "bg-red-500/10 text-red-600 border border-red-500/20" :
                              "bg-accent text-white"
                            }`}>
                            {isPicked
                              ? `✓ ${rankLabels[pickIndex]} · View →`
                              : isAllSlotsTaken(pitch)
                                ? "Check alternatives →"
                                : !isAffordable(pitch) || !isEnoughPlayers(pitch)
                                  ? "Unavailable →"
                                  : "Select this pitch →"}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => { setSelectedPitch(pitch); setShowBooking(true); }}
                          className="w-full py-2.5 rounded-btn bg-accent text-white font-bold text-sm">Book This Pitch</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Venue registration CTA */}
              <a href="/pitches/register" className="block border border-dashed border-border rounded-2xl p-5 text-center">
                <p className="text-sm font-semibold mb-1">Own a pitch?</p>
                <p className="text-xs text-text-secondary mb-2">Register your venue on Unitr and get bookings from local teams.</p>
                <span className="text-xs text-accent-ink font-medium">Register your pitch →</span>
              </a>
            </div>
          )}
        </>
      )}

      {/* SELECT MODE: sticky confirm bar — hidden while the detail panel is open so it doesn't cover the panel's controls */}
      {selectMode && !detailPitch && (
        /* z-40: chrome tier. Above the map layers, below the z-50 overlay floor
           so the confirm dialog isn't painted over by this bar. */
        <div className="fixed bottom-20 left-0 right-0 z-40 bg-surface border-t border-border px-4 pt-3 pb-3">
          {pickedPitches.length > 0 && (
            <div className="flex items-center gap-2 mb-2 overflow-x-auto">
              {pickedPitches.map((p, i) => (
                <div key={p.id} className="flex items-center gap-1.5 bg-accent/10 border border-accent/30 rounded-full pl-1.5 pr-3 py-1 flex-shrink-0">
                  <div className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</div>
                  <span className="text-xs font-medium truncate max-w-[100px]">{p.name.split(" ")[0]}</span>
                  <button onClick={() => togglePitch(p)} className="text-text-secondary ml-0.5 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
          <button
            disabled={pickedPitches.length === 0}
            onClick={confirmSelection}
            className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pickedPitches.length === 0 ? "Select at least 1 pitch" : `Confirm ${pickedPitches.length} Pitch${pickedPitches.length > 1 ? "es" : ""} →`}
          </button>
        </div>
      )}

      {/* Pitch availability panel (select mode) */}
      {detailPitch && selectMode && (
        <PitchAvailabilityPanel
          pitch={detailPitch}
          postingSlots={detailSlots}
          pitchSlotStatuses={pitchSlotMap[detailPitch.id] ?? []}
          isPicked={pickedPitches.some(p => p.id === detailPitch.id)}
          pickIndex={pickedPitches.findIndex(p => p.id === detailPitch.id)}
          onClose={() => setDetailPitch(null)}
          onToggle={() => {
            const already = pickedPitches.some(p => p.id === detailPitch.id);
            if (already) {
              setPickedPitches(prev => prev.filter(p => p.id !== detailPitch.id));
            } else if (isAffordable(detailPitch) && pickedPitches.length < 3) {
              setPickedPitches(prev => [...prev, detailPitch]);
            }
            setDetailPitch(null);
          }}
          slotOverrides={pitchOverrides[detailPitch.id] ?? {}}
          onReplaceSlot={(date, newTime) => replaceSlot(detailPitch.id, date, newTime)}
          canAdd={isAffordable(detailPitch) && pickedPitches.length < 3}
        />
      )}

      {/* Booking panel */}
      {showBooking && selectedPitch && (
        <BookingPanel pitch={selectedPitch} onClose={() => setShowBooking(false)} onBook={handleBook} />
      )}

      {/* Booking confirmed */}
      {bookedInfo && selectedPitch && (
        <BookingConfirmed
          pitch={selectedPitch}
          date={bookedInfo.date}
          time={bookedInfo.time}
          onDone={() => { setBookedInfo(null); setSelectedPitch(null); }}
        />
      )}
    </div>
  );
}

export default function PitchesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>}>
      <PitchesContent />
    </Suspense>
  );
}
