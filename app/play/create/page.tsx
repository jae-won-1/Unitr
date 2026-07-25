"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";
import BookPitchPanel from "@/components/BookPitchPanel";

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

const POLL_MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function isPollExpired(dateOptions: { date: string; time: string }[]): boolean {
  if (!dateOptions.length) return true;
  const times = dateOptions.map((opt) => {
    const m = opt.date.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (!m) return Infinity;
    const mo = POLL_MONTHS[m[2].toUpperCase()];
    if (mo === undefined) return Infinity;
    const [h, min] = opt.time.split(":").map(Number);
    return new Date(Number(m[3]), mo, Number(m[1]), h, min).getTime();
  });
  return Math.min(...times) < Date.now();
}


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

// This page is the ranked-pitch (split) flow: the team posts up to 3 preferred
// pitches WITHOUT booking, the opponent picks one when they challenge, the fee
// is split between the two teams at confirmation, and players who played top up
// their team credit afterwards. Teams that would rather lock a pitch in first do
// that from the Book tab and turn the booking into a "secured" post instead.
export default function CreateMatchPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [confirmedDates, setConfirmedDates] = useState<ConfirmedDate[]>([]);
  const [manualDates, setManualDates] = useState<ManualDate[]>(() => {
    if (typeof window === "undefined") return [{ id: "1", date: "", time: "" }];
    const saved = localStorage.getItem("unitr_manual_dates");
    return saved ? JSON.parse(saved) : [{ id: "1", date: "", time: "" }];
  });
  const [pitchOptions, setPitchOptions] = useState<PitchOption[]>([]);
  const [draggingPitchId, setDraggingPitchId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [team, setTeam] = useState<{ id: string; name: string; location: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityRequest, setAvailabilityRequest] = useState<{ id: string; date_options: { id: string; date: string; time: string; dayName: string }[] } | null>(null);
  const [availabilityResponses, setAvailabilityResponses] = useState<{ available_date_ids: string[] }[]>([]);
  const [selectedPollDates, setSelectedPollDates] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("unitr_selected_poll_dates");
    return saved ? JSON.parse(saved) : [];
  });
  // Whether to secure a pitch up front instead of splitting with an opponent.
  // "yes" opens the Book tab in a popup right on this page; "no" (default)
  // continues with the ranked-pitch-options flow below.
  const [lockInPitch, setLockInPitch] = useState<"no" | "yes">("no");
  const [showBookModal, setShowBookModal] = useState(false);

  useEffect(() => {
    // This page only does the split/ranked-pitch flow — pin the mode so the
    // pitch-selection step (/pitches?mode=select) reads it consistently.
    localStorage.setItem("unitr_payment_mode", "individual");
    const savedDates = localStorage.getItem("unitr_confirmed_dates");
    if (savedDates) setConfirmedDates(JSON.parse(savedDates));
    const savedOptions: PitchOption[] = JSON.parse(localStorage.getItem("unitr_pitch_options") ?? "[]");
    setPitchOptions(savedOptions);
  }, []);

  useEffect(() => {
    localStorage.setItem("unitr_manual_dates", JSON.stringify(manualDates));
  }, [manualDates]);

  useEffect(() => {
    localStorage.setItem("unitr_selected_poll_dates", JSON.stringify(selectedPollDates));
  }, [selectedPollDates]);

  useEffect(() => {
    if (!user) return;
    supabase.from("teams").select("id, name, location")
      .eq("captain_id", user.id).maybeSingle()
      .then(({ data }) => setTeam(data));
  }, [user]);

  useEffect(() => {
    if (!team || !user) return;
    supabase.from("availability_requests").select("id, date_options")
      .eq("team_id", team.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(async ({ data: req }) => {
        if (!req) { setAvailabilityRequest(null); return; }
        if (isPollExpired(req.date_options)) {
          await fetch("/api/availability/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: req.id, captainId: user.id }),
          });
          setAvailabilityRequest(null);
          return;
        }
        setAvailabilityRequest(req);
        const { data: resps } = await supabase.from("availability_responses")
          .select("available_date_ids").eq("request_id", req.id);
        setAvailabilityResponses(resps ?? []);
      });
  }, [team, user]);

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

    if (availabilityRequest && selectedPollDates.length > 0) {
      const counts = selectedPollDates.map((id) =>
        availabilityResponses.filter((r) => r.available_date_ids.includes(id)).length
      );
      localStorage.setItem("unitr_squad_count", String(Math.min(...counts)));
    } else {
      localStorage.removeItem("unitr_squad_count");
    }

    router.push("/pitches?mode=select");
  };

  // "Lock in a pitch first": open the Book tab in a popup right on this page,
  // pre-filtered to the captain's chosen posting date/time. Booking there
  // auto-posts the slot as a secured match, superseding this ranked-pitch form.
  const handleLockInPitch = (choice: "yes" | "no") => {
    setLockInPitch(choice);
    if (choice === "yes") setShowBookModal(true);
  };

  const removePitchOption = (id: string) => {
    setPitchOptions((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      localStorage.setItem("unitr_pitch_options", JSON.stringify(updated));
      return updated;
    });
  };

  const reorderPitchOptions = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setPitchOptions((prev) => {
      const fromIndex = prev.findIndex((p) => p.id === fromId);
      const toIndex = prev.findIndex((p) => p.id === toId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
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
      payment_mode: "individual",
      hold_pence: 0,
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

    if (insertError) { setLoading(false); setError(insertError.message); return; }

    setLoading(false);
    localStorage.removeItem("unitr_confirmed_dates");
    localStorage.removeItem("unitr_pitch_options");
    localStorage.removeItem("unitr_posting_slots");
    localStorage.removeItem("unitr_pitch_overrides");
    localStorage.removeItem("unitr_manual_dates");
    localStorage.removeItem("unitr_selected_poll_dates");
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
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Create Match Post</h1>
          <p className="text-xs text-text-secondary mt-0.5">Post up to 3 preferred pitches — the opponent picks one</p>
        </div>
        <span className="text-[11px] font-semibold bg-surface-2 border border-border text-text-secondary px-2.5 py-1 rounded-full flex-shrink-0">Split Pay</span>
      </div>

      <div className="flex flex-col gap-5">

        {/* Game type: normal match vs tournament — tournaments have their own flow */}
        <div className="flex bg-surface-2 border border-border rounded-xl p-1">
          <button type="button"
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors bg-accent text-black">
            Match
          </button>
          <button type="button" onClick={() => router.push("/play/create-tournament")}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors text-text-secondary">
            Tournament
          </button>
        </div>

        {/* Lock in a pitch first? — Yes opens the Book tab as a popup right here */}
        <div className="bg-accent/5 border border-accent/20 rounded-2xl p-4">
          <div className="flex items-start gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold mb-1">Lock in a pitch first?</p>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                Choose <span className="text-text-primary font-medium">Yes</span> to book and pay for a pitch now from team credit —
                it&apos;s reserved immediately and opponents can join instantly. Your team credit is{" "}
                <span className="text-text-primary font-medium">reimbursed for their half</span> as soon as one joins.
                Choose <span className="text-text-primary font-medium">No</span> and nothing is booked yet — the pitch stays
                unreserved until an opponent joins, at which point the fee is split between both teams.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => handleLockInPitch("yes")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${lockInPitch === "yes" ? "bg-accent text-black" : "bg-surface-2 border border-border text-text-primary"}`}>
                  Yes, book a pitch
                </button>
                <button type="button" onClick={() => handleLockInPitch("no")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${lockInPitch === "no" ? "bg-accent text-black" : "bg-surface-2 border border-border text-text-primary"}`}>
                  No, split with opponent
                </button>
              </div>
            </div>
          </div>
        </div>

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
              <p className="text-xs text-text-secondary mb-1">
                Pick one or more dates/times — each becomes its own post to maximise your chance of a match.
              </p>
              {availabilityRequest.date_options.map((opt) => {
                const picked = selectedPollDates.includes(opt.id);
                const votes = availabilityResponses.filter((r) => r.available_date_ids.includes(opt.id)).length;
                const total = availabilityResponses.length;
                const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                return (
                  <button key={opt.id} type="button" onClick={() => setSelectedPollDates((prev) =>
                    prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id]
                  )}
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
              <p className="text-xs text-text-secondary mb-1">
                Add date options manually, or go to availability first to collect squad votes.
              </p>
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
                      <TimePicker value={opt.time} selectedDate={opt.date} onChange={(t) => updateManualDate(opt.id, "time", t)} />
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
                  {opt.date && opt.time && (() => {
                    const dt = new Date(opt.date + "T" + opt.time);
                    const diff = dt.getTime() - Date.now();
                    return diff > 0 && diff < 86400000;
                  })() && (
                    <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <p className="text-xs text-yellow-400">You have selected a time less than 24 hours from now. The team credits will not be reimbursed if you cannot find an opponent.</p>
                    </div>
                  )}
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
                  <div key={p.id}
                    draggable={pitchOptions.length > 1}
                    onDragStart={() => setDraggingPitchId(p.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={() => { if (draggingPitchId && draggingPitchId !== p.id) reorderPitchOptions(draggingPitchId, p.id); }}
                    onDrop={(e) => e.preventDefault()}
                    onDragEnd={() => setDraggingPitchId(null)}
                    className={`flex items-center gap-2 bg-background border border-border rounded-xl px-3 py-2.5 transition-all duration-200 ${draggingPitchId === p.id ? "opacity-40 scale-[0.98]" : ""}`}>
                    {pitchOptions.length > 1 && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-secondary flex-shrink-0 cursor-grab active:cursor-grabbing">
                        <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
                      </svg>
                    )}
                    <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-accent">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p.name}</p>
                      <p className="text-xs text-text-secondary">
                        {p.format} · £{((p.price / 2) * 1.05).toFixed(2)}/hr each{pitchTime ? ` · ${pitchTime}` : ""}
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

      {/* Book a pitch popup — "Lock in a pitch first? Yes" */}
      {showBookModal && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/60"
          onClick={() => setShowBookModal(false)}>
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-4 pb-1">
              <p className="font-bold">Secure a Pitch</p>
              <button onClick={() => setShowBookModal(false)} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <BookPitchPanel
              initialDate={originalSlot?.date}
              initialTime={originalSlot?.time}
              autoPost
              onDone={(posted) => {
                setShowBookModal(false);
                if (posted) router.push("/play");
                else setLockInPitch("no");
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
