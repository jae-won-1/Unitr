"use client";

import { toDateKey } from "@/lib/match-dates";

// Horizontal day strip, the way Plab scopes its match feed. Leads with "All"
// rather than defaulting to today: supply is thin enough across every feed that
// a today-only default would show an empty list most of the time.

export function buildDays(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { key, label: i === 0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short" }), day: d.getDate() };
  });
}

// Tally of how many items fall on each day, so days with something on get a dot.
export function countByDate<T>(items: T[], getDate: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = toDateKey(getDate(item));
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export default function DateDial({ value, onChange, counts, days = 14 }: {
  value: string | null;
  onChange: (v: string | null) => void;
  counts: Map<string, number>;
  days?: number;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Selection here is dark navy rather than the accent green: the dial sits
          directly under the green category pills, and a second green would make
          "which day" and "which category" read as one control. */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`flex-shrink-0 px-4 h-16 rounded-btn text-xs font-bold border transition-colors ${
          value === null ? "bg-text-primary text-white border-text-primary" : "bg-surface text-text-primary border-border"
        }`}
      >
        All
      </button>
      {buildDays(days).map((d) => {
        const active = value === d.key;
        const has = (counts.get(d.key) ?? 0) > 0;
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onChange(active ? null : d.key)}
            className={`flex-shrink-0 w-14 h-16 rounded-btn flex flex-col items-center justify-center gap-0.5 border transition-colors ${
              active ? "bg-text-primary border-text-primary" : "bg-surface border-border"
            }`}
          >
            <span className={`text-[10px] font-semibold ${active ? "text-white/75" : "text-text-secondary"}`}>{d.label}</span>
            <span className={`text-base font-bold ${active ? "text-white" : "text-text-primary"}`}>{d.day}</span>
            <span className={`w-1 h-1 rounded-full ${has ? (active ? "bg-white/60" : "bg-accent-ink") : "bg-transparent"}`} />
          </button>
        );
      })}
    </div>
  );
}
