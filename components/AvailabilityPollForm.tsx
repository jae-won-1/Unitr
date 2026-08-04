"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";

// Poll creation, shared by the Collect Availability page and the captain's home
// tile. One implementation because the create step has a rule that is easy to
// get wrong twice: a team has exactly one live poll, so posting a new one
// deletes the previous request (and its responses) first. Two copies of that
// would eventually drift into two live polls.

export type DateOption = {
  id: string;
  date: string;
  time: string;
  day: string;
  month: string;
  dayName: string;
};

const MONTH_NAMES = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

export function parseDateOption(dateStr: string, timeStr: string): DateOption {
  const d = new Date(dateStr + "T" + timeStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = MONTH_NAMES[d.getMonth()];
  const dayName = DAY_NAMES[d.getDay()];
  const display = `${dayName.slice(0, 3)}, ${day} ${month} ${d.getFullYear()}`;
  return { id: crypto.randomUUID(), date: display, time: timeStr, day, month, dayName };
}

function isWithin24h(date: string, time: string): boolean {
  if (!date || !time) return false;
  const dt = new Date(date + "T" + time);
  const diff = dt.getTime() - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

export default function AvailabilityPollForm({
  teamId, captainId, onCreated, showIntro = true,
}: {
  teamId: string;
  captainId: string;
  onCreated: () => void;
  showIntro?: boolean;
}) {
  const [rows, setRows] = useState([{ date: "", time: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (i: number, field: "date" | "time", value: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const handleSubmit = async () => {
    const filled = rows.filter((r) => r.date && r.time);
    if (filled.length < 1) { setError("Add at least 1 date option."); return; }
    setSaving(true);
    setError(null);

    const { data: existing } = await supabase
      .from("availability_requests").select("id").eq("team_id", teamId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      await fetch("/api/availability/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: existing.id, captainId }),
      });
    }

    const date_options = filled.map((r) => parseDateOption(r.date, r.time));
    const { error: insertError } = await supabase
      .from("availability_requests")
      .insert({ team_id: teamId, captain_id: captainId, date_options });

    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    onCreated();
  };

  return (
    <div className="flex flex-col gap-5 pt-2">
      {showIntro && (
        <div className="bg-surface-2 border border-border rounded-xl p-4">
          <p className="text-sm font-semibold mb-1">Send availability request</p>
          <p className="text-xs text-text-secondary">Add 1–5 date options. Your squad will vote on which they can make.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-secondary">Date {i + 1}</span>
            <div className="flex items-center gap-2">
              <div className="w-36 flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Date</label>
                <DatePicker value={row.date} onChange={(d) => updateRow(i, "date", d)} />
              </div>
              <div className="w-36 flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Time</label>
                <TimePicker value={row.time} selectedDate={row.date} onChange={(t) => updateRow(i, "time", t)} />
              </div>
              {rows.length > 1 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs invisible">_</span>
                  <button onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                    className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {isWithin24h(row.date, row.time) && (
              <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p className="text-xs text-yellow-400">You have selected a time less than 24 hours from now. The team credits will not be reimbursed if you cannot find an opponent.</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {rows.length < 5 && (
        <button onClick={() => setRows((p) => [...p, { date: "", time: "" }])}
          className="flex items-center gap-2 text-sm text-accent font-medium py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add date option
        </button>
      )}

      <button onClick={handleSubmit} disabled={saving}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
        {saving
          ? <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Sending…</>
          : "Send to Squad"}
      </button>
    </div>
  );
}
