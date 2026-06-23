"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";
import VenueOpenMatchCard, { VenueOpenMatch } from "@/components/VenueOpenMatchCard";

type Pitch = { id: string; name: string; address: string; price_per_hour: number; formats: string[] };

function addOneHour(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${String(Math.min((h || 0) + 1, 23)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

// ── Create modal (shared by match / tournament / league) ──────
function CreateModal({ pitches, matchType, label, onCreated, onClose }: {
  pitches: Pitch[];
  matchType: string;
  label: string;
  onCreated: (m: VenueOpenMatch) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const firstPitch = pitches[0];
  const [form, setForm] = useState({
    pitch_id: firstPitch?.id ?? "",
    title: "",
    format: firstPitch?.formats?.[0] ?? "5-a-side",
    skill_level: "Mixed",
    date: "",
    start_time: "",
    end_time: "",
    price_per_team: "",
    max_teams: matchType === "league" ? "6" : "2",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const selectedPitch = pitches.find((p) => p.id === form.pitch_id);
  const teamWord = matchType === "league" ? "Teams in the league" : "Teams that can join";

  const handleStartTime = (t: string) => {
    setForm((f) => ({ ...f, start_time: t, end_time: f.end_time && f.end_time > t ? f.end_time : addOneHour(t) }));
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.title.trim()) { setError(`Give the ${label.toLowerCase()} a title.`); return; }
    if (!form.date) { setError("Pick a date."); return; }
    if (!form.start_time || !form.end_time) { setError("Set the start and end time."); return; }
    if (form.start_time >= form.end_time) { setError("End time must be after start time."); return; }
    const maxTeams = Number(form.max_teams);
    if (!maxTeams || maxTeams < 2) { setError("Allow at least 2 teams."); return; }
    const pricePence = Math.round(Number(form.price_per_team || "0") * 100);
    setSaving(true);
    setError(null);

    // Reserve the slot on the venue calendar — keeps the calendar + /book in sync.
    const { data: booking, error: bookErr } = await supabase.from("pitch_bookings").insert({
      pitch_id: form.pitch_id,
      booked_by: user.id,
      match_date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      booker_name: `${label}: ${form.title.trim()}`,
      booking_type: "open_match",
      total_price_pence: pricePence * maxTeams,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: 0,
      status: "confirmed",
      payment_status: "after_match",
    }).select("id").single();

    if (bookErr) { setSaving(false); setError(`Couldn't reserve the slot: ${bookErr.message}`); return; }

    const { data, error: omErr } = await supabase.from("open_matches").insert({
      pitch_id: form.pitch_id,
      venue_owner_id: user.id,
      pitch_name: selectedPitch?.name ?? "",
      venue_address: selectedPitch?.address ?? "",
      match_date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      title: form.title.trim(),
      match_type: matchType,
      format: form.format,
      skill_level: form.skill_level,
      price_per_team_pence: pricePence,
      max_teams: maxTeams,
      description: form.description.trim() || null,
      status: "open",
      booking_id: booking.id,
    }).select("*").single();

    if (omErr) {
      await supabase.from("pitch_bookings").delete().eq("id", booking.id);
      setSaving(false);
      setError(
        omErr.code === "42P01"
          ? "The open_matches table doesn't exist yet — run supabase_open_matches.sql in Supabase first."
          : `Couldn't create the listing: ${omErr.message}`
      );
      return;
    }
    setSaving(false);
    onCreated({ ...(data as VenueOpenMatch), joinedTeams: [] });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="px-5 pt-2 md:pt-5 pb-8 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="font-bold">Create {label}</p>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <p className="text-xs text-text-secondary -mt-2">Block a slot and let teams buy in. It appears in the players&apos; Play feed.</p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Title</label>
            <input value={form.title} onChange={(e) => set("title", e.target.value)}
              placeholder={matchType === "tournament" ? "e.g. Summer 7s Cup" : matchType === "league" ? "e.g. Tuesday Night League" : "e.g. Friday Night Friendly"} autoFocus
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>

          {pitches.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Pitch</label>
              <select value={form.pitch_id} onChange={(e) => set("pitch_id", e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Format</label>
              <select value={form.format} onChange={(e) => set("format", e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                {["5-a-side", "7-a-side", "11-a-side"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Level</label>
              <select value={form.skill_level} onChange={(e) => set("skill_level", e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                {["Mixed", "Casual", "Competitive"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Date</label>
            <DatePicker value={form.date} onChange={(d) => set("date", d)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Start time</label>
              <TimePicker value={form.start_time} onChange={handleStartTime} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">End time</label>
              <TimePicker value={form.end_time} onChange={(t) => set("end_time", t)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">{matchType === "league" ? "Entry fee per team (£)" : "Price per team (£)"}</label>
              <input type="number" inputMode="decimal" value={form.price_per_team} onChange={(e) => set("price_per_team", e.target.value)}
                placeholder="e.g. 40"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">{teamWord}</label>
              <input type="number" inputMode="numeric" min={2} value={form.max_teams} onChange={(e) => set("max_teams", e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Description <span className="text-text-secondary font-normal">(optional)</span></label>
            <input value={form.description} onChange={(e) => set("description", e.target.value)}
              placeholder="Anything teams should know…"
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          </div>

          {form.price_per_team && form.max_teams && (
            <div className="bg-accent/5 border border-accent/20 rounded-xl px-3 py-2.5">
              <p className="text-xs text-text-secondary">Potential revenue if full</p>
              <p className="text-sm font-bold text-accent">£{(Number(form.price_per_team || 0) * Number(form.max_teams || 0)).toFixed(2)}</p>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40">
            {saving ? "Posting…" : `Post ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Listings view ─────────────────────────────────────────────
export default function VenueListingsView({ matchType, title, subtitle, createLabel, emptyText }: {
  matchType: string;
  title: string;
  subtitle: string;
  createLabel: string;
  emptyText: string;
}) {
  const { user } = useAuth();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [matches, setMatches] = useState<VenueOpenMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: ps } = await supabase.from("pitches")
        .select("id, name, address, price_per_hour, formats")
        .eq("venue_owner_id", user!.id).order("name");
      setPitches((ps ?? []) as Pitch[]);

      const { data: oms } = await supabase.from("open_matches")
        .select("*").eq("venue_owner_id", user!.id).eq("match_type", matchType)
        .order("match_date", { ascending: true });

      const withTeams = await Promise.all((oms ?? []).map(async (m) => {
        const { data: teams } = await supabase.from("open_match_teams")
          .select("team_id, team_name").eq("open_match_id", m.id);
        return { ...(m as VenueOpenMatch), joinedTeams: (teams ?? []) as { team_id: string; team_name: string }[] };
      }));
      setMatches(withTeams);
      setLoading(false);
    }
    load();
  }, [user, matchType]);

  const cancelMatch = async (m: VenueOpenMatch) => {
    await supabase.from("open_matches").update({ status: "cancelled" }).eq("id", m.id);
    const { data: full } = await supabase.from("open_matches").select("booking_id").eq("id", m.id).maybeSingle();
    if (full?.booking_id) await supabase.from("pitch_bookings").update({ status: "cancelled" }).eq("id", full.booking_id);
    setMatches((prev) => prev.map((x) => x.id === m.id ? { ...x, status: "cancelled" } : x));
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  if (pitches.length === 0) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">No pitches registered</p>
      <a href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register a Pitch</a>
    </div>
  );

  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-xs text-text-secondary">{subtitle}</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-black text-xs font-bold">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          {createLabel}
        </button>
      </div>

      {matches.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-12 text-center">
          <p className="text-sm font-semibold mb-1">{emptyText}</p>
          <p className="text-xs text-text-secondary mb-4">It will appear here and in the players&apos; Play feed.</p>
          <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 rounded-xl bg-accent text-black font-bold text-sm">{createLabel}</button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {matches.map((m) => <VenueOpenMatchCard key={m.id} match={m} onCancel={cancelMatch} />)}
        </div>
      )}

      {showCreate && (
        <CreateModal
          pitches={pitches}
          matchType={matchType}
          label={createLabel}
          onCreated={(m) => { setMatches((prev) => [m, ...prev]); setShowCreate(false); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
