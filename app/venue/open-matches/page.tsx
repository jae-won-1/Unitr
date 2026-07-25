"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import TournamentInvitePanel from "@/components/TournamentInvitePanel";

// ── Types ─────────────────────────────────────────────────────
type JoinedTeam = { team_id: string; team_name: string };
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
};

type GameType = "match" | "tournament" | "league";

// ── Deterministic dummy data ──────────────────────────────────
// Progress/results aren't tracked yet (no live stats engine), so we derive
// stable, plausible numbers from each event's id. Same event → same data.
function seedFrom(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILLER_TEAMS = [
  "Hackney Hotspurs", "Dalston FC", "Shoreditch Rovers", "Peckham Town",
  "Camden Athletic", "Brixton United", "Islington City", "Bow Wanderers",
  "Clapton Casuals", "Leyton Orient FS", "Stoke Newington AFC", "Hoxton Albion",
];

const REVIEW_TEXT = [
  "Great pitch and well organised — refs were on point.",
  "Smooth check-in and the surface was top quality.",
  "Good competition, fair scheduling. Will enter again.",
  "Changing rooms could be better but the games were brilliant.",
  "Loved the atmosphere, results posted quickly after each game.",
  "Well run from start to finish, highly recommend.",
];

const TODAY = "2026-06-25";
const isPast = (d: string) => d < TODAY;

// Team names for an event: real registrants first, then deterministic fillers.
function teamNames(ev: EventRow, count: number): string[] {
  const names = ev.joinedTeams.map((t) => t.team_name);
  const pool = FILLER_TEAMS.filter((f) => !names.includes(f));
  let i = seedFrom(ev.id) % Math.max(1, pool.length);
  while (names.length < count && pool.length) {
    names.push(pool[i % pool.length]);
    i++;
  }
  return names.slice(0, count);
}

type StandingRow = {
  name: string; played: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number; isReal: boolean;
};

function buildStandings(ev: EventRow): StandingRow[] {
  const rng = mulberry32(seedFrom(ev.id));
  const realNames = new Set(ev.joinedTeams.map((t) => t.team_name));
  const names = teamNames(ev, Math.max(ev.max_teams, 2));
  const rows: StandingRow[] = names.map((name) => {
    const played = 3 + Math.floor(rng() * 5);            // 3–7
    const w = Math.floor(rng() * (played + 1));
    const l = Math.floor(rng() * (played - w + 1));
    const d = played - w - l;
    const gf = w * 2 + d + Math.floor(rng() * 5);
    const ga = l * 2 + Math.floor(rng() * 4);
    return { name, played, w, d, l, gf, ga, gd: gf - ga, pts: w * 3 + d, isReal: realNames.has(name) };
  });
  rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  return rows;
}

type Fixture = { home: string; away: string; hs: number; as: number; played: boolean; label?: string };

function buildFixtures(ev: EventRow, names: string[], knockout = false): Fixture[] {
  const rng = mulberry32(seedFrom(ev.id) + 99);
  const out: Fixture[] = [];
  const labels = knockout ? ["Quarter-final", "Semi-final", "Final"] : [];
  for (let i = 0; i + 1 < names.length; i += 2) {
    const played = isPast(ev.match_date) || rng() > 0.45;
    out.push({
      home: names[i],
      away: names[i + 1],
      hs: played ? Math.floor(rng() * 5) : 0,
      as: played ? Math.floor(rng() * 5) : 0,
      played,
      label: knockout ? labels[Math.min(labels.length - 1, Math.floor(i / 2))] : undefined,
    });
  }
  return out.slice(0, knockout ? 3 : 5);
}

type Review = { team: string; stars: number; text: string };

function buildReviews(ev: EventRow): { avg: number; count: number; items: Review[] } {
  const rng = mulberry32(seedFrom(ev.id) + 7);
  const names = teamNames(ev, Math.max(ev.max_teams, 3));
  const n = 2 + Math.floor(rng() * 2);
  const items: Review[] = Array.from({ length: n }, (_, i) => ({
    team: names[i % names.length],
    stars: 4 + (rng() > 0.5 ? 1 : 0),
    text: REVIEW_TEXT[(seedFrom(ev.id) + i) % REVIEW_TEXT.length],
  }));
  const avg = items.reduce((s, r) => s + r.stars, 0) / items.length;
  return { avg, count: 6 + (seedFrom(ev.id) % 18), items };
}

// ── Small UI bits ─────────────────────────────────────────────
function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24"
          fill={i <= Math.round(value) ? "#00E676" : "none"} stroke={i <= Math.round(value) ? "#00E676" : "#555"} strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

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

function ReviewsBlock({ ev }: { ev: EventRow }) {
  const { avg, count, items } = useMemo(() => buildReviews(ev), [ev]);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Reviews</p>
        <div className="flex items-center gap-1.5">
          <Stars value={avg} />
          <span className="text-xs font-bold">{avg.toFixed(1)}</span>
          <span className="text-[11px] text-text-secondary">({count})</span>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((r, i) => (
          <div key={i} className="bg-background border border-border rounded-xl px-3 py-2">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-semibold truncate">{r.team}</span>
              <Stars value={r.stars} size={10} />
            </div>
            <p className="text-[11px] text-text-secondary leading-snug">{r.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Match (single game) result card ───────────────────────────
function MatchCard({ ev }: { ev: EventRow }) {
  const [home, away] = teamNames(ev, 2);
  const rng = mulberry32(seedFrom(ev.id) + 5);
  const played = isPast(ev.status === "cancelled" ? "9999-99-99" : ev.match_date);
  const hs = Math.floor(rng() * 5);
  const as = Math.floor(rng() * 5);
  const { avg, count } = useMemo(() => buildReviews(ev), [ev]);

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
          {played ? (
            <span className="text-xl font-bold tabular-nums px-3 py-1 rounded-lg bg-background border border-border">{hs} – {as}</span>
          ) : (
            <span className="text-xs font-semibold text-text-secondary px-3 py-1 rounded-lg bg-background border border-border">vs</span>
          )}
          <span className="flex-1 text-left text-sm font-semibold truncate">{away}</span>
        </div>
      </div>

      <div className="border-t border-border px-4 py-3 flex items-center justify-between">
        <span className="text-[11px] text-text-secondary capitalize">{ev.skill_level}{ev.format ? ` · ${ev.format}` : ""}</span>
        <div className="flex items-center gap-1.5">
          <Stars value={avg} size={11} />
          <span className="text-xs font-bold">{avg.toFixed(1)}</span>
          <span className="text-[11px] text-text-secondary">({count})</span>
        </div>
      </div>
    </div>
  );
}

// ── Tournament / League progress panel ────────────────────────
function CompetitionPanel({ ev }: { ev: EventRow }) {
  const { user } = useAuth();
  const [showInvite, setShowInvite] = useState(false);
  const standings = useMemo(() => buildStandings(ev), [ev]);
  const knockout = ev.match_type === "tournament";
  const fixtures = useMemo(
    () => buildFixtures(ev, standings.map((s) => s.name), knockout),
    [ev, standings, knockout]
  );
  const past = isPast(ev.match_date);
  const champion = standings[0]?.name;
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
        {knockout && past && champion && (
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
                <tr key={r.name + i} className={`border-t border-border/60 ${i < (knockout ? 2 : 3) ? "" : ""}`}>
                  <td className="py-1.5 pr-2">
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                      i === 0 ? "bg-accent/20 text-accent" : "text-text-secondary"
                    }`}>{i + 1}</span>
                  </td>
                  <td className="py-1.5 font-medium truncate max-w-[120px]">
                    {r.name}
                    {r.isReal && <span className="ml-1.5 text-[9px] text-accent/80 align-middle">●</span>}
                  </td>
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
        <p className="text-[10px] text-text-secondary mt-2"><span className="text-accent/80">●</span> Registered via Unitr</p>
      </div>

      {/* Results */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
          {knockout ? "Knockout Results" : "Recent Results"}
        </p>
        <div className="space-y-1.5">
          {fixtures.map((f, i) => (
            <div key={i} className="flex items-center gap-2 bg-background border border-border rounded-xl px-3 py-2">
              {f.label && <span className="text-[9px] font-semibold text-text-secondary uppercase w-20 flex-shrink-0">{f.label}</span>}
              <span className="flex-1 text-right text-xs font-medium truncate">{f.home}</span>
              <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded ${f.played ? "bg-surface-2" : "text-text-secondary"}`}>
                {f.played ? `${f.hs} – ${f.as}` : "vs"}
              </span>
              <span className="flex-1 text-left text-xs font-medium truncate">{f.away}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews */}
      <div className="px-4 py-3 border-t border-border">
        <ReviewsBlock ev={ev} />
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
        const { data: teams } = await supabase.from("open_match_teams")
          .select("team_id, team_name").eq("open_match_id", m.id);
        return { ...(m as Omit<EventRow, "joinedTeams">), joinedTeams: (teams ?? []) as JoinedTeam[] };
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
          Track results, standings and reviews across your games. Create new ones from the{" "}
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
