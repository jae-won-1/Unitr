"use client";

// Admin event creation — the admin books the pitch on the venue's own website,
// then just types the venue in here. One open_matches row, nothing else: no
// pitches row, no pitch_bookings, no credit debit, no venue transfer. Buy-ins
// from joining teams are debited to their credit and stay with the platform
// (the join route's admin branch — see app/api/tournaments/join/route.ts).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const FORMATS = ["5-a-side", "7-a-side", "11-a-side"];
const LEVELS = ["Mixed", "Casual", "Competitive"];

const EVENT_TYPES = [
  { matchType: "tournament", label: "Tournament", desc: "Multi-team event, round-robin fixtures." },
  { matchType: "league", label: "League", desc: "A league round teams can register for." },
  { matchType: "match", label: "Friendly", desc: "One-off game — first two teams to enter play it." },
];

const inputCls = "w-full bg-surface-2 border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent/50";
const labelCls = "block text-xs font-semibold text-text-secondary mb-1.5";

export default function AdminCreateEventPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [matchType, setMatchType] = useState("tournament");
  const [title, setTitle] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [format, setFormat] = useState(FORMATS[0]);
  const [level, setLevel] = useState(LEVELS[0]);
  const [buyIn, setBuyIn] = useState("0");
  const [maxTeams, setMaxTeams] = useState("4");
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFriendly = matchType === "match";
  const effectiveMaxTeams = isFriendly ? 2 : Number(maxTeams);

  const handleCreate = async () => {
    if (!user) return;
    if (!title.trim()) { setError("Give the event a title."); return; }
    if (!venueName.trim()) { setError("Enter the venue name — where you booked the pitch."); return; }
    if (!date || !startTime || !endTime) { setError("Set the date, start and end time."); return; }
    if (startTime >= endTime) { setError("End time must be after start time."); return; }
    if (!effectiveMaxTeams || effectiveMaxTeams < 2) { setError("Allow at least 2 teams."); return; }
    const pricePence = Math.round(Number(buyIn || "0") * 100);
    if (pricePence < 0 || Number.isNaN(pricePence)) { setError("Buy-in can't be negative."); return; }

    setSaving(true);
    setError(null);

    const { data: profile } = await supabase.from("profiles")
      .select("full_name").eq("id", user.id).maybeSingle();

    const { error: omErr } = await supabase.from("open_matches").insert({
      pitch_id: null,
      venue_owner_id: null,
      organiser_admin_id: user.id,
      organiser_admin_name: profile?.full_name ?? "Unitr",
      // pitch_name doubles as the free-text venue name on admin posts.
      pitch_name: venueName.trim(),
      venue_address: venueAddress.trim() || null,
      match_date: date,
      start_time: startTime,
      end_time: endTime,
      title: title.trim(),
      match_type: matchType,
      format,
      skill_level: level,
      price_per_team_pence: pricePence,
      max_teams: effectiveMaxTeams,
      description: description.trim() || null,
      status: "open",
      booking_id: null,
    });

    setSaving(false);
    if (omErr) {
      setError(
        omErr.code === "42703" || omErr.code === "23502"
          ? "Run supabase_admin_hosting.sql in the Supabase SQL editor first."
          : `Couldn't create the event: ${omErr.message}`
      );
      return;
    }
    router.push("/admin");
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Type */}
      <div>
        <label className={labelCls}>Event type</label>
        <div className="grid grid-cols-3 gap-2">
          {EVENT_TYPES.map((t) => (
            <button key={t.matchType} type="button" onClick={() => setMatchType(t.matchType)}
              className={`rounded-xl border p-3 text-left ${
                matchType === t.matchType ? "bg-accent/10 border-accent/40" : "bg-surface-2 border-border"
              }`}>
              <p className={`text-sm font-bold ${matchType === t.matchType ? "text-accent" : ""}`}>{t.label}</p>
              <p className="text-[10px] text-text-secondary mt-0.5 leading-tight">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Title</label>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={isFriendly ? "e.g. Wednesday 5s friendly" : "e.g. Unitr Summer Cup"} />
      </div>

      {/* Venue — free text, booked outside the app */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs text-text-secondary">
          Book the pitch with the venue directly, then tell teams where to show up.
        </p>
        <div>
          <label className={labelCls}>Venue name</label>
          <input className={inputCls} value={venueName} onChange={(e) => setVenueName(e.target.value)}
            placeholder="e.g. PowerLeague Shoreditch" />
        </div>
        <div>
          <label className={labelCls}>Address / maps link (optional)</label>
          <input className={inputCls} value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)}
            placeholder="e.g. 213 Old St, London EC1V 9NR" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <label className={labelCls}>Date</label>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Start</label>
          <input type="time" className={inputCls} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>End</label>
          <input type="time" className={inputCls} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Format</label>
          <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Skill level</label>
          <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Buy-in per team (£)</label>
          <input type="number" min="0" step="0.5" className={inputCls} value={buyIn}
            onChange={(e) => setBuyIn(e.target.value)} placeholder="0 = free entry" />
        </div>
        <div>
          <label className={labelCls}>Max teams</label>
          {isFriendly ? (
            <div className={`${inputCls} text-text-secondary`}>2 — it&rsquo;s a friendly</div>
          ) : (
            <input type="number" min="2" className={inputCls} value={maxTeams}
              onChange={(e) => setMaxTeams(e.target.value)} />
          )}
        </div>
      </div>

      <div>
        <label className={labelCls}>Description (optional)</label>
        <textarea className={`${inputCls} min-h-[80px]`} value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Rules, prizes, what to bring…" />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button onClick={handleCreate} disabled={saving}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
        {saving ? "Posting…" : "Post event"}
      </button>
      <p className="text-[10px] text-text-secondary -mt-2 text-center">
        Buy-ins come out of joining teams&rsquo; credit and stay with Unitr — you&rsquo;ve already paid the venue.
      </p>
    </div>
  );
}
