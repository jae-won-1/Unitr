"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";

type ConfirmedDate = {
  id: string;
  date: string;
  time: string;
  day: string;
  month: string;
  dayName: string;
};

type PitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
  // Per-date times for this pitch (ISO date → time), set when the captain
  // picks an alternative slot for one pitch in the pitch-selection step.
  slotTimes?: Record<string, string>;
};

type ManualDate = {
  id: string;
  date: string;
  time: string;
};

const rankLabels = ["1st choice", "2nd choice", "3rd choice"];


function getDayName(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
}

const ISO_MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
// Convert a display date like "Sat, 13 JUN 2026" to ISO "2026-06-13".
// Idempotent: already-ISO strings pass through unchanged.
function toISODate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const key = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    if (ISO_MONTHS[key] !== undefined) {
      const d = new Date(Number(m[3]), ISO_MONTHS[key], Number(m[1]));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return raw;
}

export default function CreateMatchPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [confirmedDates, setConfirmedDates] = useState<ConfirmedDate[]>([]);
  const [manualDates, setManualDates] = useState<ManualDate[]>([{ id: "1", date: "", time: "" }]);
  const [pitchOptions, setPitchOptions] = useState<PitchOption[]>([]);
  const [description, setDescription] = useState("");
  const [team, setTeam] = useState<{ id: string; name: string; location: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityRequest, setAvailabilityRequest] = useState<{ id: string; date_options: { id: string; date: string; time: string; dayName: string }[] } | null>(null);
  const [availabilityResponses, setAvailabilityResponses] = useState<{ available_date_ids: string[] }[]>([]);
  const [selectedPollDates, setSelectedPollDates] = useState<string[]>([]);
  const [paymentMode, setPaymentMode] = useState<string | null>(null);
  const [teamCredits, setTeamCredits] = useState<number | null>(null);

  useEffect(() => {
    const mode = localStorage.getItem("unitr_payment_mode");
    setPaymentMode(mode);
    const savedDates = localStorage.getItem("unitr_confirmed_dates");
    if (savedDates) setConfirmedDates(JSON.parse(savedDates));
    const savedOptions: PitchOption[] = JSON.parse(localStorage.getItem("unitr_pitch_options") ?? "[]");
    setPitchOptions(savedOptions);
  }, []);

  useEffect(() => {
    if (!team || paymentMode !== "credit") return;
    supabase.from("team_credits").select("balance").eq("team_id", team.id).maybeSingle()
      .then(({ data }) => setTeamCredits(data?.balance ?? 0));
  }, [team, paymentMode]);

  useEffect(() => {
    if (!user) return;
    supabase.from("teams").select("id, name, location")
      .eq("captain_id", user.id).maybeSingle()
      .then(({ data }) => setTeam(data));
  }, [user]);

  useEffect(() => {
    if (!team) return;
    supabase.from("availability_requests").select("id, date_options")
      .eq("team_id", team.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(async ({ data: req }) => {
        setAvailabilityRequest(req ?? null);
        if (req) {
          const { data: resps } = await supabase.from("availability_responses")
            .select("available_date_ids").eq("request_id", req.id);
          setAvailabilityResponses(resps ?? []);
        }
      });
  }, [team]);

  const addManualDate = () => {
    if (manualDates.length >= 5) return;
    setManualDates((prev) => [...prev, { id: String(Date.now()), date: "", time: "" }]);
  };

  const removeManualDate = (id: string) => {
    if (manualDates.length === 1) return;
    setManualDates((prev) => prev.filter((d) => d.id !== id));
  };

  const updateManualDate = (id: string, field: "date" | "time", value: string) => {
    setManualDates((prev) => prev.map((d) => d.id === id ? { ...d, [field]: value } : d));
  };

  const handleSelectPitch = () => {
    let slots: { matchDate: string; time: string; dayName: string }[] = [];
    if (availabilityRequest && selectedPollDates.length > 0) {
      slots = availabilityRequest.date_options
        .filter((o) => selectedPollDates.includes(o.id))
        .map((o) => ({ matchDate: o.date, time: o.time, dayName: o.dayName }));
    } else if (confirmedDates.length > 0) {
      slots = confirmedDates.map((d) => ({ matchDate: d.date, time: d.time, dayName: d.dayName }));
    } else {
      const filled = manualDates.filter((d) => d.date && d.time);
      slots = filled.map((d) => ({
        matchDate: d.date,
        time: d.time,
        dayName: getDayName(d.date),
      }));
    }
    localStorage.setItem("unitr_posting_slots", JSON.stringify(slots));

    if (paymentMode === "individual" && availabilityRequest && selectedPollDates.length > 0) {
      const counts = selectedPollDates.map((id) =>
        availabilityResponses.filter((r) => r.available_date_ids.includes(id)).length
      );
      localStorage.setItem("unitr_squad_count", String(Math.min(...counts)));
    } else {
      localStorage.removeItem("unitr_squad_count");
    }

    router.push("/pitches?mode=select");
  };

  const removePitchOption = (id: string) => {
    setPitchOptions((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      localStorage.setItem("unitr_pitch_options", JSON.stringify(updated));
      return updated;
    });
  };

  const handleCreate = async () => {
    if (!user) { setError("You must be signed in."); return; }
    if (!team) { setError("No team found. Register your team first."); return; }
    if (pitchOptions.length === 0) { setError("Add at least one pitch option."); return; }

    // Build the list of dates to post
    let datesToPost: { date: string; time: string; dayName: string }[] = [];

    if (availabilityRequest) {
      if (selectedPollDates.length === 0) { setError("Select at least one date from the poll."); return; }
      datesToPost = availabilityRequest.date_options
        .filter((o) => selectedPollDates.includes(o.id))
        .map((o) => ({ date: toISODate(o.date), time: o.time, dayName: o.dayName }));
    } else if (confirmedDates.length > 0) {
      datesToPost = confirmedDates.map((d) => ({ date: toISODate(d.date), time: d.time, dayName: d.dayName }));
    } else {
      const filled = manualDates.filter((d) => d.date && d.time);
      if (filled.length === 0) { setError("Add at least one date."); return; }
      datesToPost = filled.map((d) => ({
        date: toISODate(d.date),
        time: d.time,
        dayName: getDayName(d.date),
      }));
    }

    setLoading(true);
    setError(null);

    const base = {
      team_id: team.id,
      captain_id: user.id,
      team_name: team.name,
      team_location: team.location ?? "",
      description,
      status: "open",
    };

    // For each date: pitches kept at the original time are bundled into one main
    // post (ranked options the opponent chooses from). Each pitch given an
    // alternative time becomes its own standalone post alongside the main one.
    const inserts: Record<string, unknown>[] = [];
    for (const d of datesToPost) {
      const withTimes = pitchOptions.map(({ slotTimes, ...p }) => ({
        ...p,
        time: slotTimes?.[d.date] ?? d.time,
      }));
      const originalTimePitches = withTimes.filter((p) => p.time === d.time);
      const altTimePitches = withTimes.filter((p) => p.time !== d.time);

      if (originalTimePitches.length > 0) {
        inserts.push({
          ...base,
          match_date: d.date,
          match_time: d.time,
          day_name: d.dayName,
          pitch_options: originalTimePitches,
        });
      }
      for (const p of altTimePitches) {
        inserts.push({
          ...base,
          match_date: d.date,
          match_time: p.time,
          day_name: d.dayName,
          pitch_options: [p],
        });
      }
    }

    const { error: insertError } = await supabase.from("match_posts").insert(inserts);

    setLoading(false);
    if (insertError) { setError(insertError.message); return; }
    localStorage.removeItem("unitr_confirmed_dates");
    localStorage.removeItem("unitr_pitch_options");
    localStorage.removeItem("unitr_posting_slots");
    localStorage.removeItem("unitr_pitch_overrides");
    router.push("/play");
  };

  // The single original date/time the admin is posting for (used to flag which
  // pitches sit at the original time vs an alternative). Uses the first date.
  const originalSlot = (() => {
    if (availabilityRequest) {
      const o = availabilityRequest.date_options.find((x) => selectedPollDates.includes(x.id));
      return o ? { date: toISODate(o.date), time: o.time } : null;
    }
    if (confirmedDates.length > 0) return { date: toISODate(confirmedDates[0].date), time: confirmedDates[0].time };
    const f = manualDates.find((d) => d.date && d.time);
    return f ? { date: toISODate(f.date), time: f.time } : null;
  })();

  // Number of posts that will be created: one bundled post per date for the
  // original-time pitches, plus one standalone post per pitch given an alt time.
  const plannedPostCount = (() => {
    let dates: { date: string; time: string }[] = [];
    if (availabilityRequest) {
      dates = availabilityRequest.date_options
        .filter((o) => selectedPollDates.includes(o.id))
        .map((o) => ({ date: toISODate(o.date), time: o.time }));
    } else if (confirmedDates.length > 0) {
      dates = confirmedDates.map((d) => ({ date: toISODate(d.date), time: d.time }));
    } else {
      dates = manualDates.filter((d) => d.date && d.time).map((d) => ({ date: toISODate(d.date), time: d.time }));
    }
    let n = 0;
    for (const d of dates) {
      const times = pitchOptions.map((p) => p.slotTimes?.[d.date] ?? d.time);
      const hasOriginal = times.some((t) => t === d.time);
      const altCount = times.filter((t) => t !== d.time).length;
      n += (hasOriginal ? 1 : 0) + altCount;
    }
    return n;
  })();

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Create Match Post</h1>
          <p className="text-xs text-text-secondary mt-0.5">Post a match for other teams to challenge</p>
        </div>
        {paymentMode === "credit" && (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-text-secondary">Team Credit</span>
            <span className="text-sm font-bold text-accent">
              {teamCredits !== null ? `£${teamCredits.toFixed(2)}` : "—"}
            </span>
          </div>
        )}
        {paymentMode === "individual" && (
          <span className="text-[11px] font-semibold bg-surface-2 border border-border text-text-secondary px-2.5 py-1 rounded-full">Split Pay</span>
        )}
      </div>

      <div className="flex flex-col gap-5">

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Dates section */}
        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Match Dates</p>
            {availabilityRequest && (
              <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full font-medium">
                From availability poll
              </span>
            )}
            {!availabilityRequest && confirmedDates.length > 0 && (
              <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full font-medium">
                {confirmedDates.length} from availability
              </span>
            )}
          </div>

          {availabilityRequest ? (
            /* ── Select from poll ── */
            <div className="flex flex-col gap-2">
              <p className="text-xs text-text-secondary mb-1">Pick one date/time for this match — tap to choose.</p>
              {availabilityRequest.date_options.map((opt) => {
                const picked = selectedPollDates.includes(opt.id);
                const votes = availabilityResponses.filter((r) => r.available_date_ids.includes(opt.id)).length;
                const total = availabilityResponses.length;
                const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                return (
                  <button key={opt.id} type="button" onClick={() => setSelectedPollDates((prev) => prev.includes(opt.id) ? [] : [opt.id])}
                    className={`w-full text-left border rounded-xl px-3 py-2.5 transition-colors ${picked ? "bg-accent/10 border-accent" : "bg-background border-border"}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className={`text-sm font-semibold ${picked ? "text-accent" : ""}`}>{opt.dayName} · {opt.time}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-accent">{votes} vote{votes !== 1 ? "s" : ""}</span>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${picked ? "border-accent bg-accent" : "border-border"}`}>
                          {picked && <span className="w-2 h-2 rounded-full bg-black" />}
                        </div>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-surface rounded-full">
                      <div className="h-1.5 bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1">{opt.date}</p>
                  </button>
                );
              })}
              {selectedPollDates.length > 0 && (
                <p className="text-xs text-text-secondary mt-1">
                  This is your match&apos;s original time. Pitches you pick at this time share one post; any pitch you give an alternative time becomes its own post.
                </p>
              )}
            </div>
          ) : confirmedDates.length > 0 ? (
            /* ── Confirmed from localStorage ── */
            <div className="flex flex-col gap-2">
              {confirmedDates.map((d, i) => (
                <div key={d.id} className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2.5">
                  <div className="w-10 h-10 rounded-xl bg-accent text-black flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold uppercase">{d.month}</span>
                    <span className="text-base font-bold leading-none">{d.day}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{d.dayName}</p>
                    <p className="text-xs text-text-secondary">{d.date} · KO {d.time}</p>
                  </div>
                  <span className="text-[10px] text-text-secondary">Post {i + 1}</span>
                </div>
              ))}
              <p className="text-xs text-text-secondary mt-1">
                Each date becomes a separate post. The first team to challenge any of them locks in the match — the rest are removed automatically.
              </p>
            </div>
          ) : (
            /* ── Manual entry ── */
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-secondary mb-1">Add date options manually, or go to availability first to collect squad votes.</p>
              {manualDates.map((opt, i) => (
                <div key={opt.id} className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-text-secondary">Date {i + 1}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-36 flex flex-col gap-1">
                      <label className="text-xs text-text-secondary">Date</label>
                      <DatePicker value={opt.date} onChange={(d) => updateManualDate(opt.id, "date", d)} />
                    </div>
                    <div className="w-36 flex flex-col gap-1">
                      <label className="text-xs text-text-secondary">Time</label>
                      <TimePicker value={opt.time} onChange={(t) => updateManualDate(opt.id, "time", t)} />
                    </div>
                    {manualDates.length > 1 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs invisible select-none">_</span>
                        <button onClick={() => removeManualDate(opt.id)} className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {manualDates.length < 5 && (
                <button onClick={addManualDate} className="flex items-center gap-2 text-sm text-accent font-medium py-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                  Add another date
                </button>
              )}
              <a href="/my-team/availability"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-sm text-accent font-medium">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                Collect team availability first
              </a>
            </div>
          )}
        </section>

        {/* Pitch options */}
        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <p className="text-sm font-semibold">Pitch Options</p>
            <span className="text-xs text-text-secondary ml-auto">{pitchOptions.length}/3</span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Add up to 3 pitches in order of preference. Pitches at your match&apos;s original time share one post the opponent picks from. A pitch at an alternative time goes out as its own separate post.
          </p>

          {pitchOptions.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              {pitchOptions.map((p, i) => {
                const pitchTime = originalSlot ? (p.slotTimes?.[originalSlot.date] ?? originalSlot.time) : undefined;
                const isAlt = originalSlot ? pitchTime !== originalSlot.time : false;
                return (
                  <div key={p.id} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
                    <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-accent">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p.name}</p>
                      <p className="text-xs text-text-secondary">
                        {p.format} · £{p.price}/hr{pitchTime ? ` · ${pitchTime}` : ""}
                      </p>
                    </div>
                    {isAlt ? (
                      <span className="text-[9px] font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 rounded-full flex-shrink-0">Own post</span>
                    ) : (
                      <span className="text-[10px] text-text-secondary flex-shrink-0">{rankLabels[i]}</span>
                    )}
                    <button onClick={() => removePitchOption(p.id)} className="text-xs text-red-400 flex-shrink-0 ml-1">✕</button>
                  </div>
                );
              })}
            </div>
          )}

          {pitchOptions.length < 3 && (
            <button onClick={handleSelectPitch}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-dashed border-border text-sm text-text-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add Pitch Option
            </button>
          )}
        </section>

        {/* Description */}
        <section className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Description <span className="text-text-secondary font-normal">(optional)</span></label>
          <textarea rows={3} placeholder="Tell teams what to expect..."
            value={description} onChange={(e) => setDescription(e.target.value)}
            className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none" />
        </section>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()}
            className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={loading}
            className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {loading ? (
              <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Posting…</>
            ) : plannedPostCount > 1 ? `Post ${plannedPostCount} Matches` : "Post Match"}
          </button>
        </div>
      </div>
    </div>
  );
}
