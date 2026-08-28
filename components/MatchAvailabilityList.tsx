"use client";

// ── Availability for games that are already real ───────────────────────
// The poll answers "which of these dates could you play?". It stops being
// useful the moment a game is actually confirmed — and plenty of games never
// went through a poll at all, because the captain matched straight off the
// feed. Those fixtures still need an answer from every player, so they appear
// alongside the poll on Home rather than only inside Manage Match.
//
// Backed by match_confirmations, the same table AvailabilityButtons and the
// Manage Match attendance tab read — this is a second doorway onto one record,
// not a second record.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtKickoff, isKickoffPast, sortKey } from "@/lib/match-dates";
import AvailabilityButtons, { type ConfirmStatus } from "@/components/AvailabilityButtons";

export type UpcomingMatch = {
  id: string;
  matchDate: string;
  matchTime: string;
  opponentName: string;
  pitchName: string | null;
  myStatus: ConfirmStatus;
};

export function useMatchAvailability(teamId: string | null, userId: string | undefined) {
  const [matches, setMatches] = useState<UpcomingMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId || !userId) { setMatches([]); setLoading(false); return; }
    setLoading(true);

    const { data: rows } = await supabase
      .from("matches")
      .select("id, posting_team_id, challenging_team_id, match_date, match_time, confirmed_pitch, status")
      .or(`posting_team_id.eq.${teamId},challenging_team_id.eq.${teamId}`)
      .eq("status", "confirmed");

    const upcoming = (rows ?? []).filter((m) => !isKickoffPast(m.match_date, m.match_time));
    if (upcoming.length === 0) { setMatches([]); setLoading(false); return; }

    // teams.captain_id → profiles isn't in the schema cache, and embedding the
    // opponent team the same way would fail the whole query. Fetched separately.
    const opponentIds = [...new Set(upcoming.map((m) =>
      m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id))].filter(Boolean);
    const [{ data: teams }, { data: confs }] = await Promise.all([
      opponentIds.length
        ? supabase.from("teams").select("id, name").in("id", opponentIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      supabase.from("match_confirmations").select("match_id, status")
        .eq("player_id", userId).in("match_id", upcoming.map((m) => m.id)),
    ]);
    const nameById = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
    const statusByMatch = new Map((confs ?? []).map((c) => [c.match_id as string, c.status as ConfirmStatus]));

    setMatches(upcoming
      .map((m) => ({
        id: m.id as string,
        matchDate: m.match_date as string,
        matchTime: m.match_time as string,
        opponentName: nameById.get(
          m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id
        ) ?? "Opponent",
        pitchName: (m.confirmed_pitch as { name?: string } | null)?.name ?? null,
        myStatus: statusByMatch.get(m.id as string) ?? "pending",
      }))
      .sort((a, b) => sortKey(a.matchDate, a.matchTime).localeCompare(sortKey(b.matchDate, b.matchTime))));
    setLoading(false);
  }, [teamId, userId]);

  useEffect(() => { load(); }, [load]);

  const awaiting = matches.filter((m) => m.myStatus === "pending").length;

  return { matches, awaiting, loading, reload: load };
}

export default function MatchAvailabilityList({
  matches, userId, teamId, onChanged,
}: {
  matches: UpcomingMatch[];
  userId: string;
  teamId: string;
  onChanged?: () => void;
}) {
  if (matches.length === 0) return null;

  return (
    <div className="space-y-2">
      {matches.map((m) => (
        <div key={m.id} className="bg-surface border border-border rounded-btn px-3 py-2.5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">vs {m.opponentName}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">
                {fmtKickoff(m.matchDate, m.matchTime)}
                {m.pitchName ? ` · ${m.pitchName}` : ""}
              </p>
            </div>
            {m.myStatus === "pending" && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-orange-500/10 text-orange-600 border-orange-500/30 flex-shrink-0">
                Reply
              </span>
            )}
          </div>
          <AvailabilityButtons
            matchId={m.id}
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
