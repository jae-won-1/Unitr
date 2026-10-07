"use client";

import { GENDER_CATEGORIES, GENDER_FILTERS, type GenderCategory, type GenderFilter } from "@/lib/gender";

// The two gender controls, so every feed and every form draws them the same
// way. Rules and labels live in lib/gender.ts.

/** Men's · Women's · All — a feed's view, opening on the viewer's own. */
export function GenderFilterChips({ value, onChange }: { value: GenderFilter; onChange: (v: GenderFilter) => void }) {
  return (
    <div className="inline-flex bg-surface-2 border border-border rounded-full p-0.5" role="radiogroup" aria-label="Men's or women's games">
      {GENDER_FILTERS.map((g) => (
        <button key={g.value} type="button" role="radio" aria-checked={value === g.value}
          onClick={() => onChange(g.value)}
          className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-colors ${
            value === g.value ? "bg-accent text-white" : "text-text-secondary"
          }`}>
          {g.label}
        </button>
      ))}
    </div>
  );
}

/** Men's / Women's — which competition a team or event belongs to. */
export function GenderCategoryPicker({ value, onChange, disabled = false }: {
  value: GenderCategory | null;
  onChange: (v: GenderCategory) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {GENDER_CATEGORIES.map((g) => (
        <button key={g.value} type="button" disabled={disabled} onClick={() => onChange(g.value)}
          className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            value === g.value ? "bg-accent text-white border-accent" : "bg-surface-2 border-border text-text-secondary"
          }`}>
          {g.label}
        </button>
      ))}
    </div>
  );
}

/** The small label a card carries, e.g. on a team row or an event. */
export function GenderBadge({ category }: { category: GenderCategory }) {
  const label = GENDER_CATEGORIES.find((g) => g.value === category)?.label;
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-surface text-text-secondary border-border whitespace-nowrap">
      {label}
    </span>
  );
}
