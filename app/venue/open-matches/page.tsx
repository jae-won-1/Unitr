"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import TournamentInvitePanel from "@/components/TournamentInvitePanel";
import { computeStandings } from "@/lib/standings";

// ── Types ─────────────────────────────────────────────────────
type JoinedTeam = { team_id: string; team_name: string };
type TournamentMatch = {
  id: string;
  round_label: string | null;
  slot_index: number;
  scheduled_time: string | null;
  home_team_id: string | null;
  home_team_name: string | null;
  away_team_id: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string; // 'scheduled' | 'played'
};
type EventRow = {
  id: string;
  title: string;
  match_type: string;          // 'match' | 'tournament' | 'league'
  format: string | null;
  skill_level: string;
  match_date: string;          // ISO "2026-06-27"
  start_time: string;
  end_time: string;
  pitch_name: string;
  max_teams: number;
  status: string;
  price_per_team_pence: number;
  organiser_team_id: string | null;
  joinedTeams: JoinedTeam[];
  fixtures: TournamentMatch[];
};

type GameType = "match" | "tournament" | "league";

const isPast = (d: string) => d < new Date().toISOString().slice(0, 10);

// Standings maths lives in lib/standings.ts, shared with /play/tournament/[id].

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

function StatusPill({ ev }: { ev: EventRow }) {
  const cancelled = ev.status === "cancelled";
  const past = isPast(ev.match_date);
  const label = cancelled ? "Cancelled" : past ? "Completed" : ev.match_type === "match" ? "Upcoming" : "In progress";
  const cls = cancelled ? "bg-red-500/10 text-red-400"
    : past ? "bg-accent/10 text-accent"
    : "bg-yellow-500/15 text-yellow-400";
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cls}`}>{label}</span>;
}

// ── Match (single game) card ───────────────────────────────────
// No score data exists yet for single 'match' open_matches (no results table),
// so this shows the real joined teams and status only — no fabricated score.
function MatchCard({ ev }: { ev: EventRow }) {
  const home = ev.joinedTeams[0]?.team_name ?? "TBC";
  const away = ev.joinedTeams[1]?.team_name ?? "Awaiting opponent";

  return (
    <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{ev.title}</p>
            <p className="text-xs text-text-secondary">{fmtDate(ev.match_date)} · {ev.start_time} · {ev.pitch_name}</p>
          </div>
          <StatusPill ev={ev} />
        </div>

        <div className="flex items-center justify-center gap-4 py-2">
          <span className="flex-1 text-right text-sm font-semibold truncate">{home}</span>
          <span className="text-xs font-semibold text-text-secondary px-3 py-1 rounded-lg bg-background border border-border">vs</span>
          <span className="flex-1 text-left text-sm font-semibold truncate">{away}</span>
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <span className="text-[11px] text-text-secondary capitalize">{ev.skill_level}{ev.format ? ` · ${ev.format}` : ""}</span>
      </div>
    </div>
  );
}

// ── Tournament / League progress panel ────────────────────────
function CompetitionPanel({ ev }: { ev: EventRow }) {
  const { user } = useAuth();
  const [showInvite, setShowInvite] = useState(false);
  const standings = useMemo(() => computeStandings(ev.joinedTeams, ev.fixtures), [ev]);
  const knockout = ev.match_type === "tournament";
  const fixtures = useMemo(
    () => [...ev.fixtures].sort((a, b) => a.slot_index - b.slot_index),
    [ev]
  );
  const past = isPast(ev.match_date);
  const anyPlayed = fixtures.some((f) => f.status === "played");
  const champion = past && anyPlayed ? standings[0]?.name : null;
  // Venue-hosted (not team-hosted), still open with spots → can invite teams.
  const canInvite = !past && ev.status !== "cancelled" && !ev.organiser_team_id && ev.joinedTeams.length < ev.max_teams;

  return (
    <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{ev.title}</p>
            <p className="text-xs text-text-secondary">
              {fmtDate(ev.match_date)} · {ev.pitch_name} · {ev.joinedTeams.length}/{ev.max_teams} teams
            </p>
          </div>
          <StatusPill ev={ev} />
        </div>
        {canInvite && user && (
          <button onClick={() => setShowInvite(true)}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-bold">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>
            Invite teams (discounted)
          </button>
        )}
        {showInvite && user && (
          <TournamentInvitePanel
            openMatchId={ev.id}
            tournamentTitle={ev.title}
            buyInPence={ev.price_per_team_pence}
            inviterUserId={user.id}
            inviterKind="venue"
            inviterName={ev.pitch_name}
            onClose={() => setShowInvite(false)}
          />
        )}
        {champion && (
          <div className="mt-3 flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/><path d="M8 22h8"/><path d="M12 15v7"/>
            </svg>
            <span className="text-xs font-semibold">Champion: <span className="text-accent">{champion}</span></span>
          </div>
        )}
      </div>

      {/* Standings */}
      <div className="px-4 py-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
          {knockout ? "Group Standings" : "League Table"}
        </p>
        {standings.length === 0 ? (
          <p className="text-xs text-text-secondary py-2">No teams have entered yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-xs min-w-[340px]">
              <thead>
                <tr className="text-text-secondary text-[10px] uppercase">
                  <th className="text-left font-medium py-1 pr-2 w-6">#</th>
                  <th className="text-left font-medium py-1">Team</th>
                  {["P", "W", "D", "L", "GD", "Pts"].map((h) => (
                    <th key={h} className={`font-medium py-1 px-1.5 text-center ${h === "Pts" ? "text-text-primary" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {standings.map((r, i) => (
                  <tr key={r.name + i} className="border-t border-border/60">
                    <td className="py-1.5 pr-2">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                        i === 0 ? "bg-accent/20 text-accent" : "text-text-secondary"
                      }`}>{i + 1}</span>
                    </td>
                    <td className="py-1.5 font-medium truncate max-w-[120px]">{r.name}</td>
                    <td className="py-1.5 px-1.5 text-center text-text-secondary">{r.played}</td>
                    <td className="py-1.5 px-1.5 text-center text-text-secondary">{r.w}</td>
                    <td className="py-1.5 px-1.5 text-center text-text-secondary">{r.d}</td>
                    <td className="py-1.5 px-1.5 text-center text-text-secondary">{r.l}</td>
                    <td className="py-1.5 px-1.5 text-center text-text-secondary">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="py-1.5 px-1.5 text-center font-bold">{r.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
          {knockout ? "Knockout Results" : "Recent Results"}
        </p>
        {fixtures.length === 0 ? (
          <p className="text-xs text-text-secondary py-2">No fixtures scheduled yet.</p>
        ) : (
          <div className="space-y-1.5">
            {fixtures.map((f) => (
              <div key={f.id} className="flex items-center gap-2 bg-background border border-border rounded-xl px-3 py-2">
                {f.round_label && <span className="text-[9px] font-semibold text-text-secondary uppercase w-20 flex-shrink-0">{f.round_label}</span>}
                <span className="flex-1 text-right text-xs font-medium truncate">{f.home_team_name ?? "TBC"}</span>
                <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded ${f.status === "played" ? "bg-surface-2" : "text-text-secondary"}`}>
                  {f.status === "played" ? `${f.home_score} – ${f.away_score}` : "vs"}
                </span>
                <span className="flex-1 text-left text-xs font-medium truncate">{f.away_team_name ?? "TBC"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
const TABS: { k: GameType; label: string }[] = [
  { k: "match", label: "Matches" },
  { k: "tournament", label: "Tournaments" },
  { k: "league", label: "League" },
];

export default function VenueProgressPage() {
  const { user } = useAuth();
  const [hasPitches, setHasPitches] = useState<boolean | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<GameType>("match");

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: ps } = await supabase.from("pitches")
        .select("id").eq("venue_owner_id", user!.id);
      setHasPitches((ps ?? []).length > 0);

      const { data: oms } = await supabase.from("open_matches")
        .select("id, title, match_type, format, skill_level, match_date, start_time, end_time, pitch_name, max_teams, status, price_per_team_pence, organiser_team_id")
        .eq("venue_owner_id", user!.id)
        .order("match_date", { ascending: false });

      const withTeams = await Promise.all((oms ?? []).map(async (m) => {
        const [{ data: teams }, { data: fixtures }] = await Promise.all([
          supabase.from("open_match_teams").select("team_id, team_name").eq("open_match_id", m.id),
          m.match_type === "match"
            ? Promise.resolve({ data: [] as TournamentMatch[] })
            : supabase.from("tournament_matches")
                .select("id, round_label, slot_index, scheduled_time, home_team_id, home_team_name, away_team_id, away_team_name, home_score, away_score, status")
                .eq("open_match_id", m.id),
        ]);
        return {
          ...(m as Omit<EventRow, "joinedTeams" | "fixtures">),
          joinedTeams: (teams ?? []) as JoinedTeam[],
          fixtures: (fixtures ?? []) as TournamentMatch[],
        };
      }));
      setEvents(withTeams);
      setLoading(false);
    }
    load();
  }, [user]);

  const counts = useMemo(() => ({
    match: events.filter((e) => e.match_type === "match").length,
    tournament: events.filter((e) => e.match_type === "tournament").length,
    league: events.filter((e) => e.match_type === "league").length,
  }), [events]);

  const visible = events.filter((e) => e.match_type === active);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );

  if (hasPitches === false) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">No pitches registered</p>
      <a href="/pitches/register" className="px-6 py-3 bg-accent text-black rounded-xl font-bold text-sm">Register a Pitch</a>
    </div>
  );

  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold">Progress</h1>
        <p className="text-xs text-text-secondary">
          Track results and standings across your games. Create new ones from the{" "}
          <a href="/venue/calendar" className="text-accent">Calendar</a>.
        </p>
      </div>

      {/* Type toggle */}
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-0.5">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setActive(t.k)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              active === t.k ? "bg-accent text-black" : "text-text-secondary"
            }`}>
            {t.label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active === t.k ? "bg-black/15" : "bg-background"}`}>
              {counts[t.k]}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-12 text-center">
          <p className="text-sm font-semibold mb-1">No {active === "league" ? "leagues" : `${active}es`} yet</p>
          <p className="text-xs text-text-secondary mb-4">
            Set one up from the Calendar and progress will show up here.
          </p>
          <a href="/venue/calendar" className="inline-block px-5 py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
            Go to Calendar
          </a>
        </div>
      ) : active === "match" ? (
        <div className="grid md:grid-cols-2 gap-4">
          {visible.map((ev) => <MatchCard key={ev.id} ev={ev} />)}
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((ev) => <CompetitionPanel key={ev.id} ev={ev} />)}
        </div>
      )}
    </div>
  );
}
