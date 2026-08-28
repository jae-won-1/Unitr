"use client";

// ── Stats ─────────────────────────────────────────────────────────────
// Three views over the same source: Team (the season record), My Stats (the
// viewer's own contribution) and Players (the squad, sortable).
//
// Every number here comes from results a captain actually submitted, via
// lib/stats.ts. Nothing is estimated. That means a team can look at this tab
// having played six games and see nothing at all — which is why the empty state
// says "no results submitted yet" and points at the result form, rather than
// rendering a tidy grid of zeros that reads as "you've scored nothing".

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  loadTeamStats, loadSquadStats, type TeamStats, type PlayerStats,
  EMPTY_TEAM_STATS, emptyPlayerStats,
} from "@/lib/stats";

type SubTab = "team" | "mine" | "players";

type SquadRow = { id: string; name: string; position: string | null; stats: PlayerStats };

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface border border-border rounded-btn p-3 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-text-secondary mt-0.5">{label}</p>
    </div>
  );
}

function Bar({ label, value, max, suffix = "" }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs font-semibold">{value}{suffix}</span>
      </div>
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className="h-1.5 bg-accent rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function NoResults({ isCaptain }: { isCaptain: boolean }) {
  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
      <p className="text-sm font-semibold mb-1">No results submitted yet</p>
      <p className="text-xs text-text-secondary">
        {isCaptain
          ? "Stats appear once you submit a final score from Manage Match."
          : "Stats appear once your captain submits a final score."}
      </p>
    </div>
  );
}

export default function StatsTab({
  teamId, userId, isCaptain,
}: {
  teamId: string;
  userId: string;
  isCaptain: boolean;
}) {
  const [sub, setSub] = useState<SubTab>("team");
  const [team, setTeam] = useState<TeamStats>(EMPTY_TEAM_STATS);
  const [squad, setSquad] = useState<SquadRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [teamStats, squadStats] = await Promise.all([
        loadTeamStats(teamId),
        loadSquadStats(teamId),
      ]);

      // Squad list first, then attach stats — a player with no recorded
      // appearance still belongs in the table, showing zeros rather than
      // vanishing from their own team's stats page.
      const { data: members } = await supabase
        .from("team_members")
        .select("player_id, profiles(full_name, position)")
        .eq("team_id", teamId)
        .eq("status", "approved");

      const { data: captainTeam } = await supabase
        .from("teams").select("captain_id").eq("id", teamId).maybeSingle();

      const ids = new Map<string, { name: string; position: string | null }>();
      for (const m of (members ?? []) as unknown as { player_id: string; profiles: { full_name: string; position: string | null } | null }[]) {
        ids.set(m.player_id, { name: m.profiles?.full_name ?? "Player", position: m.profiles?.position ?? null });
      }
      // The captain has no team_members row (teams.captain_id is the only
      // record of them), so they'd otherwise be missing from their own squad.
      if (captainTeam?.captain_id && !ids.has(captainTeam.captain_id)) {
        const { data: cap } = await supabase
          .from("profiles").select("full_name, position").eq("id", captainTeam.captain_id).maybeSingle();
        ids.set(captainTeam.captain_id, { name: cap?.full_name ?? "Captain", position: cap?.position ?? null });
      }

      const rows: SquadRow[] = [...ids.entries()]
        .map(([id, p]) => ({ id, name: p.name, position: p.position, stats: squadStats.get(id) ?? emptyPlayerStats(id) }))
        .sort((a, b) => b.stats.goals - a.stats.goals || a.name.localeCompare(b.name));

      if (cancelled) return;
      setTeam(teamStats);
      setSquad(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  if (loading) {
    return <div className="py-12 flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  const mine = squad.find((r) => r.id === userId)?.stats ?? emptyPlayerStats(userId);
  const hasResults = team.matchesWithResults > 0;

  return (
    <div className="space-y-4">
      <div className="flex bg-surface-2 border border-border rounded-lg p-0.5 gap-0.5">
        {([["team", "Team"], ["mine", "My Stats"], ["players", "Players"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              sub === k ? "bg-accent text-white" : "text-text-secondary"}`}>
            {label}
          </button>
        ))}
      </div>

      {!hasResults ? (
        <NoResults isCaptain={isCaptain} />
      ) : sub === "team" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <StatTile label="Played" value={team.played} />
            <StatTile label="Won" value={team.won} />
            <StatTile label="Drawn" value={team.drawn} />
            <StatTile label="Lost" value={team.lost} />
          </div>
          <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-3">
            <Bar label="Win rate" value={team.winRate} max={100} suffix="%" />
            <Bar label="Goals for" value={team.goalsFor} max={Math.max(team.goalsFor, team.goalsAgainst, 1)} />
            <Bar label="Goals against" value={team.goalsAgainst} max={Math.max(team.goalsFor, team.goalsAgainst, 1)} />
            <div className="flex items-center justify-between pt-1 border-t border-border">
              <span className="text-xs text-text-secondary">Goal difference</span>
              <span className={`text-xs font-bold ${team.goalDifference >= 0 ? "text-accent-ink" : "text-red-600"}`}>
                {team.goalDifference > 0 ? "+" : ""}{team.goalDifference}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-text-secondary text-center">
            From {team.matchesWithResults} submitted result{team.matchesWithResults === 1 ? "" : "s"}.
          </p>
        </div>
      ) : sub === "mine" ? (
        mine.matchesWithResults === 0 ? (
          <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
            <p className="text-sm font-semibold mb-1">You&apos;re not in a result yet</p>
            <p className="text-xs text-text-secondary">Your stats start once you&apos;re named in a submitted result.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              <StatTile label="Games" value={mine.appearances} />
              <StatTile label="Starts" value={mine.starts} />
              <StatTile label="Goals" value={mine.goals} />
              <StatTile label="Assists" value={mine.assists} />
            </div>
            <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-3">
              <Bar label="Goals per game" value={mine.goalsPerGame} max={Math.max(1, mine.goalsPerGame)} />
              <Bar label="Start rate" value={mine.appearances > 0 ? Math.round((mine.starts / mine.appearances) * 100) : 0} max={100} suffix="%" />
            </div>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {squad.map((r) => (
            <div key={r.id} className="bg-surface border border-border rounded-btn p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                {r.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{r.name}</p>
                <p className="text-[11px] text-text-secondary">{r.position ?? "—"} · {r.stats.appearances} game{r.stats.appearances === 1 ? "" : "s"}</p>
              </div>
              <div className="flex gap-3 text-center flex-shrink-0">
                <div><p className="text-sm font-bold">{r.stats.goals}</p><p className="text-[9px] text-text-secondary">G</p></div>
                <div><p className="text-sm font-bold">{r.stats.assists}</p><p className="text-[9px] text-text-secondary">A</p></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
