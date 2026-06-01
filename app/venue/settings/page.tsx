"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const FORMAT_OPTIONS = ["5-a-side", "7-a-side", "11-a-side"];
const SURFACE_OPTIONS = ["Natural Grass", "Artificial Grass (3G)", "Artificial Grass (4G)", "Indoor", "Concrete"];
const AMENITY_OPTIONS = ["Changing Rooms", "Showers", "Parking", "Floodlights", "Café / Canteen", "CCTV", "First Aid"];

function toggle(arr: string[], val: string) {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

export default function VenueSettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", address: "", lat: "", lng: "",
    price_per_hour: "", capacity: "", contact_email: "", description: "",
    formats: [] as string[], surfaces: [] as string[], amenities: [] as string[],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!user) return;
    supabase.from("pitches").select("*").eq("venue_owner_id", user.id).maybeSingle()
      .then(({ data: p }) => {
        if (p) {
          setPitchId(p.id);
          setForm({
            name: p.name ?? "",
            address: p.address ?? "",
            lat: String(p.lat ?? ""),
            lng: String(p.lng ?? ""),
            price_per_hour: String(p.price_per_hour ?? ""),
            capacity: String(p.capacity ?? ""),
            contact_email: p.contact_email ?? "",
            description: p.description ?? "",
            formats: p.formats ?? [],
            surfaces: p.surfaces ?? [],
            amenities: p.amenities ?? [],
          });
        }
        setLoading(false);
      });
  }, [user]);

  const handleSave = async () => {
    if (!pitchId) return;
    if (!form.name || !form.address || !form.price_per_hour) {
      setError("Name, address and price are required."); return;
    }
    setSaving(true);
    setError(null);
    const { error: dbErr } = await supabase.from("pitches").update({
      name: form.name,
      address: form.address,
      lat: parseFloat(form.lat),
      lng: parseFloat(form.lng),
      price_per_hour: parseFloat(form.price_per_hour),
      capacity: form.capacity ? parseInt(form.capacity) : null,
      contact_email: form.contact_email,
      description: form.description || null,
      formats: form.formats,
      surfaces: form.surfaces,
      amenities: form.amenities,
    }).eq("id", pitchId);
    setSaving(false);
    if (dbErr) { setError("Failed to save. Please try again."); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  if (!pitchId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
        <p className="font-bold text-lg">No pitch registered</p>
        <a href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register Your Pitch</a>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-28 space-y-5">
      <div>
        <h1 className="text-xl font-bold">Pitch Settings</h1>
        <p className="text-xs text-text-secondary mt-0.5">Changes are visible to players immediately.</p>
      </div>

      {/* Venue details */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Venue Details</p>
        {([
          { label: "Venue Name", key: "name" as const, placeholder: "e.g. Hackney Marshes 5-a-side" },
          { label: "Address", key: "address" as const, placeholder: "Full address" },
          { label: "Contact Email", key: "contact_email" as const, placeholder: "bookings@mypitch.co.uk" },
        ] as { label: string; key: "name" | "address" | "contact_email"; placeholder: string }[]).map(({ label, key, placeholder }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">{label}</label>
            <input value={form[key]} onChange={(e) => set(key, e.target.value)}
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

      {/* Coordinates */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Map Location</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Latitude</label>
            <input value={form.lat} onChange={(e) => set("lat", e.target.value)} placeholder="51.5432"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Longitude</label>
            <input value={form.lng} onChange={(e) => set("lng", e.target.value)} placeholder="-0.0432"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Pricing</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Price / Hour (£)</label>
            <input type="number" value={form.price_per_hour} onChange={(e) => set("price_per_hour", e.target.value)}
              placeholder="80"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Max Players</label>
            <input type="number" value={form.capacity} onChange={(e) => set("capacity", e.target.value)}
              placeholder="22"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>
        </div>
      </div>

      {/* Formats */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Match Formats</p>
        <div className="flex flex-wrap gap-2">
          {FORMAT_OPTIONS.map((f) => (
            <button key={f} onClick={() => setForm((prev) => ({ ...prev, formats: toggle(prev.formats, f) }))}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${form.formats.includes(f) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Surfaces */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Surfaces</p>
        <div className="flex flex-wrap gap-2">
          {SURFACE_OPTIONS.map((s) => (
            <button key={s} onClick={() => setForm((prev) => ({ ...prev, surfaces: toggle(prev.surfaces, s) }))}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${form.surfaces.includes(s) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Amenities */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Amenities</p>
        <div className="flex flex-wrap gap-2">
          {AMENITY_OPTIONS.map((a) => (
            <button key={a} onClick={() => setForm((prev) => ({ ...prev, amenities: toggle(prev.amenities, a) }))}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${form.amenities.includes(a) ? "bg-accent/20 text-accent border-accent/40" : "bg-background text-text-secondary border-border"}`}>
              {a}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="fixed bottom-16 left-0 right-0 px-4 pt-3 pb-3 bg-[#0e0e0e] border-t border-border flex flex-col gap-2">
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
          {saved ? "✓ Changes Saved!" : saving ? "Saving…" : "Save Changes"}
        </button>
        <button
          onClick={async () => { await signOut(); router.push("/"); }}
          className="w-full py-3 rounded-xl border border-border text-text-secondary font-semibold text-sm flex items-center justify-center gap-2"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}
