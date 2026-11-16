"use client";

import { useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { DEFAULT_FILTER, type FinanceFilter } from "@/lib/team-finance";

// The dashboard's filter: which requests to show, and what order to put them
// in. Choices are held here until Done, so a half-made change never reshuffles
// the list behind the sheet.

function Radio<T extends string>({ value, current, label, onPick }: {
  value: T; current: T; label: string; onPick: (v: T) => void;
}) {
  const on = value === current;
  return (
    <button type="button" role="radio" aria-checked={on} onClick={() => onPick(value)}
      className="w-full flex items-center gap-4 py-3 text-left">
      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${on ? "border-accent" : "border-border"}`}>
        {on && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

export default function PaymentsFilterSheet({ filter, onDone, onClose }: {
  filter: FinanceFilter;
  onDone: (f: FinanceFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FinanceFilter>(filter);

  return (
    <BottomSheet
      title="Payments filter"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setDraft(DEFAULT_FILTER)}
            className="py-3 rounded-btn border border-border text-sm font-bold text-text-primary">
            Reset
          </button>
          <button type="button" onClick={() => onDone(draft)}
            className="py-3 rounded-btn bg-accent text-white text-sm font-bold">
            Done
          </button>
        </div>
      }
    >
      <div role="radiogroup" aria-label="Filter by">
        <p className="text-xs font-semibold text-text-secondary mb-1">Filter by</p>
        <Radio value="active" current={draft.show} label="Active" onPick={(show) => setDraft({ ...draft, show })} />
        <Radio value="completed" current={draft.show} label="Completed" onPick={(show) => setDraft({ ...draft, show })} />
        <Radio value="all" current={draft.show} label="All" onPick={(show) => setDraft({ ...draft, show })} />
      </div>

      <div className="border-t border-border pt-3" role="radiogroup" aria-label="Sort by">
        <p className="text-xs font-semibold text-text-secondary mb-1">Sort by</p>
        <Radio value="due" current={draft.sortBy} label="Due date" onPick={(sortBy) => setDraft({ ...draft, sortBy })} />
        <Radio value="sent" current={draft.sortBy} label="Send date" onPick={(sortBy) => setDraft({ ...draft, sortBy })} />
      </div>

      <div className="border-t border-border pt-3" role="radiogroup" aria-label="Order">
        <Radio value="oldest" current={draft.order} label="Oldest first" onPick={(order) => setDraft({ ...draft, order })} />
        <Radio value="newest" current={draft.order} label="Newest first" onPick={(order) => setDraft({ ...draft, order })} />
      </div>
    </BottomSheet>
  );
}
