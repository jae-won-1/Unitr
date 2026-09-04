"use client";

// ── Your games inside a tournament ────────────────────────────────────
// A tournament is one row on the Calendar and one card on My Team, because
// that's how a team commits to it. But on the day the squad plays two, three,
// five separate games, and each of those is the thing a captain actually wants
// to open — to pick a shape for, and a player wants to open to see what the
// shape is.
//
// So wherever a tournament appears as a single commitment, this list hangs
// underneath it: the games THIS team plays, in schedule order, each a door into
// /my-team/tournament-match/[fixtureId]. Same job FixtureDetailSheet does for a
// friendly's "Manage match", just with several doors instead of one.

import { useEffect, useState } from "react";
import { loadTeamFixturesInTournament, type TeamTournamentFixture } from "@/lib/tournament-match";

export default function TournamentFixtureList({
  openMatchId, teamId, isCaptain, compact = false,
}: {
  openMatchId: string;
  /** The viewer's team. Nothing renders without one — a fixture list is per-team. */
  teamId: string | null;
  isCaptain: boolean;
  /** Tighter type for the My Team card, which is already inside a card. */
  compact?: boolean;
}) {
  const [fixtures, setFixtures] = useState<TeamTournamentFixture[] | null>(null);

  useEffect(() => {
    if (!teamId) { setFixtures([]); return; }
    loadTeamFixturesInTournament(openMatchId, teamId).then(setFixtures);
  }, [openMatchId, teamId]);

  // Loading, or no team: say nothing rather than flash an empty state.
  if (!teamId || fixtures === null) return null;

  // A schedule the organiser hasn't generated yet isn't an error — it's the
  // normal state of a tournament right up until the day before.
  if (fixtures.length === 0) {
    return (
      <p className={`text-text-secondary ${compact ? "text-[11px]" : "text-xs"}`}>
        The organiser hasn&apos;t drawn up the fixtures yet. Your games appear here once they do.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className={`font-bold text-text-secondary uppercase tracking-wider ${compact ? "text-[10px]" : "text-xs"}`}>
        Your games
      </p>
      {fixtures.map((fx, i) => {
        const isHome = fx.homeTeamId === teamId;
        const opponent = isHome ? fx.awayTeamName : fx.homeTeamName;
        const played = fx.status === "played" && fx.homeScore != null && fx.awayScore != null;
        const myScore = isHome ? fx.homeScore : fx.awayScore;
        const oppScore = isHome ? fx.awayScore : fx.homeScore;
        return (
          <a key={fx.id} href={`/my-team/tournament-match/${fx.id}`}
            className="flex items-center gap-3 bg-surface border border-border rounded-xl px-3 py-2.5">
            <span className="text-[10px] font-bold text-text-secondary w-12 flex-shrink-0">
              {fx.scheduledTime ?? `#${i + 1}`}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">vs {opponent}</p>
              <p className="text-[10px] text-text-secondary">
                {isHome ? "Home" : "Away"}
                {played ? ` · ${myScore}–${oppScore}` : ""}
                {fx.refereeName ? ` · Ref: ${fx.refereeName}` : ""}
              </p>
            </div>
            <span className="text-[11px] font-semibold text-accent-ink flex-shrink-0">
              {isCaptain ? "Set lineup" : "View"}
            </span>
          </a>
        );
      })}
    </div>
  );
}
