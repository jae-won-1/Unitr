"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

const FORMAT_OPTIONS = ["5-a-side", "7-a-side", "11-a-side"];
const SURFACE_OPTIONS = ["Natural Grass", "Artificial Grass (3G)", "Artificial Grass (4G)", "Indoor", "Concrete"];
const AMENITY_OPTIONS = ["Changing Rooms", "Showers", "Parking", "Floodlights", "Café / Canteen", "CCTV", "First Aid"];

type FormState = {
  name: string;
  address: string;
  price_per_hour: string;
  capacity: string;
  contact_email: string;
  description: string;
  formats: string[];
  surfaces: string[];
  amenities: string[];
};

function toggle(arr: string[], val: string) {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

export default function RegisterPitchPage() {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>({
    name: "", address: "",
    price_per_hour: "", capacity: "",
    contact_email: "", description: "",
    formats: [], surfaces: [], amenities: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name || !form.address || !form.price_per_hour || !form.contact_email) {
      setError("Please fill in all required fields.");
      return;
    }
    if (form.formats.length === 0) { setError("Select at least one format."); return; }

    setSubmitting(true);
    setError(null);

    const { error: dbErr } = await supabase.from("pitches").insert({
      name: form.name,
      address: form.address,
      price_per_hour: parseFloat(form.price_per_hour),
      capacity: form.capacity ? parseInt(form.capacity) : null,
      contact_email: form.contact_email,
      description: form.description || null,
      formats: form.formats,
      surfaces: form.surfaces,
      amenities: form.amenities,
      venue_owner_id: user?.id ?? null,
      is_verified: false,
      rating: 0,
    });

    setSubmitting(false);
    if (dbErr) { setError(dbErr.message || "Failed to submit. Please try again."); return; }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 pb-20">
        <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mb-5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <p className="text-lg font-bold mb-2 text-center">Application Submitted!</p>
        <p className="text-sm text-text-secondary text-center mb-6">
          We&apos;ll review your venue and get in touch at <span className="text-accent-ink">{form.contact_email}</span> within 2 working days.
        </p>
        <a href="/pitches" className="px-6 py-3 rounded-btn bg-accent text-white font-bold text-sm">
          Browse Pitches
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pt-16 pb-28 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/pitches">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </a>
        <div>
          <h1 className="text-xl font-extrabold">Register Your Pitch</h1>
          <p className="text-xs text-text-secondary">List your venue on Unitr — free to join</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Venue Details */}
        <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Venue Details</p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Venue Name <span className="text-red-600">*</span></label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Hackney Marshes 5-a-side"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Address <span className="text-red-600">*</span></label>
            <input value={form.address} onChange={(e) => set("address", e.target.value)}
              placeholder="e.g. Hackney Marshes, London E9 5PF"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Description</label>
            <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)}
              placeholder="Tell teams what makes your pitch great…"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary resize-none" />
          </div>
        </div>

        {/* Pricing */}
        <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Pricing & Capacity</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Price / Hour (£) <span className="text-red-600">*</span></label>
              <input type="number" min="0" value={form.price_per_hour} onChange={(e) => set("price_per_hour", e.target.value)}
                placeholder="80"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Max Players</label>
              <input type="number" min="0" value={form.capacity} onChange={(e) => set("capacity", e.target.value)}
                placeholder="22"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
          </div>
        </div>

        {/* Formats */}
        <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Match Formats <span className="text-red-600">*</span></p>
          <div className="flex flex-wrap gap-2">
            {FORMAT_OPTIONS.map((f) => (
              <button key={f} onClick={() => setForm((prev) => ({ ...prev, formats: toggle(prev.formats, f) }))}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${form.formats.includes(f) ? "bg-accent text-white border-accent" : "bg-background text-text-secondary border-border"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Surfaces */}
        <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Surface Types</p>
          <div className="flex flex-wrap gap-2">
            {SURFACE_OPTIONS.map((s) => (
              <button key={s} onClick={() => setForm((prev) => ({ ...prev, surfaces: toggle(prev.surfaces, s) }))}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${form.surfaces.includes(s) ? "bg-accent text-white border-accent" : "bg-background text-text-secondary border-border"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Amenities */}
        <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Amenities</p>
          <div className="flex flex-wrap gap-2">
            {AMENITY_OPTIONS.map((a) => (
              <button key={a} onClick={() => setForm((prev) => ({ ...prev, amenities: toggle(prev.amenities, a) }))}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${form.amenities.includes(a) ? "bg-accent/20 text-accent-ink border-accent" : "bg-background text-text-secondary border-border"}`}>
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Contact</p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Contact Email <span className="text-red-600">*</span></label>
            <input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)}
              placeholder="bookings@mypitch.co.uk"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>
        </div>

        {/* Info banner */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
          <p className="text-xs text-blue-300 leading-relaxed">
            After submitting, our team reviews your listing within 2 working days. Once verified, your pitch will appear on the map with a ✓ badge.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Submit button */}
      <div className="fixed bottom-16 left-0 right-0 px-4 pt-3 pb-3 bg-surface border-t border-border">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit for Review"}
        </button>
      </div>
    </div>
  );
}
