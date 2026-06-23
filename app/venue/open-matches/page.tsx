"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";

type Pitch = { id: string; name: string; address: string; price_per_hour: number; formats: string[] };

type OpenMatch = {
  id: string;
  pitch_id: string;
  pitch_name: string;
  match_date: string;
  start_time: string;
  end_time: string;
  title: string;
  match_type: string;
  format: string | null;
  skill_level: string;
  price_per_team_pence: number;
  max_teams: number;
  status: string;
  joined: number;
};

function addOneHour(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${String(Math.min((h || 0) + 1, 23)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ── Create Open Match ─────────────────────────────────────────
function CreateOpenMatch({ pitches, onCreated, onClose }: {
  pitches: Pitch[];
  onCreated: (m: OpenMatch) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const firstPitch = pitches[0];
  const [form, setForm] = useState({
    pitch_id: firstPitch?.id ?? "",
    title: "",
    match_type: "match",
    format: firstPitch?.formats?.[0] ?? "5-a-side",
    skill_level: "Mixed",
    date: "",
    start_time: "",
    end_time: "",
    price_per_team: "",
    max_teams: "2",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const selectedPitch = pitches.find((p) => p.id === form.pitch_id);

  const handleStartTime = (t: string) => {
    setForm((f) => ({ ...f, start_time: t, end_time: f.end_time && f.end_time > t ? f.end_time : addOneHour(t) }));
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.title.trim()) { setError("Give the match a title."); return; }
    if (!form.date) { setError("Pick a date."); return; }
    if (!form.start_time || !form.end_time) { setError("Set the start and end time."); return; }
    if (form.start_time >= form.end_time) { setError("End time must be after start time."); return; }
    const maxTeams = Number(form.max_teams);
    if (!maxTeams || maxTeams < 2) { setError("Allow at least 2 teams."); return; }
    const pricePence = Math.round(Number(form.price_per_team || "0") * 100);
    setSaving(true);
    setError(null);

    // 1) Reserve the slot on the venue calendar via a pitch_bookings row.
    //    booking_type 'open_match' shows it on the calendar and blocks /book.
    const { data: booking, error: bookErr } = await supabase.from("pitch_bookings").insert({
      pitch_id: form.pitch_id,
      booked_by: user.id,
      match_date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      booker_name: `Open match: ${form.title.trim()}`,
      booking_type: "open_match",
      total_price_pence: pricePence * maxTeams,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: 0,
      status: "confirmed",
      payment_status: "after_match",
    }).select("id").single();

    if (bookErr) { setSaving(false); setError(`Couldn't reserve the slot: ${bookErr.message}`); return; }

    // 2) Create the open match listing.
    const { data, error: omErr } = await supabase.from("open_matches").insert({
      pitch_id: form.pitch_id,
      venue_owner_id: user.id,
      pitch_name: selectedPitch?.name ?? "",
      venue_address: selectedPitch?.address ?? "",
      match_date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      title: form.title.trim(),
      match_type: form.match_type,
      format: form.format,
      skill_level: form.skill_level,
      price_per_team_pence: pricePence,
      max_teams: maxTeams,
      description: form.description.trim() || null,
      status: "open",
      booking_id: booking.id,
    }).select("*").single();

    if (omErr) {
      // Roll back the slot reservation so we don't leave an orphan booking
      await supabase.from("pitch_bookings").delete().eq("id", booking.id);
      setSaving(false);
      setError(
        omErr.code === "42P01"
          ? "The open_matches table doesn't exist yet — run supabase_open_matches.sql in Supabase first."
          : `Couldn't create the match: ${omErr.message}`
      );
      return;
    }
    setSaving(false);
    onCreated({ ...(data as OpenMatch), joined: 0 });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="px-5 pt-2 pb-8 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="font-bold">Create Open Match</p>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <p className="text-xs text-text-secondary -mt-2">Block a slot and let teams buy in. It appears in the players&apos; Play feed.</p>

          {/* Type toggle */}
          <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-0.5">
            {(["match", "tournament"] as const).map((t) => (
              <button key={t} onClick={() => set("match_type", t)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${form.match_type === t ? "bg-accent text-black" : "text-text-secondary"}`}>
                {t}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Title</label>
            <input value={form.title} onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Friday Night Friendly" autoFocus
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
              <label className="text-xs font-medium">Price per team (£)</label>
              <input type="number" inputMode="decimal" value={form.price_per_team} onChange={(e) => set("price_per_team", e.target.value)}
                placeholder="e.g. 40"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Teams that can join</label>
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
            {saving ? "Posting…" : "Post Open Match"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function VenueOpenMatchesPage() {
  const { user } = useAuth();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [matches, setMatches] = useState<OpenMatch[]>([]);
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
        .select("*").eq("venue_owner_id", user!.id)
        .order("match_date", { ascending: true });

      const withCounts = await Promise.all((oms ?? []).map(async (m) => {
        const { count } = await supabase.from("open_match_teams")
          .select("id", { count: "exact", head: true }).eq("open_match_id", m.id);
        return { ...(m as OpenMatch), joined: count ?? 0 };
      }));
      setMatches(withCounts);
      setLoading(false);
    }
    load();
  }, [user]);

  const cancelMatch = async (m: OpenMatch) => {
    await supabase.from("open_matches").update({ status: "cancelled" }).eq("id", m.id);
    if (m.id) {
      const { data: full } = await supabase.from("open_matches").select("booking_id").eq("id", m.id).maybeSingle();
      if (full?.booking_id) await supabase.from("pitch_bookings").update({ status: "cancelled" }).eq("id", full.booking_id);
    }
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
    <div className="px-4 pt-5 pb-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Open Matches</h1>
          <p className="text-xs text-text-secondary">Host games teams can buy into — fill empty slots and boost revenue.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-black text-xs font-bold">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Create
        </button>
      </div>

      {matches.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-10 text-center">
          <p className="text-sm font-semibold mb-1">No open matches yet</p>
          <p className="text-xs text-text-secondary mb-4">Block a slot and post a match for teams to join.</p>
          <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 rounded-xl bg-accent text-black font-bold text-sm">Create one</button>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((m) => {
            const cancelled = m.status === "cancelled";
            const full = m.joined >= m.max_teams;
            return (
              <div key={m.id} className={`bg-surface-2 border rounded-2xl p-4 ${cancelled ? "border-border opacity-60" : "border-border"}`}>
                <div className="flex items-start justify-between mb-1.5">
                  <div>
                    <p className="text-sm font-bold">{m.title}</p>
                    <p className="text-xs text-text-secondary">{fmtDate(m.match_date)} · {m.start_time}–{m.end_time} · {m.pitch_name}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    cancelled ? "bg-red-500/10 text-red-400" : full ? "bg-accent/10 text-accent" : "bg-surface text-text-secondary border border-border"
                  }`}>
                    {cancelled ? "Cancelled" : full ? "Full" : "Open"}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-secondary mb-3">
                  <span className="capitalize bg-surface border border-border px-2 py-0.5 rounded-md">{m.match_type}</span>
                  {m.format && <span className="bg-surface border border-border px-2 py-0.5 rounded-md">{m.format}</span>}
                  <span className="bg-surface border border-border px-2 py-0.5 rounded-md">{m.skill_level}</span>
                  <span className="text-accent font-semibold">£{(m.price_per_team_pence / 100).toFixed(0)}/team</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">
                    <span className="font-bold text-text-primary">{m.joined}</span> / {m.max_teams} teams joined
                  </p>
                  {!cancelled && (
                    <button onClick={() => cancelMatch(m)} className="text-xs text-red-400 font-medium">Cancel</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateOpenMatch
          pitches={pitches}
          onCreated={(m) => { setMatches((prev) => [m, ...prev]); setShowCreate(false); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
