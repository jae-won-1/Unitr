"use client";

import { useMemo, useState } from "react";
import { KIND_LABEL, KIND_STYLE, type CalendarEntry, type EntryKind } from "@/lib/calendar-entries";
import { todayKey } from "@/lib/match-dates";

// The month-grid date picker behind the Calendar page's 📅 pill.
//
// The grid itself came from the old /my-team/availability page: Monday-first
// week offsets, a ring on today, a fill on the selection. What changed is what
// the dots mean — they're driven by the viewer's actual entries now, coloured by
// kind, so the month view answers "when do I have things on" at a glance and
// tapping a marked day scopes the list below it.

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstWeekday(y: number, m: number) { return (new Date(y, m, 1).getDay() + 6) % 7; } // Mon = 0

export default function CalendarSheet({ entries, selected, onSelect, onClose }: {
  entries: CalendarEntry[];
  /** Currently-scoped date key, or null for "everything". */
  selected: string | null;
  onSelect: (dateKey: string | null) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const start = selected ? new Date(`${selected}T12:00:00`) : today;
  const [year, setYear] = useState(start.getFullYear());
  const [month, setMonth] = useState(start.getMonth());

  // Kinds present on each date, deduped and capped — three dots is as much as
  // a 32px cell can carry before they stop reading as distinct.
  const kindsByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry["kind"][]>();
    for (const e of entries) {
      const list = map.get(e.date) ?? [];
      if (!list.includes(e.kind) && list.length < 3) list.push(e.kind);
      map.set(e.date, list);
    }
    return map;
  }, [entries]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1);
  };

  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const tKey = todayKey();

  return (
    // z-[60] — above the z-40 nav chrome, which otherwise paints over the
    // bottom of any sheet a page opens (see components/BottomNav.tsx).
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl max-h-[88dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>

        <div className="px-5 pt-2 md:pt-5 pb-6">
          <div className="flex items-center justify-between mb-5">
            <p className="font-bold">Pick a date</p>
            <button onClick={onClose} aria-label="Close"
              className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} aria-label="Previous month"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-2 border border-border">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h2 className="text-base font-bold">{MONTH_NAMES[month]} {year}</h2>
            <button onClick={nextMonth} aria-label="Next month"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-2 border border-border">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {DAY_LABELS.map((d, i) => (
              <div key={i} className="text-center text-[11px] font-semibold text-text-secondary py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isToday = dateStr === tKey;
              const isSelected = selected === dateStr;
              const kinds = kindsByDate.get(dateStr) ?? [];

              return (
                // The whole cell is the target in the rebrand — a filled rounded
                // square rather than a circle around the numeral. A day with
                // something on takes a pale green wash; the selected day takes
                // the solid accent, and its dots invert to stay visible on it.
                <button key={i} onClick={() => { onSelect(isSelected ? null : dateStr); onClose(); }}
                  className={`h-10 rounded-[10px] flex flex-col items-center justify-center gap-[3px] transition-colors ${
                    isSelected ? "bg-accent"
                      : isToday ? "border border-accent"
                      : kinds.length > 0 ? "bg-[#E7F8EC]" : ""
                  }`}>
                  <span className={`text-[13px] leading-none ${
                    isSelected ? "font-extrabold text-white" : "font-semibold text-text-primary"
                  }`}>
                    {day}
                  </span>
                  <span className="flex gap-[3px] h-[5px] items-center">
                    {kinds.map((k) => (
                      <span key={k} className={`w-[5px] h-[5px] rounded-full ${isSelected ? "bg-white/70" : KIND_STYLE[k].dot}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Legend — the dots are the only thing distinguishing one busy day
              from another, so the grid needs a key to be readable at all. */}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 mt-3 pt-2.5 border-t border-border">
            {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
                <span className={`w-1.5 h-1.5 rounded-full ${KIND_STYLE[k].dot}`} />
                {KIND_LABEL[k]}
              </span>
            ))}
          </div>

          {selected && (
            <button onClick={() => { onSelect(null); onClose(); }}
              className="w-full mt-4 py-2.5 rounded-btn border border-border text-sm font-semibold text-text-secondary">
              Show all dates
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
