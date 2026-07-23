"use client";

import { useEffect, useState, useRef } from "react";

// ── Date Picker ───────────────────────────────────────────────
export function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const today = new Date();
  const initDate = value ? new Date(value + "T12:00:00") : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  const select = (day: number) => {
    // Build ISO string in local time to avoid UTC timezone shift
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(iso);
    setOpen(false);
  };

  const isSelected = (day: number) => {
    if (!value) return false;
    const d = new Date(value + "T12:00:00");
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth && d.getDate() === day;
  };

  const isToday = (day: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;

  const isPast = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    d.setHours(0, 0, 0, 0);
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return d < t;
  };

  const display = value
    ? new Date(value + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "Select date";

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-left flex items-center gap-2 outline-none focus:border-accent/50">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        <span className={value ? "text-text-primary" : "text-text-secondary"}>{display}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-2xl p-3 shadow-xl w-64">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <p className="text-sm font-bold">{monthNames[viewMonth]} {viewYear}</p>
            <button type="button" onClick={nextMonth} className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {dayNames.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-text-secondary py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const selected = isSelected(day);
              const past = isPast(day);
              const todayDay = isToday(day);
              return (
                <button key={day} type="button" onClick={() => !past && select(day)} disabled={past}
                  className={`w-full aspect-square rounded-lg text-xs font-semibold transition-colors ${selected ? "bg-accent text-black" : todayDay ? "border border-accent/50 text-accent" : past ? "text-text-secondary opacity-30 cursor-not-allowed" : "text-text-primary hover:bg-surface-2"}`}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Time Picker ───────────────────────────────────────────────
export function TimePicker({
  value,
  onChange,
  selectedDate,
}: {
  value: string;
  onChange: (t: string) => void;
  selectedDate?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const parse = (val: string): { hour: number; ampm: "AM" | "PM" } => {
    if (!val) return { hour: 9, ampm: "AM" };
    const [h] = val.split(":").map(Number);
    return { hour: h === 0 ? 12 : h > 12 ? h - 12 : h, ampm: h >= 12 ? "PM" : "AM" };
  };

  const initial = parse(value);
  const [hour, setHour] = useState(initial.hour);
  const [ampm, setAmpm] = useState<"AM" | "PM">(initial.ampm);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Past-hour blocking: only active when selectedDate is today.
  const todayStr = new Date().toISOString().split("T")[0];
  const currentHour = new Date().getHours();
  const isToday = !!selectedDate && selectedDate === todayStr;
  const toHour24 = (h: number, a: "AM" | "PM") =>
    a === "AM" ? (h === 12 ? 0 : h) : (h === 12 ? 12 : h + 12);
  const isHourPast = (h: number, a: "AM" | "PM") =>
    isToday && toHour24(h, a) <= currentHour;

  const emit = (h: number, a: "AM" | "PM") => {
    if (isHourPast(h, a)) return;
    const hour24 = toHour24(h, a);
    onChange(`${String(hour24).padStart(2, "0")}:00`);
  };

  const display = value
    ? (() => { const { hour: h, ampm: a } = parse(value); return `${h}:00 ${a}`; })()
    : "Select time";

  const DIAL_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const SIZE = 164;
  const C = SIZE / 2;
  const R = 58;
  const BR = 15;

  const angleOf = (h: number) => (DIAL_HOURS.indexOf(h) * 30 - 90) * (Math.PI / 180);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-left flex items-center gap-2 outline-none focus:border-accent/50">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span className={value ? "text-text-primary" : "text-text-secondary"}>{display}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-2xl p-4 shadow-xl w-[196px]">
          <p className="text-xs font-semibold text-center text-text-secondary mb-3">Kick-off hour</p>

          {/* Clock dial */}
          <svg width={SIZE} height={SIZE} style={{ display: "block" }}>
            {/* Face ring */}
            <circle cx={C} cy={C} r={C - 2} fill="none" stroke="#2a2a2a" strokeWidth="1.5" />

            {/* Hand — only when a valid (non-past) hour is selected */}
            {!isHourPast(hour, ampm) && (() => {
              const a = angleOf(hour);
              return (
                <line
                  x1={C} y1={C}
                  x2={C + (R - BR - 2) * Math.cos(a)}
                  y2={C + (R - BR - 2) * Math.sin(a)}
                  stroke="#00E676" strokeWidth="1.5" strokeLinecap="round"
                />
              );
            })()}

            {/* Center dot */}
            <circle cx={C} cy={C} r={3.5} fill="#00E676" />

            {/* Hour markers */}
            {DIAL_HOURS.map((h) => {
              const a = angleOf(h);
              const x = C + R * Math.cos(a);
              const y = C + R * Math.sin(a);
              const selected = hour === h && !isHourPast(h, ampm);
              const past = isHourPast(h, ampm);
              return (
                <g key={h}
                  onClick={() => { if (past) return; setHour(h); emit(h, ampm); }}
                  style={{ cursor: past ? "not-allowed" : "pointer" }}>
                  <circle cx={x} cy={y} r={BR}
                    fill={selected ? "#00E676" : past ? "#1e1e1e" : "transparent"} />
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                    fontSize="12" fontWeight="700"
                    fill={selected ? "#000000" : past ? "#333333" : "#9E9E9E"}
                    style={{ userSelect: "none", pointerEvents: "none" }}>
                    {h}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* AM / PM */}
          <div className="flex gap-2 mt-3">
            {(["AM", "PM"] as const).map((a) => (
              <button key={a} type="button" onClick={() => {
                setAmpm(a);
                if (isHourPast(hour, a)) {
                  onChange("");
                } else {
                  emit(hour, a);
                }
              }}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-colors ${ampm === a ? "bg-accent text-black" : "bg-surface-2 text-text-secondary"}`}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
