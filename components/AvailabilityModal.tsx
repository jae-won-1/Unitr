"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtFee, useJoiningFee } from "@/lib/joining-fee";
import MatchAvailabilityList, { type UpcomingMatch } from "@/components/MatchAvailabilityList";

// Answering the captain's availability poll without leaving home. Same options,
// same "unavailable for any of these" escape hatch, and the same
// availability_responses upsert the My Team tab writes — this is a second
// doorway onto one record, not a second record.
//
// It also carries the squad's already-confirmed fixtures, because plenty of
// games never went through a poll (the captain matched straight off the feed)
// and those still need an answer from every player. Two different records —
// availability_responses for the poll, match_confirmations for the fixtures —
// behind one "am I playing?" surface, which is the only question the player is
// actually asking.

export type DateOption = {
  id: string;
  date: string;
  time: string;
  day: string;
  month: string;
  dayName: string;
  location?: string;
};

type Request = { id: string; date_options: DateOption[] };

// Latest poll for the team, plus whether this player has already answered.
// An empty available_date_ids is a real answer meaning "none of these" — it has
// to be distinguished from "hasn't replied", hence null vs [].
export function useAvailabilityPoll(teamId: string | null, userId: string | undefined) {
  const [request, setRequest] = useState<Request | null>(null);
  const [myAnswer, setMyAnswer] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId || !userId) { setLoading(false); return; }
    const { data: req } = await supabase
      .from("availability_requests")
      .select("id, date_options")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!req) { setRequest(null); setMyAnswer(null); setLoading(false); return; }

    const { data: mine } = await supabase
      .from("availability_responses")
      .select("available_date_ids")
      .eq("request_id", req.id)
      .eq("player_id", userId)
      .maybeSingle();

    setRequest(req as Request);
    setMyAnswer(mine ? (mine.available_date_ids as string[]) : null);
    setLoading(false);
  }, [teamId, userId]);

  useEffect(() => { load(); }, [load]);

  return { request, myAnswer, loading, reload: load };
}

export default function AvailabilityModal({
  request, myAnswer, userId, teamId, matches = [], onMatchChanged, onClose, onSubmitted,
}: {
  request: Request | null;
  myAnswer: string[] | null;
  userId: string;
  // Only needed to answer fixtures — match_confirmations rows are team-scoped.
  teamId?: string | null;
  matches?: UpcomingMatch[];
  onMatchChanged?: () => void;
  onClose: () => void;
  onSubmitted: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(myAnswer ?? []);
  const [noneWork, setNoneWork] = useState(myAnswer !== null && myAnswer.length === 0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showMatches = matches.length > 0 && !!teamId;

  // Unpaid joining fee blocks voting — same rule AvailabilityButtons applies
  // to the fixture answers rendered further down this sheet.
  const { owedPence: feeOwedPence, loading: feeLoading } = useJoiningFee(teamId, userId);
  const feeBlocked = !feeLoading && feeOwedPence > 0;

  const submit = async () => {
    if (!request || feeBlocked) return;
    setSubmitting(true);
    setError(null);
    const ids = noneWork ? [] : selected;
    const { error: err } = await supabase.from("availability_responses").upsert(
      { request_id: request.id, player_id: userId, available_date_ids: ids },
      { onConflict: "request_id,player_id" }
    );
    if (err) { setError("Couldn't save your availability. Try again."); setSubmitting(false); return; }
    // The full-screen confirmation is only right when the poll was the whole
    // job. With fixtures also on this sheet it would hide work still to do, so
    // there the save reports itself inline instead.
    setDone(!showMatches);
    setSaved(true);
    setSubmitting(false);
    onSubmitted(ids);
  };

  const canSubmit = (selected.length > 0 || noneWork) && !submitting && !feeBlocked;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-scrim px-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <p className="text-lg font-bold mb-1">Availability sent</p>
            <p className="text-sm text-text-secondary mb-5">
              {noneWork
                ? "Your captain knows none of these dates work for you."
                : `You're down as available for ${selected.length} date${selected.length === 1 ? "" : "s"}.`}
            </p>
            <button onClick={onClose} className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">Done</button>
          </div>
        ) : (
          <>
            <p className="text-lg font-bold mb-1">Submit availability</p>
            <p className="text-xs text-text-secondary mb-4">
              {request
                ? "Pick every slot you could play. Your captain sees the totals, not who picked what."
                : "Confirm whether you can play the games your team already has booked in."}
            </p>

            {feeBlocked && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5 mb-4">
                <p className="text-xs text-red-600 font-semibold">
                  Your {fmtFee(feeOwedPence)} joining fee is still due. Pay it via the Top Up
                  button on Home to join and vote available for games — it goes into the
                  team&rsquo;s credits for pitch and tournament fees.
                </p>
              </div>
            )}

            {showMatches && (
              <div className="mb-5">
                <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">
                  Confirmed matches
                </p>
                <MatchAvailabilityList
                  matches={matches}
                  userId={userId}
                  teamId={teamId!}
                  onChanged={onMatchChanged}
                />
              </div>
            )}

            {request && (
            <>
            {showMatches && (
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">
                Proposed dates
              </p>
            )}
            <div className="space-y-2 mb-4">
              {request.date_options.map((opt) => {
                const picked = selected.includes(opt.id);
                const disabled = noneWork;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setSelected((prev) => (prev.includes(opt.id) ? prev.filter((d) => d !== opt.id) : [...prev, opt.id]))
                    }
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors
                      ${picked ? "bg-accent/10 border-accent" : disabled ? "bg-surface-2 border-border opacity-40 cursor-not-allowed" : "bg-surface-2 border-border"}`}
                  >
                    <div>
                      <p className={`text-sm font-semibold ${picked ? "text-accent-ink" : ""}`}>{opt.dayName} · {opt.time}</p>
                      <p className="text-[10px] text-text-secondary mt-0.5">
                        {opt.date}{opt.location ? ` · ${opt.location}` : ""}
                      </p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${picked ? "border-accent bg-accent" : "border-border"}`}>
                      {picked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                disabled={selected.length > 0}
                onClick={() => setNoneWork((v) => !v)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors
                  ${noneWork ? "bg-red-500/10 border-red-400" : selected.length > 0 ? "bg-surface-2 border-border opacity-40 cursor-not-allowed" : "bg-surface-2 border-border"}`}
              >
                <p className={`text-sm font-semibold ${noneWork ? "text-red-600" : "text-text-secondary"}`}>
                  Unavailable for any of these dates
                </p>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${noneWork ? "border-red-400 bg-red-400" : "border-border"}`}>
                  {noneWork && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
              </button>
            </div>
            </>
            )}

            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
            {saved && !done && <p className="text-xs text-accent-ink mb-3">Poll answer saved.</p>}

            {request ? (
              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
                <button onClick={submit} disabled={!canSubmit}
                  className="flex-1 py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
                  {submitting ? "Submitting…" : myAnswer !== null ? "Update" : "Submit"}
                </button>
              </div>
            ) : (
              // Fixture answers save on tap, so there's nothing left to submit.
              <button onClick={onClose} className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">Done</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
