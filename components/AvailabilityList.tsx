"use client";

// ── Availability for games that are already real ───────────────────────
// The poll answers "which of these dates could you play?". It stops being
// useful the moment a game is actually confirmed — and plenty of games never
// went through a poll at all, because the captain took a match off the feed or
// entered a tournament on the spot. Those still need an answer from every
// player, so they appear alongside the poll on Home rather than only inside
// Manage Match.
//
// Backed by match_confirmations, the same table AvailabilityButtons and the
// Manage Match attendance tab read — this is a second doorway onto one record,
// not a second record. Both kinds of commitment are here: a friendly answers
// against its matches row, a tournament entry against its open_matches row
// (lib/event-availability.ts).

import { useCallback, useEffect, useState } from "react";
import { fmtKickoff } from "@/lib/match-dates";
import AvailabilityButtons from "@/components/AvailabilityButtons";
import {
  loadSquadAnswerCounts, loadUpcomingEvents,
  type AnswerCounts, type UpcomingEvent,
} from "@/lib/event-availability";

export type { UpcomingEvent };

export function useEventAvailability(teamId: string | null, userId: string | undefined) {
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setEvents(await loadUpcomingEvents(teamId, userId));
    setLoading(false);
  }, [teamId, userId]);

  useEffect(() => { load(); }, [load]);

  const awaiting = events.filter((e) => e.myStatus === "pending").length;

  return { events, awaiting, loading, reload: load };
}

/** The squad's tally per game — captain-side only, so it loads separately. */
export function useSquadAnswers(teamId: string | null, events: UpcomingEvent[]) {
  const [counts, setCounts] = useState<Record<string, AnswerCounts>>({});

  // Keyed on the event keys rather than the array, which is a new object on
  // every reload of the list and would otherwise re-query forever.
  const keys = events.map((e) => e.key).join(",");
  const load = useCallback(async () => {
    setCounts(await loadSquadAnswerCounts(teamId, events));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, keys]);

  useEffect(() => { load(); }, [load]);

  return { counts, reload: load };
}

export default function AvailabilityList({
  events, userId, teamId, counts, onChanged,
}: {
  events: UpcomingEvent[];
  userId: string;
  teamId: string;
  /** Given by the captain's surfaces only — a player sees their own answer, not the squad's. */
  counts?: Record<string, AnswerCounts>;
  onChanged?: () => void;
}) {
  if (events.length === 0) return null;

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <div key={e.key} className="bg-surface border border-border rounded-btn px-3 py-2.5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{e.title}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">
                {e.kind === "tournament" ? "Tournament · " : ""}
                {fmtKickoff(e.matchDate, e.matchTime)}
                {e.venueName ? ` · ${e.venueName}` : ""}
              </p>
              {counts && (
                <p className="text-[10px] font-semibold text-text-secondary mt-1">
                  <span className="text-accent-ink">{counts[e.key]?.confirmed ?? 0} available</span>
                  {" · "}{counts[e.key]?.declined ?? 0} out
                </p>
              )}
            </div>
            {e.myStatus === "pending" && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-orange-500/10 text-orange-600 border-orange-500/30 flex-shrink-0">
                Reply
              </span>
            )}
          </div>
          <AvailabilityButtons
            matchId={e.target.matchId}
            openMatchId={e.target.openMatchId}
            playerId={userId}
            teamId={teamId}
            size="sm"
            onChanged={onChanged}
          />
        </div>
      ))}
    </div>
  );
}
