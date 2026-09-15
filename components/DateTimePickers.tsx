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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        <span className={value ? "text-text-primary" : "text-text-secondary"}>{display}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-2xl p-3 shadow-xl w-64">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <p className="text-sm font-bold">{monthNames[viewMonth]} {viewYear}</p>
            <button type="button" onClick={nextMonth} className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
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
                  className={`w-full aspect-square rounded-lg text-xs font-semibold transition-colors ${selected ? "bg-accent text-white" : todayDay ? "border border-accent/50 text-accent-ink" : past ? "text-text-secondary opacity-30 cursor-not-allowed" : "text-text-primary hover:bg-surface-2"}`}>
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
//
// A dial, not a native `<input type="time">`: the same control everywhere in
// the app, and the only one that reads the same on every browser.
//
// By default it picks a WHOLE HOUR — that is what pitch slots, poll dates and
// venue opening rules are, and every existing caller relies on it. Pass
// `minuteStep` (e.g. 5) to ask for minutes too: the dial then runs in two
// stages, hours first and minutes second, the way a phone's clock picker does.
// Off by default so nothing that wants an hour can be handed :37.
export function TimePicker({
  value,
  onChange,
  selectedDate,
  label,
  minuteStep,
}: {
  value: string;
  onChange: (t: string) => void;
  selectedDate?: string;
  label?: string;
  minuteStep?: number;
}) {
  const withMinutes = typeof minuteStep === "number" && minuteStep > 0;
  const heading = label ?? (withMinutes ? "Kick-off time" : "Kick-off hour");

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"hour" | "minute">("hour");
  const ref = useRef<HTMLDivElement>(null);

  const parse = (val: string): { hour: number; minute: number; ampm: "AM" | "PM" } => {
    if (!val) return { hour: 9, minute: 0, ampm: "AM" };
    const [h, m] = val.split(":").map(Number);
    return {
      hour: h === 0 ? 12 : h > 12 ? h - 12 : h,
      minute: Number.isFinite(m) ? m : 0,
      ampm: h >= 12 ? "PM" : "AM",
    };
  };

  const initial = parse(value);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [ampm, setAmpm] = useState<"AM" | "PM">(initial.ampm);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Past-time blocking: only active when selectedDate is today.
  const now = new Date();
  const todayStr = new Date().toISOString().split("T")[0];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const currentHour = now.getHours();
  const isToday = !!selectedDate && selectedDate === todayStr;
  const toHour24 = (h: number, a: "AM" | "PM") =>
    a === "AM" ? (h === 12 ? 0 : h) : (h === 12 ? 12 : h + 12);

  const MINUTES: number[] = withMinutes
    ? Array.from({ length: Math.max(1, Math.round(60 / minuteStep!)) }, (_, i) => (i * minuteStep!) % 60)
    : [0];

  // An hour is out when nothing inside it is still reachable — its last
  // selectable minute, not :59, or the ring could open with every marker grey.
  // Hour-only mode keeps its original, coarser test: the whole current hour is
  // gone, because the only time it could ever return is :00.
  const isMinutePast = (h: number, a: "AM" | "PM", m: number) =>
    isToday && toHour24(h, a) * 60 + m <= nowMin;
  const isHourPast = (h: number, a: "AM" | "PM") =>
    isToday && (withMinutes
      ? isMinutePast(h, a, MINUTES[MINUTES.length - 1])
      : toHour24(h, a) <= currentHour);

  const emit = (h: number, a: "AM" | "PM", m: number) => {
    if (withMinutes ? isMinutePast(h, a, m) : isHourPast(h, a)) return;
    onChange(`${String(toHour24(h, a)).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  // Picking an hour keeps the minute already chosen unless that exact time has
  // just gone — then it slides to the first minute in the hour that hasn't.
  const settleMinute = (h: number, a: "AM" | "PM", m: number) => {
    if (!withMinutes || !isMinutePast(h, a, m)) return m;
    return MINUTES.find((cand) => !isMinutePast(h, a, cand)) ?? m;
  };

  const selectHour = (h: number) => {
    if (isHourPast(h, ampm)) return;
    const m = settleMinute(h, ampm, minute);
    setHour(h);
    setMinute(m);
    emit(h, ampm, m);
    if (withMinutes) setStage("minute");
  };

  const selectMinute = (m: number) => {
    if (isMinutePast(hour, ampm, m)) return;
    setMinute(m);
    emit(hour, ampm, m);
  };

  const selectAmpm = (a: "AM" | "PM") => {
    setAmpm(a);
    if (isHourPast(hour, a)) { onChange(""); return; }
    const m = settleMinute(hour, a, minute);
    setMinute(m);
    emit(hour, a, m);
  };

  const display = value
    ? (() => {
        const p = parse(value);
        return withMinutes
          ? `${p.hour}:${String(p.minute).padStart(2, "0")} ${p.ampm}`
          : `${p.hour}:00 ${p.ampm}`;
      })()
    : "Select time";

  const DIAL_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const SIZE = 164;
  const C = SIZE / 2;
  const R = 58;
  const BR = 15;

  const angleOf = (h: number) => (DIAL_HOURS.indexOf(h) * 30 - 90) * (Math.PI / 180);
  const minuteAngleOf = (m: number) => ((m / 60) * 360 - 90) * (Math.PI / 180);

  const showingMinutes = withMinutes && stage === "minute";
  const handAngle = showingMinutes ? minuteAngleOf(minute) : angleOf(hour);
  const handHidden = showingMinutes
    ? isMinutePast(hour, ampm, minute)
    : isHourPast(hour, ampm);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setStage("hour"); setOpen((o) => !o); }}
        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-left flex items-center gap-2 outline-none focus:border-accent/50">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span className={value ? "text-text-primary" : "text-text-secondary"}>{display}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-2xl p-4 shadow-xl w-[196px]">
          {withMinutes ? (
            // Tappable read-out — the way back to the hour ring once the dial
            // has moved on to minutes.
            <div className="flex items-baseline justify-center gap-0.5 mb-3">
              <button type="button" onClick={() => setStage("hour")}
                className={`text-xl font-bold leading-none tabular-nums ${stage === "hour" ? "text-accent" : "text-text-secondary"}`}>
                {hour}
              </button>
              <span className="text-xl font-bold leading-none text-text-secondary">:</span>
              <button type="button" onClick={() => setStage("minute")}
                className={`text-xl font-bold leading-none tabular-nums ${stage === "minute" ? "text-accent" : "text-text-secondary"}`}>
                {String(minute).padStart(2, "0")}
              </button>
              <span className="text-[11px] font-bold text-text-secondary ml-1">{ampm}</span>
            </div>
          ) : (
            <p className="text-xs font-semibold text-center text-text-secondary mb-3">{heading}</p>
          )}

          {/* Clock dial */}
          <svg width={SIZE} height={SIZE} style={{ display: "block" }}>
            {/* Face ring */}
            <circle cx={C} cy={C} r={C - 2} fill="none" stroke="#DCE2EF" strokeWidth="1.5" />

            {/* Hand — only when the marker it points at is still selectable */}
            {!handHidden && (
              <line
                x1={C} y1={C}
                x2={C + (R - BR - 2) * Math.cos(handAngle)}
                y2={C + (R - BR - 2) * Math.sin(handAngle)}
                stroke="#0E7A3C" strokeWidth="1.5" strokeLinecap="round"
              />
            )}

            {/* Center dot */}
            <circle cx={C} cy={C} r={3.5} fill="#0E7A3C" />

            {/* Markers — hours, or minutes once an hour has been picked */}
            {showingMinutes
              ? MINUTES.map((m) => {
                  const a = minuteAngleOf(m);
                  const x = C + R * Math.cos(a);
                  const y = C + R * Math.sin(a);
                  const past = isMinutePast(hour, ampm, m);
                  const selected = minute === m && !past;
                  return (
                    <g key={m} onClick={() => selectMinute(m)}
                      style={{ cursor: past ? "not-allowed" : "pointer" }}>
                      <circle cx={x} cy={y} r={BR}
                        fill={selected ? "#0E7A3C" : past ? "#E9EDF6" : "transparent"} />
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                        fontSize="11" fontWeight="700"
                        fill={selected ? "#000000" : past ? "#333333" : "#5A6478"}
                        style={{ userSelect: "none", pointerEvents: "none" }}>
                        {String(m).padStart(2, "0")}
                      </text>
                    </g>
                  );
                })
              : DIAL_HOURS.map((h) => {
                  const a = angleOf(h);
                  const x = C + R * Math.cos(a);
                  const y = C + R * Math.sin(a);
                  const past = isHourPast(h, ampm);
                  const selected = hour === h && !past;
                  return (
                    <g key={h} onClick={() => selectHour(h)}
                      style={{ cursor: past ? "not-allowed" : "pointer" }}>
                      <circle cx={x} cy={y} r={BR}
                        fill={selected ? "#0E7A3C" : past ? "#E9EDF6" : "transparent"} />
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                        fontSize="12" fontWeight="700"
                        fill={selected ? "#000000" : past ? "#333333" : "#5A6478"}
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
              <button key={a} type="button" onClick={() => selectAmpm(a)}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-colors ${ampm === a ? "bg-accent text-white" : "bg-surface-2 text-text-secondary"}`}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
