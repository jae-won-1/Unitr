"use client";

// ── Available / Unavailable, on the fixture card itself ────────────────
// Availability used to live only in the poll flow: a captain opened a poll,
// players picked dates, and that was the last word. But the question a player
// actually asks is "am I still in for Saturday?", and the honest answer changes
// — a shift gets moved, a knee goes. So the buttons sit on every upcoming
// fixture card and stay tappable right up to kickoff.
//
// Backed by match_confirmations, which already had exactly the right shape
// (status confirmed | declined | pending, unique on match_id + player_id) and
// already gets a pending row per squad member the moment a challenge is
// accepted (components/ChallengePanel.tsx). Its UI had simply been orphaned —
// handleConfirmAttendance on the manage-match page was dead code with nothing
// calling it. This component is that button, finally rendered.
//
// FRIENDLIES AND TOURNAMENTS. A tournament entry has no matches row, so it
// answers against open_match_id instead (supabase_event_availability.sql);
// callers pass whichever of the two they have. Pitch bookings and ringer
// entries have neither and get nothing back.

import { useState, useEffect } from "react";
import { fmtFee, getJoiningFeeStatus } from "@/lib/joining-fee";
import { readMyStatus, writeMyStatus, type ConfirmStatus } from "@/lib/event-availability";

export type { ConfirmStatus };

export function AvailabilityButtons({
  matchId,
  openMatchId,
  playerId,
  teamId,
  size = "md",
  onChanged,
}: {
  matchId?: string | null;
  openMatchId?: string | null;
  playerId: string;
  teamId: string;
  size?: "sm" | "md";
  // Given the status just saved, so a caller showing an attendance list can
  // move this player's row without re-fetching.
  onChanged?: (status: ConfirmStatus) => void;
}) {
  const [status, setStatus] = useState<ConfirmStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [feeOwedPence, setFeeOwedPence] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [current, fee] = await Promise.all([
        readMyStatus({ matchId, openMatchId }, playerId),
        getJoiningFeeStatus(teamId, playerId),
      ]);
      if (cancelled) return;
      if (current === null) setError(true);
      else setStatus(current);
      setFeeOwedPence(fee.owedPence);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [matchId, openMatchId, playerId, teamId]);

  async function set(next: ConfirmStatus) {
    if (busy) return;
    // Tapping the active choice again clears back to pending, so "I haven't
    // decided" stays reachable after an accidental tap.
    const target = status === next ? "pending" : next;
    const previous = status;
    setStatus(target);          // optimistic — the tap should feel instant
    setBusy(true);

    const ok = await writeMyStatus({ matchId, openMatchId }, { playerId, teamId, status: target });

    setBusy(false);
    if (!ok) {
      setStatus(previous);      // revert rather than show a lie
      setError(true);
      return;
    }
    onChanged?.(target);
  }

  if (loading) return <div className="h-8" />;

  if (error) {
    return (
      <p className="text-[11px] text-text-secondary">
        Couldn&apos;t load your availability — try again in a moment.
      </p>
    );
  }

  const pad = size === "sm" ? "py-1.5 text-[11px]" : "py-2 text-xs";

  // House rule: a player who hasn't paid their joining fee can't join or vote
  // available for games. Greyed rather than hidden, per the QuickNav
  // convention — the buttons stay so the layout doesn't shift, with the
  // reason written where they'd have tapped.
  if (feeOwedPence > 0) {
    return (
      <div>
        <div className="flex gap-2 opacity-40 pointer-events-none" aria-disabled>
          <span className={`flex-1 ${pad} rounded-btn border bg-surface border-border text-text-secondary font-semibold text-center`}>Available</span>
          <span className={`flex-1 ${pad} rounded-btn border bg-surface border-border text-text-secondary font-semibold text-center`}>Unavailable</span>
        </div>
        <p className="text-[11px] text-red-600 font-semibold mt-1.5">
          Pay your {fmtFee(feeOwedPence)} joining fee (Top Up on Home) to vote for games.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => set("confirmed")}
        className={`flex-1 ${pad} rounded-btn border transition-colors disabled:opacity-60 ${
          status === "confirmed"
            ? "bg-[#E7F8EC] border-[1.5px] border-accent-ink text-accent-ink font-bold"
            : "bg-surface border-border text-text-secondary font-semibold"
        }`}
      >
        Available
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => set("declined")}
        className={`flex-1 ${pad} rounded-btn border transition-colors disabled:opacity-60 ${
          status === "declined"
            ? "bg-red-50 border-[1.5px] border-danger text-danger font-bold"
            : "bg-surface border-border text-text-secondary font-semibold"
        }`}
      >
        Unavailable
      </button>
    </div>
  );
}

export default AvailabilityButtons;
