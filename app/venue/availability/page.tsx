"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Generate HH:00 time options from 06:00 to 23:00
const TIME_OPTIONS = Array.from({ length: 18 }, (_, i) => {
  const h = i + 6;
  return `${String(h).padStart(2, "0")}:00`;
});

type DaySchedule = {
  day_of_week: number;
  is_active: boolean;
  open_time: string;
  close_time: string;
  id?: string;
};

type Block = {
  id: string;
  block_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

type EditingDay = { day: number; open: string; close: string } | null;

function TimeSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-background border border-border rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50 appearance-none">
      {options.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

export default function VenueAvailabilityPage() {
  const { user } = useAuth();
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<DaySchedule[]>(
    DAYS.map((_, i) => ({ day_of_week: i, is_active: true, open_time: "09:00", close_time: "22:00" }))
  );
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [editing, setEditing] = useState<EditingDay>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Block form
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blockAllDay, setBlockAllDay] = useState(true);
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("18:00");
  const [blockSaving, setBlockSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: p } = await supabase.from("pitches").select("id")
        .eq("venue_owner_id", user!.id).maybeSingle();
      if (!p) return;
      setPitchId(p.id);

      const { data: avail } = await supabase.from("pitch_availability")
        .select("*").eq("pitch_id", p.id).order("day_of_week");

      if (avail && avail.length > 0) {
        setSchedule(DAYS.map((_, i) => {
          const row = avail.find((a) => a.day_of_week === i);
          return row
            ? { day_of_week: i, is_active: row.is_active, open_time: row.open_time, close_time: row.close_time, id: row.id }
            : { day_of_week: i, is_active: false, open_time: "09:00", close_time: "22:00" };
        }));
      }

      const { data: blks } = await supabase.from("pitch_blocks")
        .select("*").eq("pitch_id", p.id).order("block_date");
      setBlocks((blks ?? []) as Block[]);
    }
    load();
  }, [user]);

  const toggleDay = (day: number) => {
    setSchedule((s) => s.map((d) => d.day_of_week === day ? { ...d, is_active: !d.is_active } : d));
  };

  const saveSchedule = async () => {
    if (!pitchId) return;
    setSaving(true);
    for (const day of schedule) {
      await supabase.from("pitch_availability").upsert({
        pitch_id: pitchId,
        day_of_week: day.day_of_week,
        is_active: day.is_active,
        open_time: day.open_time,
        close_time: day.close_time,
      }, { onConflict: "pitch_id,day_of_week" });
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const applyDayEdit = () => {
    if (!editing) return;
    setSchedule((s) => s.map((d) =>
      d.day_of_week === editing.day ? { ...d, open_time: editing.open, close_time: editing.close } : d
    ));
    setEditing(null);
  };

  const addBlock = async () => {
    if (!pitchId || !blockDate) return;
    setBlockSaving(true);
    const { data } = await supabase.from("pitch_blocks").insert({
      pitch_id: pitchId,
      block_date: blockDate,
      start_time: blockAllDay ? null : blockStart,
      end_time: blockAllDay ? null : blockEnd,
      reason: blockReason || null,
    }).select().single();
    if (data) setBlocks((b) => [...b, data as Block]);
    setBlockDate(""); setBlockReason(""); setBlockAllDay(true);
    setShowBlockForm(false);
    setBlockSaving(false);
  };

  const removeBlock = async (id: string) => {
    await supabase.from("pitch_blocks").delete().eq("id", id);
    setBlocks((b) => b.filter((x) => x.id !== id));
  };

  // Min date for block = tomorrow
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);
  const minDateStr = minDate.toISOString().slice(0, 10);

  return (
    <div className="px-4 pt-5 pb-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Availability</h1>
        <p className="text-xs text-text-secondary mt-0.5">Set your weekly opening hours. Players can only book during active slots.</p>
      </div>

      {/* Weekly schedule */}
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
        {schedule.map((day, idx) => (
          <div key={day.day_of_week}
            className={`px-4 py-3 flex items-center gap-3 ${idx < schedule.length - 1 ? "border-b border-border" : ""}`}>
            <div className="w-8 text-center">
              <span className={`text-xs font-semibold ${day.is_active ? "text-text-primary" : "text-text-secondary"}`}>
                {DAYS_SHORT[day.day_of_week]}
              </span>
            </div>

            {/* Toggle */}
            <button onClick={() => toggleDay(day.day_of_week)}
              className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${day.is_active ? "bg-accent" : "bg-surface"}`}>
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${day.is_active ? "left-5" : "left-1"}`} />
            </button>

            {day.is_active ? (
              <>
                <div className="flex-1 flex items-center gap-1.5 text-sm font-medium">
                  <span>{day.open_time}</span>
                  <span className="text-text-secondary">–</span>
                  <span>{day.close_time}</span>
                </div>
                <button onClick={() => setEditing({ day: day.day_of_week, open: day.open_time, close: day.close_time })}
                  className="text-xs text-accent font-medium flex-shrink-0">
                  Edit
                </button>
              </>
            ) : (
              <span className="flex-1 text-sm text-text-secondary">Closed</span>
            )}
          </div>
        ))}
      </div>

      {/* Edit hours modal */}
      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-20">
          <div className="w-full max-w-sm bg-[#141414] border border-border rounded-t-2xl px-5 pt-4 pb-6">
            <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-border" /></div>
            <p className="font-semibold mb-4">{DAYS[editing.day]} Hours</p>
            <div className="flex items-center gap-4 mb-5">
              <div className="flex-1">
                <p className="text-xs text-text-secondary mb-1.5">Opens at</p>
                <TimeSelect value={editing.open} onChange={(v) => setEditing({ ...editing, open: v })} options={TIME_OPTIONS} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-text-secondary mb-1.5">Closes at</p>
                <TimeSelect value={editing.close} onChange={(v) => setEditing({ ...editing, close: v })} options={TIME_OPTIONS} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">
                Cancel
              </button>
              <button onClick={applyDayEdit}
                className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save button */}
      <button onClick={saveSchedule} disabled={saving}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
        {saved ? "✓ Saved!" : saving ? "Saving…" : "Save Schedule"}
      </button>

      {/* Date blocks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold">Date Blocks</p>
            <p className="text-xs text-text-secondary mt-0.5">Close specific dates for maintenance, private events, etc.</p>
          </div>
          <button onClick={() => setShowBlockForm(true)}
            className="flex items-center gap-1 text-xs text-accent font-semibold border border-accent/40 px-3 py-1.5 rounded-xl">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Block
          </button>
        </div>

        {blocks.length === 0 ? (
          <div className="bg-surface-2 border border-dashed border-border rounded-2xl px-4 py-5 text-center">
            <p className="text-sm text-text-secondary">No date blocks set</p>
          </div>
        ) : (
          <div className="space-y-2">
            {blocks.map((b) => (
              <div key={b.id} className="bg-surface-2 border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="flex flex-col items-center justify-center w-10 flex-shrink-0">
                  <span className="text-[10px] font-semibold text-red-400 uppercase">
                    {new Date(b.block_date).toLocaleDateString("en-GB", { month: "short" })}
                  </span>
                  <span className="text-lg font-bold leading-none">{new Date(b.block_date).getDate()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{b.reason ?? "Blocked"}</p>
                  <p className="text-xs text-text-secondary">
                    {b.start_time ? `${b.start_time} – ${b.end_time}` : "All day"}
                  </p>
                </div>
                <button onClick={() => removeBlock(b.id)} className="text-xs text-red-400 font-medium flex-shrink-0">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add block form */}
      {showBlockForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-20">
          <div className="w-full max-w-sm bg-[#141414] border border-border rounded-t-2xl px-5 pt-4 pb-6 space-y-4">
            <div className="flex justify-center"><div className="w-10 h-1 rounded-full bg-border" /></div>
            <p className="font-semibold">Block a Date</p>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">Date</label>
              <input type="date" min={minDateStr} value={blockDate} onChange={(e) => setBlockDate(e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">Reason (optional)</label>
              <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)}
                placeholder="e.g. Maintenance, Private event"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => setBlockAllDay(!blockAllDay)}
                className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${blockAllDay ? "bg-accent" : "bg-surface"}`}>
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${blockAllDay ? "left-5" : "left-1"}`} />
              </button>
              <span className="text-sm">All day</span>
            </div>

            {!blockAllDay && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-xs text-text-secondary mb-1.5">Start</p>
                  <TimeSelect value={blockStart} onChange={setBlockStart} options={TIME_OPTIONS} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-text-secondary mb-1.5">End</p>
                  <TimeSelect value={blockEnd} onChange={setBlockEnd} options={TIME_OPTIONS} />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowBlockForm(false); setBlockDate(""); setBlockReason(""); }}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">
                Cancel
              </button>
              <button onClick={addBlock} disabled={!blockDate || blockSaving}
                className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-50">
                {blockSaving ? "Saving…" : "Add Block"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
