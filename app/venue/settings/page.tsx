"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────
type DaySchedule = { day_of_week: number; open_time: string; close_time: string; is_active: boolean };
type Block = { id: string; block_date: string; start_time: string | null; end_time: string | null; reason: string | null };
type PricingRule = { id: string; name: string; days: number[]; start_time: string; end_time: string; price: number };
type SettingsTab = "info" | "pitches" | "schedule" | "pricing" | "holidays" | "payouts";
type PitchItem = { id: string; name: string; price_per_hour: number; formats: string[]; surfaces: string[]; capacity: number | null };

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

// ── Pitch Selector ────────────────────────────────────────────
function PitchSelector({ pitches, selectedId, onChange }: {
  pitches: PitchItem[]; selectedId: string; onChange: (id: string) => void;
}) {
  if (pitches.length <= 1) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {pitches.map((p) => (
        <button key={p.id} onClick={() => onChange(p.id)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${selectedId === p.id ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

// ── Info Tab ──────────────────────────────────────────────────
function InfoTab({ form, setForm, saving, onSave, error, saved }: {
  form: {
    name: string; address: string;
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
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Amenities</p>
        <div className="flex flex-wrap gap-2">
          {AMENITY_OPTIONS.map((o) => (
            <button key={o}
              onClick={() => setForm((f) => ({ ...f, amenities: toggle(f.amenities, o) }))}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${form.amenities.includes(o) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
              {o}
            </button>
          ))}
        </div>
      </div>

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

// ── Pitches Tab ───────────────────────────────────────────────
function PitchEditForm({ form, setForm, label, saving, onSave, onCancel }: {
  form: { name: string; price: string; capacity: string; formats: string[]; surfaces: string[] };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  label: string; saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Pitch Name</label>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Pitch A – 5-a-side" autoFocus
          className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Price / hr (£)</label>
          <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            placeholder="80"
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Max players</label>
          <input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
            placeholder="22"
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Match Formats</label>
        <div className="flex flex-wrap gap-2">
          {FORMAT_OPTIONS.map((o) => (
            <button key={o} onClick={() => setForm((f) => ({ ...f, formats: toggle(f.formats, o) }))}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${form.formats.includes(o) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
              {o}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Surface</label>
        <div className="flex flex-wrap gap-2">
          {SURFACE_OPTIONS.map((o) => (
            <button key={o} onClick={() => setForm((f) => ({ ...f, surfaces: toggle(f.surfaces, o) }))}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${form.surfaces.includes(o) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
              {o}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
        <button onClick={onSave} disabled={saving || !form.name.trim()}
          className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40">
          {saving ? "Saving…" : label}
        </button>
      </div>
    </div>
  );
}

function PitchesTab({ pitches, venueOwnerId, primaryPitchAddress, primaryPitchContact, onPitchesChange }: {
  pitches: PitchItem[];
  venueOwnerId: string;
  primaryPitchAddress: string;
  primaryPitchContact: string;
  onPitchesChange: (pitches: PitchItem[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", price: "", capacity: "", formats: [] as string[], surfaces: [] as string[] });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", price: "", capacity: "", formats: [] as string[], surfaces: [] as string[] });
  const [editSaving, setEditSaving] = useState(false);

  const handleAdd = async () => {
    if (!addForm.name.trim()) { setAddError("Pitch name is required."); return; }
    setAddSaving(true); setAddError(null);
    const { data, error: dbErr } = await supabase.from("pitches").insert({
      venue_owner_id: venueOwnerId,
      name: addForm.name.trim(),
      address: primaryPitchAddress || "—",
      contact_email: primaryPitchContact,
      price_per_hour: parseFloat(addForm.price) || 0,
      capacity: addForm.capacity ? parseInt(addForm.capacity) : null,
      formats: addForm.formats,
      surfaces: addForm.surfaces,
    }).select("id, name, price_per_hour, formats, surfaces, capacity").single();
    setAddSaving(false);
    if (dbErr || !data) { setAddError("Failed to add pitch. Please try again."); return; }
    onPitchesChange([...pitches, data as PitchItem]);
    setAddForm({ name: "", price: "", capacity: "", formats: [], surfaces: [] });
    setShowAdd(false);
  };

  const startEdit = (p: PitchItem) => {
    setEditingId(p.id);
    setEditForm({ name: p.name, price: String(p.price_per_hour), capacity: String(p.capacity ?? ""), formats: p.formats, surfaces: p.surfaces });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    await supabase.from("pitches").update({
      name: editForm.name.trim(),
      price_per_hour: parseFloat(editForm.price) || 0,
      capacity: editForm.capacity ? parseInt(editForm.capacity) : null,
      formats: editForm.formats,
      surfaces: editForm.surfaces,
    }).eq("id", editingId);
    setEditSaving(false);
    onPitchesChange(pitches.map((p) => p.id === editingId ? {
      ...p,
      name: editForm.name.trim(),
      price_per_hour: parseFloat(editForm.price) || 0,
      capacity: editForm.capacity ? parseInt(editForm.capacity) : null,
      formats: editForm.formats,
      surfaces: editForm.surfaces,
    } : p));
    setEditingId(null);
  };

  const handleRemove = async (id: string) => {
    if (pitches.length <= 1) return;
    await supabase.from("pitches").delete().eq("id", id);
    onPitchesChange(pitches.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">Manage individual pitches at your venue. Each pitch can have its own size, surface, and pricing.</p>
        <button onClick={() => { setShowAdd(true); setAddError(null); }}
          className="flex-shrink-0 flex items-center gap-1 text-xs text-accent font-semibold ml-3">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add
        </button>
      </div>

      <div className="space-y-3">
        {pitches.map((p, i) => (
          <div key={p.id} className="bg-surface-2 border border-border rounded-2xl p-4">
            {editingId === p.id ? (
              <PitchEditForm
                form={editForm} setForm={setEditForm}
                label="Save Changes" saving={editSaving}
                onSave={handleSaveEdit} onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{p.name}</p>
                    {i === 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent flex-shrink-0">Primary</span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    £{p.price_per_hour}/hr{p.capacity ? ` · ${p.capacity} players max` : ""}
                    {p.formats.length > 0 ? ` · ${p.formats.join(", ")}` : ""}
                  </p>
                  {p.surfaces.length > 0 && (
                    <p className="text-xs text-text-secondary">{p.surfaces.join(", ")}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button onClick={() => startEdit(p)} className="text-xs text-accent font-medium">Edit</button>
                  {pitches.length > 1 && (
                    <button onClick={() => handleRemove(p.id)} className="text-xs text-red-400 font-medium">Remove</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add pitch modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl px-5 pb-6 pt-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold mb-4">Add Pitch</p>
            {addError && <p className="text-xs text-red-400 mb-3">{addError}</p>}
            <PitchEditForm
              form={addForm} setForm={setAddForm}
              label="Add Pitch" saving={addSaving}
              onSave={handleAdd} onCancel={() => { setShowAdd(false); setAddError(null); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schedule Tab ──────────────────────────────────────────────
function ScheduleTab({ pitches, pitchId, onPitchChange }: { pitches: PitchItem[]; pitchId: string; onPitchChange: (id: string) => void }) {
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
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
      <PitchSelector pitches={pitches} selectedId={pitchId} onChange={onPitchChange} />
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
function PricingTab({ pitches, pitchId, basePrice, onBasePriceChange, onPitchChange }: {
  pitches: PitchItem[]; pitchId: string; basePrice: string; onBasePriceChange: (v: string) => void; onPitchChange: (id: string) => void;
}) {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newRule, setNewRule] = useState<Omit<PricingRule, "id">>({
    name: "", days: [], start_time: "18:00", end_time: "22:00", price: 0,
  });

  // Load pricing for the selected pitch
  const selectedPitch = pitches.find((p) => p.id === pitchId);
  const [localBasePrice, setLocalBasePrice] = useState(String(selectedPitch?.price_per_hour ?? ""));

  useEffect(() => {
    setLoading(true);
    const p = pitches.find((x) => x.id === pitchId);
    setLocalBasePrice(String(p?.price_per_hour ?? ""));
    supabase.from("pitches").select("pricing_rules").eq("id", pitchId).maybeSingle()
      .then(({ data }) => {
        if (data?.pricing_rules) setRules(data.pricing_rules as PricingRule[]);
        else setRules([]);
        setLoading(false);
      });
  }, [pitchId, pitches]);

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("pitches").update({
      price_per_hour: parseFloat(localBasePrice) || 0,
      pricing_rules: rules,
    }).eq("id", pitchId);
    onBasePriceChange(localBasePrice);
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
      <PitchSelector pitches={pitches} selectedId={pitchId} onChange={onPitchChange} />

      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Base Price</p>
        <p className="text-xs text-text-secondary">Default rate. Rules below override this for specific times.</p>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-text-secondary">£</span>
          <input type="number" value={localBasePrice} onChange={(e) => setLocalBasePrice(e.target.value)}
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
function HolidaysTab({ pitches, pitchId, onPitchChange }: { pitches: PitchItem[]; pitchId: string; onPitchChange: (id: string) => void }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBlock, setNewBlock] = useState({
    block_date: "", start_time: "", end_time: "", reason: "", whole_day: true,
  });

  useEffect(() => {
    setLoading(true);
    supabase.from("pitches").select("blocked_dates").eq("id", pitchId).maybeSingle()
      .then(({ data }) => {
        const raw = (data as { blocked_dates?: Block[] } | null)?.blocked_dates ?? [];
        setBlocks([...raw].sort((a, b) => a.block_date.localeCompare(b.block_date)));
        setLoading(false);
      });
  }, [pitchId]);

  const persist = async (updated: Block[]) => {
    const { error: dbErr } = await supabase.from("pitches")
      .update({ blocked_dates: updated })
      .eq("id", pitchId);
    return dbErr;
  };

  const handleAdd = async () => {
    if (!newBlock.block_date) return;
    setSaving(true);
    setError(null);
    const entry: Block = {
      id: crypto.randomUUID(),
      block_date: newBlock.block_date,
      start_time: newBlock.whole_day ? null : (newBlock.start_time || null),
      end_time: newBlock.whole_day ? null : (newBlock.end_time || null),
      reason: newBlock.reason || null,
    };
    const updated = [...blocks, entry].sort((a, b) => a.block_date.localeCompare(b.block_date));
    const dbErr = await persist(updated);
    setSaving(false);
    if (dbErr) { setError("Failed to block date. Please try again."); return; }
    setBlocks(updated);
    setNewBlock({ block_date: "", start_time: "", end_time: "", reason: "", whole_day: true });
    setShowAdd(false);
  };

  const handleRemove = async (id: string) => {
    const updated = blocks.filter((b) => b.id !== id);
    await persist(updated);
    setBlocks(updated);
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  return (
    <div className="space-y-4 pb-8">
      <PitchSelector pitches={pitches} selectedId={pitchId} onChange={onPitchChange} />

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-text-secondary">Block specific dates for maintenance, holidays, or private events.</p>
        <button onClick={() => { setShowAdd(true); setError(null); }}
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
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-border" /></div>
            <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4">
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
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2 pb-2">
                <button onClick={() => setShowAdd(false)}
                  className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
                <button onClick={handleAdd} disabled={!newBlock.block_date || saving}
                  className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40">
                  {saving ? "Saving…" : "Block Date"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payouts Tab ───────────────────────────────────────────────
// One Stripe payout account per VENUE (not per pitch) — connecting it here
// covers every pitch at the venue. Payout history lives in Reports.
function PayoutsTab({ pitches }: { pitches: PitchItem[] }) {
  const primaryId = pitches[0]?.id;
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [payoutsEnabled, setPayoutsEnabled] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!primaryId) return;
    let cancelled = false;
    async function load() {
      // DB first (instant), then Stripe for the live capability check.
      const { data: p } = await supabase.from("pitches")
        .select("stripe_account_id, payouts_enabled").eq("id", primaryId).maybeSingle();
      if (!cancelled && p) {
        setConnected(!!p.stripe_account_id);
        setPayoutsEnabled(!!p.payouts_enabled);
        setAccountId(p.stripe_account_id ?? null);
      }
      try {
        const res = await fetch("/api/connect/account-status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pitchId: primaryId }),
        });
        const d = await res.json();
        if (!cancelled && res.ok) {
          setConnected(!!d.connected);
          setPayoutsEnabled(!!d.payoutsEnabled);
          if (d.accountId) setAccountId(d.accountId);
        }
      } catch { /* offline — DB snapshot already shown */ }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [primaryId]);

  const handleConnect = async () => {
    if (!primaryId) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/connect/create-venue-account", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitchId: primaryId }),
      });
      const d = await res.json();
      if (!res.ok || !d.onboardingUrl) {
        setError(d.error ?? "Could not start onboarding.");
        setConnecting(false);
        return;
      }
      window.location.href = d.onboardingUrl;
    } catch {
      setError("Could not reach the payment service.");
      setConnecting(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Checking payout status…</div>;

  return (
    <div className="space-y-4 pb-8">
      <div className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold">Payout account</p>
          {payoutsEnabled ? (
            <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">Payouts enabled</span>
          ) : connected ? (
            <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">Onboarding incomplete</span>
          ) : (
            <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">Not connected</span>
          )}
        </div>
        <p className="text-xs text-text-secondary mb-4">
          When a booking is paid on any of your pitches, Unitr transfers the pitch fee to this
          account. One account covers your whole venue{pitches.length > 1 ? ` — all ${pitches.length} pitches pay out here` : ""}.
          Test mode — no real money moves.
        </p>

        {accountId && (
          <div className="bg-background border border-border rounded-xl px-3 py-2.5 mb-4">
            <p className="text-[10px] text-text-secondary uppercase tracking-wider font-semibold mb-0.5">Stripe account</p>
            <p className="text-xs font-mono">{accountId}</p>
          </div>
        )}

        {payoutsEnabled ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            Ready to receive payouts. See payout history in Reports.
          </div>
        ) : (
          <button onClick={handleConnect} disabled={connecting}
            className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
            {connecting ? "Starting…" : connected ? "Resume Onboarding" : "Connect Payout Account"}
          </button>
        )}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>

      {pitches.length > 1 && (
        <div className="bg-surface-2 border border-border rounded-2xl p-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Covered pitches</p>
          <div className="space-y-1.5">
            {pitches.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-text-secondary">£{p.price_per_hour}/hr</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-secondary mt-3">
            Revenue is still tracked per pitch — see the breakdown in Reports.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function VenueSettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [allPitches, setAllPitches] = useState<PitchItem[]>([]);
  const [selectedPitchId, setSelectedPitchId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("info");

  // Returning from Stripe onboarding (?connect=done|refresh) → land on Payouts.
  useEffect(() => {
    const connect = new URLSearchParams(window.location.search).get("connect");
    if (connect) setActiveTab("payouts");
  }, []);
  const [form, setForm] = useState({
    name: "", address: "",
    price_per_hour: "", capacity: "", contact_email: "", description: "",
    formats: [] as string[], surfaces: [] as string[], amenities: [] as string[],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("pitches").select("*").eq("venue_owner_id", user.id).order("created_at", { ascending: true })
      .then(({ data: ps }) => {
        if (ps && ps.length > 0) {
          const primary = ps[0];
          setAllPitches(ps.map((p) => ({
            id: p.id, name: p.name ?? "", price_per_hour: p.price_per_hour ?? 0,
            formats: p.formats ?? [], surfaces: p.surfaces ?? [], capacity: p.capacity ?? null,
          })));
          setSelectedPitchId(primary.id);
          setForm({
            name: primary.name ?? "", address: primary.address ?? "",
            price_per_hour: String(primary.price_per_hour ?? ""),
            capacity: String(primary.capacity ?? ""),
            contact_email: primary.contact_email ?? "",
            description: primary.description ?? "",
            formats: primary.formats ?? [], surfaces: primary.surfaces ?? [], amenities: primary.amenities ?? [],
          });
        }
        setLoading(false);
      });
  }, [user]);

  const handleSaveInfo = async () => {
    const primaryId = allPitches[0]?.id;
    if (!primaryId) return;
    if (!form.name || !form.address) { setError("Name and address are required."); return; }
    setSaving(true); setError(null);
    const { error: dbErr } = await supabase.from("pitches").update({
      name: form.name, address: form.address,
      contact_email: form.contact_email, description: form.description || null,
      amenities: form.amenities,
    }).eq("id", primaryId);
    // Propagate address/contact to all other pitches
    if (allPitches.length > 1) {
      await supabase.from("pitches").update({ address: form.address, contact_email: form.contact_email })
        .in("id", allPitches.slice(1).map((p) => p.id));
    }
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

  if (allPitches.length === 0) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">No pitch registered</p>
      <a href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register Your Pitch</a>
    </div>
  );

  const pitchId = selectedPitchId ?? allPitches[0].id;

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: "info", label: "Info" },
    { key: "pitches", label: "Pitches" },
    { key: "schedule", label: "Schedule" },
    { key: "pricing", label: "Pricing" },
    { key: "holidays", label: "Holidays" },
    { key: "payouts", label: "Payouts" },
  ];

  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-xs text-text-secondary mt-0.5">Manage your venue details, pitches, hours, and pricing.</p>
      </div>

      <div className="flex overflow-x-auto bg-surface-2 border border-border rounded-xl p-1 gap-0.5 flex-shrink-0">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${activeTab === t.key ? "bg-accent text-black" : "text-text-secondary"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "info" && (
        <InfoTab form={form} setForm={setForm} saving={saving} saved={saved} onSave={handleSaveInfo} error={error} />
      )}
      {activeTab === "pitches" && user && (
        <PitchesTab
          pitches={allPitches}
          venueOwnerId={user.id}
          primaryPitchAddress={form.address}
          primaryPitchContact={form.contact_email}
          onPitchesChange={setAllPitches}
        />
      )}
      {activeTab === "schedule" && (
        <ScheduleTab pitches={allPitches} pitchId={pitchId} onPitchChange={setSelectedPitchId} />
      )}
      {activeTab === "pricing" && (
        <PricingTab
          pitches={allPitches}
          pitchId={pitchId}
          basePrice={form.price_per_hour}
          onBasePriceChange={(v) => setForm((f) => ({ ...f, price_per_hour: v }))}
          onPitchChange={setSelectedPitchId}
        />
      )}
      {activeTab === "holidays" && (
        <HolidaysTab pitches={allPitches} pitchId={pitchId} onPitchChange={setSelectedPitchId} />
      )}
      {activeTab === "payouts" && (
        <PayoutsTab pitches={allPitches} />
      )}

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
