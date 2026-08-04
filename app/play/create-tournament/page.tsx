"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import BookPitchPanel from "@/components/BookPitchPanel";

// Captain-hosted tournament creation.
//   1. The captain books & pays for a multi-hour pitch block upfront from team
//      credit (min 2 hours) — the cash goes to the venue like a secured booking.
//   2. A tournament listing is posted (open_matches, match_type='tournament',
//      organiser_team_id set) so other teams buy in from the Play feed.
//   3. Each buy-in reimburses THIS team's credit (handled in /api/tournaments/join).
// Constraints: at least 4 teams, at least a 2-hour booking.

type Pitch = {
  id: string;
  name: string;
  address: string;
  price_per_hour: number;
  formats: string[];
  venue_owner_id: string | null;
};

const MIN_TEAMS = 4;
const MIN_HOURS = 2;
const FORMATS = ["5-a-side", "7-a-side", "11-a-side"];
const LEVELS = ["Mixed", "Casual", "Competitive"];

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  return `${String(Math.min((h || 0) + hours, 23)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function CreateTournamentPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [team, setTeam] = useState<{ id: string; name: string; location: string } | null>(null);
  const [creditPence, setCreditPence] = useState<number | null>(null);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [loadingPitches, setLoadingPitches] = useState(true);

  const [title, setTitle] = useState("");
  const [format, setFormat] = useState(FORMATS[0]);
  const [level, setLevel] = useState(LEVELS[0]);
  const [maxTeams, setMaxTeams] = useState("4");
  const [buyIn, setBuyIn] = useState("");
  const [description, setDescription] = useState("");
  const [pitchId, setPitchId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [hours, setHours] = useState(MIN_HOURS);
  const [showPicker, setShowPicker] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the captain's team + credit.
  useEffect(() => {
    if (!user) return;
    supabase.from("teams").select("id, name, location").eq("captain_id", user.id).maybeSingle()
      .then(async ({ data }) => {
        setTeam(data);
        if (data) {
          const { data: credit } = await supabase.from("team_credits")
            .select("balance_pence, reserved_pence").eq("team_id", data.id).maybeSingle();
          setCreditPence(credit ? credit.balance_pence - (credit.reserved_pence ?? 0) : 0);
        }
      });
  }, [user]);

  // Real venue-registered pitches only (same source as the Book tab).
  useEffect(() => {
    supabase.from("pitches").select("id, name, address, price_per_hour, formats, venue_owner_id")
      .not("venue_owner_id", "is", null)
      .order("rating", { ascending: false })
      .then(({ data }) => { setPitches((data ?? []) as Pitch[]); setLoadingPitches(false); });
  }, []);

  const pitch = useMemo(() => pitches.find((p) => p.id === pitchId) ?? null, [pitches, pitchId]);
  const endTime = startTime ? addHours(startTime, hours) : "";

  const pitchFeePence = pitch ? pitch.price_per_hour * 100 * hours : 0;
  const unitrFeePence = Math.round(pitchFeePence * 0.05);
  const totalPence = pitchFeePence + unitrFeePence;
  const creditShort = creditPence !== null && creditPence < totalPence;

  const handleCreate = async () => {
    if (!user || !team) { setError("Only team captains can host a tournament."); return; }
    if (!title.trim()) { setError("Give your tournament a title."); return; }
    if (Number(maxTeams) < MIN_TEAMS) { setError(`A tournament needs at least ${MIN_TEAMS} teams.`); return; }
    if (!buyIn || Number(buyIn) <= 0) { setError("Set a per-team buy-in."); return; }
    if (!pitch) { setError("Choose a pitch."); return; }
    if (!date || !startTime) { setError("Pick a date and start time."); return; }
    if (hours < MIN_HOURS) { setError(`Book the pitch for at least ${MIN_HOURS} hours.`); return; }
    if (creditShort) { setError(`Your team needs £${(totalPence / 100).toFixed(2)} in available credit to book the pitch. Top up in My Team.`); return; }

    setSaving(true);
    setError(null);

    // 1) Availability guard: no existing booking overlaps this block.
    const { data: existing } = await supabase.from("pitch_bookings")
      .select("start_time, end_time").eq("pitch_id", pitch.id).eq("match_date", date).neq("status", "cancelled");
    const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
    const blockStart = toMins(startTime);
    const blockEnd = toMins(endTime);
    const clash = (existing ?? []).some((b) => {
      const s = toMins(b.start_time);
      const e = b.end_time ? toMins(b.end_time) : s + 60;
      return blockStart < e && s < blockEnd;
    });
    if (clash) { setSaving(false); setError("That pitch is already booked during part of this slot. Pick another time or pitch."); return; }

    // 2) Reserve the pitch block on the venue calendar.
    const { data: booking, error: bookErr } = await supabase.from("pitch_bookings").insert({
      pitch_id: pitch.id,
      booked_by: user.id,
      match_date: date,
      start_time: startTime,
      end_time: endTime,
      booker_name: `Tournament: ${title.trim()}`,
      booking_type: "open_match",
      total_price_pence: pitchFeePence,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: unitrFeePence,
      status: "confirmed",
      payment_status: "pending",
    }).select("id").single();
    if (bookErr || !booking) { setSaving(false); setError("Couldn't reserve the pitch. Please try again."); return; }

    // 3) Pay the pitch from team credit (fee + 5%). Roll back the booking on failure.
    const payRes = await fetch("/api/book/pay-credit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: team.id, feePence: totalPence, bookingId: booking.id }),
    }).catch(() => null);
    const payData = payRes ? await payRes.json().catch(() => null) : null;
    if (!payRes || !payRes.ok || !payData?.ok) {
      await supabase.from("pitch_bookings").update({ status: "cancelled", payment_status: "failed" }).eq("id", booking.id);
      setSaving(false);
      setError(payData?.error === "INSUFFICIENT_CREDIT" ? "Not enough team credit. Top up in My Team." : (payData?.error ?? "Couldn't debit team credit."));
      return;
    }

    // 4) Post the tournament listing.
    const { data: om, error: omErr } = await supabase.from("open_matches").insert({
      pitch_id: pitch.id,
      venue_owner_id: pitch.venue_owner_id,
      pitch_name: pitch.name,
      venue_address: pitch.address,
      match_date: date,
      start_time: startTime,
      end_time: endTime,
      title: title.trim(),
      match_type: "tournament",
      format,
      skill_level: level,
      price_per_team_pence: Math.round(Number(buyIn) * 100),
      max_teams: Number(maxTeams),
      description: description.trim() || null,
      status: "open",
      booking_id: booking.id,
      organiser_team_id: team.id,
      organiser_team_name: team.name,
    }).select("id").single();
    if (omErr || !om) {
      setSaving(false);
      setError(omErr?.code === "42703"
        ? "Run supabase_team_tournaments.sql in Supabase first (missing organiser columns)."
        : `Couldn't post the tournament: ${omErr?.message ?? "unknown error"}`);
      return;
    }

    // 5) Enter the organiser's own team (they host and play; no buy-in — they
    //    fronted the pitch and get reimbursed as others join).
    await supabase.from("open_match_teams").insert({
      open_match_id: om.id,
      team_id: team.id,
      team_name: team.name,
      joined_by: user.id,
      payment_status: "paid",
    });

    // 6) Cash side: pay the venue the pitch fee (Stripe Connect, test mode).
    fetch("/api/connect/venue-transfer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pitchId: pitch.id, bookingId: booking.id, teamId: team.id, openMatchId: om.id, amountPence: pitchFeePence }),
    }).catch(() => {});

    setSaving(false);
    router.push("/calendar?filter=tournaments");
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Host a Tournament</h1>
          <p className="text-xs text-text-secondary mt-0.5">Book a pitch block and invite teams to buy in</p>
        </div>
      </div>

      {/* Game type: normal match vs tournament — Match goes back to the ranked-pitch flow */}
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 mb-5">
        <button type="button" onClick={() => router.push("/play/create")}
          className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors text-text-secondary">
          Match
        </button>
        <button type="button"
          className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors bg-accent text-black">
          Tournament
        </button>
      </div>

      {team === null ? (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-10 text-center">
          <p className="text-sm font-semibold mb-1">Captains only</p>
          <p className="text-xs text-text-secondary">You need to be a team captain to host a tournament.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Credit strip */}
          <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-text-secondary">Team credit available</span>
            <span className="text-sm font-bold text-accent">{creditPence === null ? "…" : `£${(creditPence / 100).toFixed(2)}`}</span>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3"><p className="text-sm text-red-400">{error}</p></div>
          )}

          {/* Details */}
          <section className="bg-surface-2 border border-border rounded-2xl p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Tournament title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunday 5s Cup"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Format</label>
                <select value={format} onChange={(e) => setFormat(e.target.value)}
                  className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                  {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Level</label>
                <select value={level} onChange={(e) => setLevel(e.target.value)}
                  className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Teams (min {MIN_TEAMS})</label>
                <input type="number" inputMode="numeric" min={MIN_TEAMS} value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)}
                  className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Buy-in per team (£)</label>
                <input type="number" inputMode="decimal" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} placeholder="e.g. 30"
                  className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Description <span className="text-text-secondary font-normal">(optional)</span></label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything teams should know…"
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
            </div>
          </section>

          {/* Pitch + slot */}
          <section className="bg-surface-2 border border-border rounded-2xl p-4 flex flex-col gap-4">
            <p className="text-sm font-semibold">Pitch & slot</p>
            {pitch && date && startTime ? (
              <div className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
                <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{pitch.name}</p>
                  <p className="text-[11px] text-text-secondary">{fmtDate(date)} · {startTime}–{endTime} · £{pitch.price_per_hour}/hr</p>
                </div>
                <button type="button" onClick={() => setShowPicker(true)} className="text-xs text-accent font-semibold flex-shrink-0">Change</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowPicker(true)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-dashed border-border text-sm text-text-secondary">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {loadingPitches ? "Loading pitches…" : "Choose a pitch & start time"}
              </button>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Duration (min {MIN_HOURS} hours)</label>
              <div className="flex gap-2 flex-wrap">
                {[2, 3, 4, 5, 6].map((h) => (
                  <button key={h} type="button" onClick={() => setHours(h)}
                    className={`flex-1 min-w-[56px] py-2 rounded-xl border text-sm font-bold transition-colors ${hours === h ? "bg-accent text-black border-accent" : "bg-background border-border text-text-primary"}`}>
                    {h}h
                  </button>
                ))}
              </div>
              {startTime && <p className="text-[11px] text-text-secondary">{startTime}–{endTime}</p>}
            </div>
          </section>

          {/* Cost summary */}
          {pitch && (
            <section className="bg-surface-2 border border-border rounded-2xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between text-text-secondary"><span>Pitch hire ({hours}h × £{pitch.price_per_hour})</span><span className="font-semibold text-text-primary">£{(pitchFeePence / 100).toFixed(2)}</span></div>
              <div className="flex justify-between text-text-secondary"><span>Unitr fee (5%)</span><span className="font-semibold text-text-primary">£{(unitrFeePence / 100).toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-border pt-1.5 mt-1.5"><span className="font-semibold">Paid now from team credit</span><span className="font-bold text-accent">£{(totalPence / 100).toFixed(2)}</span></div>
              <p className="text-[11px] text-text-secondary pt-1">Each of the other {Math.max(0, Number(maxTeams) - 1)} teams pays £{Number(buyIn || 0).toFixed(2)} to join — reimbursed straight to your team credit.</p>
            </section>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={() => router.back()} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? (
                <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Booking…</>
              ) : totalPence > 0 ? `Book & Host — £${(totalPence / 100).toFixed(2)}` : "Book & Host Tournament"}
            </button>
          </div>
        </div>
      )}

      {/* Pick a pitch & start time using the same Book tab discovery UI */}
      {showPicker && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/60"
          onClick={() => setShowPicker(false)}>
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-4 pb-1">
              <div>
                <p className="font-bold">Choose a pitch</p>
                <p className="text-[11px] text-text-secondary">Pick a start slot — you&apos;ll book {hours} consecutive hours</p>
              </div>
              <button onClick={() => setShowPicker(false)} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <BookPitchPanel
              initialDate={date || undefined}
              initialTime={startTime || undefined}
              onSelectSlot={(pid, d, t) => {
                setPitchId(pid);
                setDate(d);
                setStartTime(t);
                setShowPicker(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
