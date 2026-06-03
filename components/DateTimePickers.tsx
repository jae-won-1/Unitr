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
export function TimePicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const [open, setOpen] = useState(false);

  const parse = (val: string) => {
    if (!val) return { hour: 9, minute: 0, ampm: "AM" };
    const [h, m] = val.split(":").map(Number);
    return { hour: h === 0 ? 12 : h > 12 ? h - 12 : h, minute: m, ampm: h >= 12 ? "PM" : "AM" };
  };

  const initial = parse(value);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [ampm, setAmpm] = useState(initial.ampm);

  const confirm = () => {
    let h = hour;
    if (ampm === "AM" && hour === 12) h = 0;
    else if (ampm === "PM" && hour !== 12) h = hour + 12;
    onChange(`${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    setOpen(false);
  };

  const display = value
    ? (() => { const { hour: h, minute: m, ampm: a } = parse(value); return `${h}:${String(m).padStart(2, "0")} ${a}`; })()
    : "Select time";

  const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const MINUTES = [0, 15, 30, 45];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-left flex items-center gap-2 outline-none focus:border-accent/50">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span className={value ? "text-text-primary" : "text-text-secondary"}>{display}</span>
      </button>

      {/* Fixed bottom sheet — never gets cut off */}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50"
          onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg bg-[#141414] border-t border-border rounded-t-2xl pb-safe"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="px-5 pb-5">
              <p className="text-sm font-semibold text-center mb-4">Select Time</p>

              <div className="flex gap-3 justify-center mb-5">
                {/* Hours */}
                <div className="flex flex-col gap-1 items-center">
                  <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">Hr</p>
                  <div className="overflow-y-auto max-h-48 flex flex-col gap-1 pr-1 scrollbar-hide">
                    {HOURS.map((h) => (
                      <button key={h} type="button" onClick={() => setHour(h)}
                        className={`w-14 py-2 rounded-xl text-sm font-bold transition-colors flex-shrink-0 ${hour === h ? "bg-accent text-black" : "bg-surface-2 text-text-secondary"}`}>
                        {h}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Minutes */}
                <div className="flex flex-col gap-1 items-center">
                  <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">Min</p>
                  <div className="flex flex-col gap-1">
                    {MINUTES.map((m) => (
                      <button key={m} type="button" onClick={() => setMinute(m)}
                        className={`w-14 py-2 rounded-xl text-sm font-bold transition-colors ${minute === m ? "bg-accent text-black" : "bg-surface-2 text-text-secondary"}`}>
                        {String(m).padStart(2, "0")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AM/PM */}
                <div className="flex flex-col gap-1 items-center">
                  <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">—</p>
                  <div className="flex flex-col gap-1">
                    {["AM", "PM"].map((a) => (
                      <button key={a} type="button" onClick={() => setAmpm(a)}
                        className={`w-14 py-2 rounded-xl text-sm font-bold transition-colors ${ampm === a ? "bg-accent text-black" : "bg-surface-2 text-text-secondary"}`}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button type="button" onClick={confirm}
                className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
