"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────
type DaySchedule = { day_of_week: number; open_time: string; close_time: string; is_active: boolean };
type Block = { id: string; block_date: string; start_time: string | null; end_time: string | null; reason: string | null };
type PricingRule = { id: string; name: string; days: number[]; start_time: string; end_time: string; price: number };
type SettingsTab = "info" | "schedule" | "pricing" | "holidays";

const FORMAT_OPTIONS = ["5-a-side", "7-a-side", "11-a-side"];
const SURFACE_OPTIONS = ["Natural Grass", "Artificial Grass (3G)", "Artificial Grass (4G)", "Indoor", "Concrete"];
const AMENITY_OPTIONS = ["Changing Rooms", "Showers", "Parking", "Floodlights", "Café / Canteen", "CCTV", "First Aid"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toggle(arr: string[], val: string) {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}
function toggleNum(arr: number[], val: number) {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

// ── Info Tab ──────────────────────────────────────────────────
function InfoTab({ form, setForm, saving, onSave, error, saved }: {
  form: {
    name: string; address: string; lat: string; lng: string;
    price_per_hour: string; capacity: string; contact_email: string; description: string;
    formats: string[]; surfaces: string[]; amenities: string[];
  };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  saving: boolean; saved: boolean; onSave: () => void; error: string | null;
}) {
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5 pb-8">
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Venue Details</p>
        {([
          { label: "Venue Name", key: "name", placeholder: "e.g. Hackney Marshes 5-a-side" },
          { label: "Address", key: "address", placeholder: "Full address" },
          { label: "Contact Email", key: "contact_email", placeholder: "bookings@mypitch.co.uk" },
        ] as { label: string; key: keyof typeof form & string; placeholder: string }[]).map(({ label, key, placeholder }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">{label}</label>
            <input value={form[key] as string} onChange={(e) => set(key, e.target.value)}
              placeholder={placeholder}
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Description</label>
          <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)}
            placeholder="Tell teams what makes your pitch great…"
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary resize-none" />
        </div>
      </div>

      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Map Location</p>
        <div className="grid grid-cols-2 gap-3">
          {(["lat", "lng"] as const).map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">{k === "lat" ? "Latitude" : "Longitude"}</label>
              <input value={form[k]} onChange={(e) => set(k, e.target.value)}
                placeholder={k === "lat" ? "51.5432" : "-0.0432"}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Capacity</p>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Max Players</label>
          <input type="number" value={form.capacity} onChange={(e) => set("capacity", e.target.value)}
            placeholder="22"
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
        </div>
      </div>

      {[
        { label: "Match Formats", key: "formats" as const, options: FORMAT_OPTIONS },
        { label: "Surfaces", key: "surfaces" as const, options: SURFACE_OPTIONS },
        { label: "Amenities", key: "amenities" as const, options: AMENITY_OPTIONS },
      ].map(({ label, key, options }) => (
        <div key={key} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{label}</p>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <button key={o}
                onClick={() => setForm((f) => ({ ...f, [key]: toggle(f[key] as string[], o) }))}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${(form[key] as string[]).includes(o) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <button onClick={onSave} disabled={saving}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
        {saved ? "✓ Changes Saved!" : saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
}

// ── Schedule Tab ──────────────────────────────────────────────
function ScheduleTab({ pitchId }: { pitchId: string }) {
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);

  useEffect(() => {
    supabase.from("pitch_availability").select("*").eq("pitch_id", pitchId).order("day_of_week")
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSchedule(data as DaySchedule[]);
        } else {
          setSchedule(Array.from({ length: 7 }, (_, i) => ({
            day_of_week: i, open_time: "09:00", close_time: "22:00", is_active: i > 0 && i < 6,
          })));
        }
        setLoading(false);
      });
  }, [pitchId]);

  const updateDay = (dow: number, field: keyof DaySchedule, value: string | boolean) => {
    setSchedule((prev) => prev.map((d) => d.day_of_week === dow ? { ...d, [field]: value } : d));
  };

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("pitch_availability").upsert(
      schedule.map((d) => ({ pitch_id: pitchId, ...d })),
      { onConflict: "pitch_id,day_of_week" }
    );
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  const editing = schedule.find((d) => d.day_of_week === editingDay);

  return (
    <div className="space-y-3 pb-8">
      <p className="text-xs text-text-secondary">Set opening hours for each day. Toggle off to mark as closed.</p>
      {schedule.map((d) => (
        <div key={d.day_of_week}
          className={`bg-surface-2 border rounded-2xl px-4 py-3 flex items-center gap-3 transition-colors ${d.is_active ? "border-border" : "border-border/40 opacity-60"}`}>
          <button onClick={() => updateDay(d.day_of_week, "is_active", !d.is_active)}
            className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${d.is_active ? "bg-accent" : "bg-surface"}`}>
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${d.is_active ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <p className="text-sm font-semibold flex-1">{DAY_NAMES[d.day_of_week]}</p>
          {d.is_active ? (
            <button onClick={() => setEditingDay(d.day_of_week)} className="text-xs text-accent font-medium">
              {d.open_time} – {d.close_time}
            </button>
          ) : (
            <span className="text-xs text-text-secondary">Closed</span>
          )}
        </div>
      ))}

      <button onClick={handleSave} disabled={saving}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 mt-2">
        {saved ? "✓ Saved!" : saving ? "Saving…" : "Save Schedule"}
      </button>

      {editingDay !== null && editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-4"
          onClick={() => setEditingDay(null)}>
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl px-5 pb-6 pt-4"
            onClick={(e) => e.stopPropagation()}>
            <p className="font-bold mb-4">{DAY_NAMES[editingDay]} Hours</p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {(["open_time", "close_time"] as const).map((k) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">{k === "open_time" ? "Opens" : "Closes"}</label>
                  <input type="time" value={editing[k]}
                    onChange={(e) => updateDay(editingDay, k, e.target.value)}
                    className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none [color-scheme:dark]" />
                </div>
              ))}
            </div>
            <button onClick={() => setEditingDay(null)}
              className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pricing Tab ───────────────────────────────────────────────
function PricingTab({ pitchId, basePrice, onBasePriceChange }: {
  pitchId: string; basePrice: string; onBasePriceChange: (v: string) => void;
}) {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newRule, setNewRule] = useState<Omit<PricingRule, "id">>({
    name: "", days: [], start_time: "18:00", end_time: "22:00", price: 0,
  });

  useEffect(() => {
    supabase.from("pitches").select("pricing_rules").eq("id", pitchId).maybeSingle()
      .then(({ data }) => {
        if (data?.pricing_rules) setRules(data.pricing_rules as PricingRule[]);
        setLoading(false);
      });
  }, [pitchId]);

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("pitches").update({
      price_per_hour: parseFloat(basePrice) || 0,
      pricing_rules: rules,
    }).eq("id", pitchId);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const addRule = () => {
    if (!newRule.name || newRule.days.length === 0 || newRule.price <= 0) return;
    setRules((prev) => [...prev, { ...newRule, id: crypto.randomUUID() }]);
    setNewRule({ name: "", days: [], start_time: "18:00", end_time: "22:00", price: 0 });
    setShowAdd(false);
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  return (
    <div className="space-y-5 pb-8">
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Base Price</p>
        <p className="text-xs text-text-secondary">Default rate. Rules below override this for specific times.</p>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-text-secondary">£</span>
          <input type="number" value={basePrice} onChange={(e) => onBasePriceChange(e.target.value)}
            placeholder="80"
            className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          <span className="text-sm text-text-secondary">/ hr</span>
        </div>
      </div>

      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Pricing Rules</p>
          <button onClick={() => setShowAdd(true)} className="text-xs text-accent font-semibold flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add rule
          </button>
        </div>
        <p className="text-xs text-text-secondary">Set different rates for peak hours, weekends, or specific slots.</p>

        {rules.length === 0 ? (
          <p className="text-xs text-text-secondary italic py-2">No rules yet — base price applies all the time.</p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{rule.name}</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {rule.days.map((d) => DAY_SHORT[d]).join(", ")} · {rule.start_time}–{rule.end_time}
                  </p>
                </div>
                <span className="text-sm font-bold text-accent flex-shrink-0">£{rule.price}/hr</span>
                <button onClick={() => setRules((prev) => prev.filter((r) => r.id !== rule.id))}
                  className="text-xs text-red-400 flex-shrink-0 ml-1">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={handleSave} disabled={saving}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
        {saved ? "✓ Saved!" : saving ? "Saving…" : "Save Pricing"}
      </button>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl px-5 pb-6 pt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold">New Pricing Rule</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Rule Name</label>
              <input value={newRule.name} onChange={(e) => setNewRule((r) => ({ ...r, name: e.target.value }))}
                placeholder="e.g. Peak Evenings, Weekend Rate" autoFocus
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Applies on</label>
              <div className="flex gap-2">
                {DAY_SHORT.map((d, i) => (
                  <button key={i} onClick={() => setNewRule((r) => ({ ...r, days: toggleNum(r.days, i) }))}
                    className={`flex-1 h-9 rounded-full text-xs font-bold border transition-colors ${newRule.days.includes(i) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["start_time", "end_time"] as const).map((k) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium">{k === "start_time" ? "From" : "Until"}</label>
                  <input type="time" value={newRule[k]}
                    onChange={(e) => setNewRule((r) => ({ ...r, [k]: e.target.value }))}
                    className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none [color-scheme:dark]" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Price per hour (£)</label>
              <input type="number" value={newRule.price || ""}
                onChange={(e) => setNewRule((r) => ({ ...r, price: parseFloat(e.target.value) || 0 }))}
                placeholder="120"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)}
                className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
              <button onClick={addRule} disabled={!newRule.name || newRule.days.length === 0 || newRule.price <= 0}
                className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40">
                Add Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Holidays Tab ──────────────────────────────────────────────
function HolidaysTab({ pitchId }: { pitchId: string }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newBlock, setNewBlock] = useState({
    block_date: "", start_time: "", end_time: "", reason: "", whole_day: true,
  });

  useEffect(() => {
    supabase.from("pitch_blocks").select("*").eq("pitch_id", pitchId)
      .order("block_date", { ascending: true })
      .then(({ data }) => { setBlocks((data ?? []) as Block[]); setLoading(false); });
  }, [pitchId]);

  const handleAdd = async () => {
    if (!newBlock.block_date) return;
    const { data } = await supabase.from("pitch_blocks").insert({
      pitch_id: pitchId,
      block_date: newBlock.block_date,
      start_time: newBlock.whole_day ? null : (newBlock.start_time || null),
      end_time: newBlock.whole_day ? null : (newBlock.end_time || null),
      reason: newBlock.reason || null,
    }).select().single();
    if (data) {
      setBlocks((prev) => [...prev, data as Block].sort((a, b) => a.block_date.localeCompare(b.block_date)));
      setNewBlock({ block_date: "", start_time: "", end_time: "", reason: "", whole_day: true });
      setShowAdd(false);
    }
  };

  const handleRemove = async (id: string) => {
    await supabase.from("pitch_blocks").delete().eq("id", id);
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-text-secondary">Block specific dates for maintenance, holidays, or private events.</p>
        <button onClick={() => setShowAdd(true)}
          className="flex-shrink-0 flex items-center gap-1 text-xs text-accent font-semibold">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add
        </button>
      </div>

      {blocks.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-8 text-center">
          <p className="text-sm text-text-secondary">No blocked dates</p>
          <p className="text-xs text-text-secondary mt-1">Closures you add here will hide slots from players.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map((b) => (
            <div key={b.id} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{b.block_date}</p>
                <p className="text-xs text-text-secondary">
                  {b.start_time ? `${b.start_time}–${b.end_time ?? ""}` : "All day"}
                  {b.reason ? ` · ${b.reason}` : ""}
                </p>
              </div>
              <button onClick={() => handleRemove(b.id)} className="text-xs text-red-400 flex-shrink-0">Remove</button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl px-5 pb-6 pt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold">Block a Date</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Date</label>
              <input type="date" value={newBlock.block_date}
                onChange={(e) => setNewBlock((b) => ({ ...b, block_date: e.target.value }))}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none [color-scheme:dark]" />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setNewBlock((b) => ({ ...b, whole_day: !b.whole_day }))}
                className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${newBlock.whole_day ? "bg-accent" : "bg-surface"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${newBlock.whole_day ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
              <span className="text-sm font-medium">Whole day closure</span>
            </div>
            {!newBlock.whole_day && (
              <div className="grid grid-cols-2 gap-3">
                {(["start_time", "end_time"] as const).map((k) => (
                  <div key={k} className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium">{k === "start_time" ? "From" : "Until"}</label>
                    <input type="time" value={newBlock[k]}
                      onChange={(e) => setNewBlock((b) => ({ ...b, [k]: e.target.value }))}
                      className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none [color-scheme:dark]" />
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Reason <span className="text-text-secondary font-normal">(optional)</span></label>
              <input value={newBlock.reason} onChange={(e) => setNewBlock((b) => ({ ...b, reason: e.target.value }))}
                placeholder="e.g. Maintenance, Bank Holiday"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)}
                className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
              <button onClick={handleAdd} disabled={!newBlock.block_date}
                className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40">Block Date</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function VenueSettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("info");
  const [form, setForm] = useState({
    name: "", address: "", lat: "", lng: "",
    price_per_hour: "", capacity: "", contact_email: "", description: "",
    formats: [] as string[], surfaces: [] as string[], amenities: [] as string[],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("pitches").select("*").eq("venue_owner_id", user.id).maybeSingle()
      .then(({ data: p }) => {
        if (p) {
          setPitchId(p.id);
          setForm({
            name: p.name ?? "", address: p.address ?? "",
            lat: String(p.lat ?? ""), lng: String(p.lng ?? ""),
            price_per_hour: String(p.price_per_hour ?? ""),
            capacity: String(p.capacity ?? ""),
            contact_email: p.contact_email ?? "",
            description: p.description ?? "",
            formats: p.formats ?? [], surfaces: p.surfaces ?? [], amenities: p.amenities ?? [],
          });
        }
        setLoading(false);
      });
  }, [user]);

  const handleSaveInfo = async () => {
    if (!pitchId) return;
    if (!form.name || !form.address) { setError("Name and address are required."); return; }
    setSaving(true); setError(null);
    const { error: dbErr } = await supabase.from("pitches").update({
      name: form.name, address: form.address,
      lat: parseFloat(form.lat) || null, lng: parseFloat(form.lng) || null,
      capacity: form.capacity ? parseInt(form.capacity) : null,
      contact_email: form.contact_email, description: form.description || null,
      formats: form.formats, surfaces: form.surfaces, amenities: form.amenities,
    }).eq("id", pitchId);
    setSaving(false);
    if (dbErr) { setError("Failed to save."); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );

  if (!pitchId) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">No pitch registered</p>
      <a href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register Your Pitch</a>
    </div>
  );

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: "info", label: "Info" },
    { key: "schedule", label: "Schedule" },
    { key: "pricing", label: "Pricing" },
    { key: "holidays", label: "Holidays" },
  ];

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-xs text-text-secondary mt-0.5">Manage your pitch details, hours, and pricing.</p>
      </div>

      <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-0.5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${activeTab === t.key ? "bg-accent text-black" : "text-text-secondary"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "info" && (
        <InfoTab form={form} setForm={setForm} saving={saving} saved={saved} onSave={handleSaveInfo} error={error} />
      )}
      {activeTab === "schedule" && <ScheduleTab pitchId={pitchId} />}
      {activeTab === "pricing" && (
        <PricingTab pitchId={pitchId} basePrice={form.price_per_hour}
          onBasePriceChange={(v) => setForm((f) => ({ ...f, price_per_hour: v }))} />
      )}
      {activeTab === "holidays" && <HolidaysTab pitchId={pitchId} />}

      <button onClick={async () => { await signOut(); router.push("/"); }}
        className="w-full py-3 rounded-xl border border-border text-text-secondary font-semibold text-sm flex items-center justify-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Sign Out
      </button>
    </div>
  );
}
