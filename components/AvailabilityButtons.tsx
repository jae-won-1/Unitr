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
// FRIENDLIES ONLY. Tournaments, pitch bookings and ringer entries have no
// matches row to hang a confirmation off, so callers pass no matchId and get
// nothing back.

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export type ConfirmStatus = "confirmed" | "declined" | "pending";

export function AvailabilityButtons({
  matchId,
  playerId,
  teamId,
  size = "md",
  onChanged,
}: {
  matchId: string;
  playerId: string;
  teamId: string;
  size?: "sm" | "md";
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState<ConfirmStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("match_confirmations")
        .select("status")
        .eq("match_id", matchId)
        .eq("player_id", playerId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(true);
      else setStatus((data?.status as ConfirmStatus) ?? "pending");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [matchId, playerId]);

  async function set(next: ConfirmStatus) {
    if (busy) return;
    // Tapping the active choice again clears back to pending, so "I haven't
    // decided" stays reachable after an accidental tap.
    const target = status === next ? "pending" : next;
    const previous = status;
    setStatus(target);          // optimistic — the tap should feel instant
    setBusy(true);

    const { error } = await supabase
      .from("match_confirmations")
      .upsert(
        { match_id: matchId, player_id: playerId, team_id: teamId, status: target },
        { onConflict: "match_id,player_id" },
      );

    setBusy(false);
    if (error) {
      setStatus(previous);      // revert rather than show a lie
      setError(true);
      return;
    }
    onChanged?.();
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

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => set("confirmed")}
        className={`flex-1 ${pad} rounded-lg border font-semibold transition-colors disabled:opacity-60 ${
          status === "confirmed"
            ? "bg-accent/10 border-accent text-accent"
            : "bg-surface-2 border-border text-text-secondary"
        }`}
      >
        Available
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => set("declined")}
        className={`flex-1 ${pad} rounded-lg border font-semibold transition-colors disabled:opacity-60 ${
          status === "declined"
            ? "bg-red-500/10 border-red-400 text-red-400"
            : "bg-surface-2 border-border text-text-secondary"
        }`}
      >
        Unavailable
      </button>
    </div>
  );
}

export default AvailabilityButtons;
