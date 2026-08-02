"use client";

import { useCallback, useEffect, useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useTactics } from "@/contexts/TacticsContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import TeamCreditsBar from "@/components/TeamCreditsBar";
import { loadUpcomingTournamentFixtures } from "@/lib/tournament-fixtures";
import { isUpcomingDate, sortKey } from "@/lib/match-dates";

// Highlights "@Full Name" mentions in announcement text for display.
// Validity (matching a real squad member) is enforced at creation time via
// the mention autocomplete, so this just renders any @-prefixed name pattern.
function highlightMentions(text: string) {
  const re = /@([A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, m.index)}</span>);
    parts.push(<span key={key++} className="text-blue-400 font-semibold">{m[0]}</span>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  return parts;
}

type Team = {
  id: string;
  name: string;
  location: string;
  level: string;
  format: string;
  description: string;
  captain_id: string;
  member_count?: number;
};

type JoinRequest = {
  id: string;
  player_id: string;
  status: string;
  profiles: { full_name: string; position: string } | null;
};

// ── Shared dummy squad (still hardcoded — matches backend coming later) ──
const squad = [
  { name: "Marcus Webb", position: "GK", rating: 7.8, avatar: "MW" },
  { name: "Jordan Ellis", position: "CB", rating: 8.1, avatar: "JE" },
  { name: "Tyler Nash", position: "LB", rating: 7.5, avatar: "TN" },
  { name: "Ryan Scott", position: "CM", rating: 8.6, avatar: "RS" },
  { name: "Liam Foster", position: "CAM", rating: 9.0, avatar: "LF" },
  { name: "Devon King", position: "ST", rating: 8.3, avatar: "DK" },
];

const formationDots: Record<string, { x: string; y: string }[]> = {
  "4-3-3": [
    { x: "50%", y: "88%" },
    { x: "15%", y: "72%" }, { x: "35%", y: "74%" }, { x: "65%", y: "74%" }, { x: "85%", y: "72%" },
    { x: "25%", y: "52%" }, { x: "50%", y: "50%" }, { x: "75%", y: "52%" },
    { x: "20%", y: "25%" }, { x: "50%", y: "20%" }, { x: "80%", y: "25%" },
  ],
  "4-4-2": [
    { x: "50%", y: "88%" },
    { x: "15%", y: "72%" }, { x: "35%", y: "74%" }, { x: "65%", y: "74%" }, { x: "85%", y: "72%" },
    { x: "15%", y: "50%" }, { x: "35%", y: "50%" }, { x: "65%", y: "50%" }, { x: "85%", y: "50%" },
    { x: "35%", y: "22%" }, { x: "65%", y: "22%" },
  ],
  "3-5-2": [
    { x: "50%", y: "88%" },
    { x: "25%", y: "72%" }, { x: "50%", y: "74%" }, { x: "75%", y: "72%" },
    { x: "10%", y: "52%" }, { x: "30%", y: "50%" }, { x: "50%", y: "55%" }, { x: "70%", y: "50%" }, { x: "90%", y: "52%" },
    { x: "35%", y: "22%" }, { x: "65%", y: "22%" },
  ],
  "4-2-3-1": [
    { x: "50%", y: "88%" },
    { x: "15%", y: "72%" }, { x: "35%", y: "74%" }, { x: "65%", y: "74%" }, { x: "85%", y: "72%" },
    { x: "35%", y: "58%" }, { x: "65%", y: "58%" },
    { x: "18%", y: "38%" }, { x: "50%", y: "36%" }, { x: "82%", y: "38%" },
    { x: "50%", y: "18%" },
  ],
};

// ── Browse Teams (new users + players without a team) ─────────
function BrowseTeams({ onJoinRequest }: { onJoinRequest?: (teamId: string) => void }) {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    supabase
      .from("teams")
      .select("*")
      .then(({ data }) => {
        setTeams(data ?? []);
        setLoading(false);
      });
  }, []);

  const handleRequest = async (teamId: string) => {
    if (!user) return;
    await supabase.from("team_members").insert({ team_id: teamId, player_id: user.id });
    setRequested((prev) => new Set([...prev, teamId]));
    onJoinRequest?.(teamId);
  };

  const filtered = filter === "All" ? teams : teams.filter((t) => t.level === filter);

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading teams…</div>;

  return (
    <div className="space-y-4">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" placeholder="Search teams or locations..." className="w-full bg-surface-2 border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["All", "Casual", "Competitive", "Semi-Pro"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${filter === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{f}</button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-text-secondary">No teams found yet.</p>
          <p className="text-xs text-text-secondary mt-1">Be the first to register one!</p>
        </div>
      )}

      {filtered.map((team) => (
        <div key={team.id} className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-accent">{team.name.split(" ").map((w: string) => w[0]).join("").slice(0,2)}</span>
              </div>
              <div>
                <p className="font-semibold">{team.name}</p>
                <p className="text-xs text-text-secondary mt-0.5">{team.location}</p>
              </div>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-lg flex-shrink-0 ${team.level === "Casual" ? "bg-blue-500/10 text-blue-400" : team.level === "Competitive" ? "bg-orange-500/10 text-orange-400" : "bg-purple-500/10 text-purple-400"}`}>{team.level}</span>
          </div>
          {team.description && <p className="text-xs text-text-secondary mb-3">{team.description}</p>}
          <div className="flex items-center gap-2 mb-4 text-xs text-text-secondary">
            <span className="bg-surface border border-border px-2 py-0.5 rounded-md">{team.format}</span>
          </div>
          <div className="flex gap-2">
            <button className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-center text-text-secondary">View Profile</button>
            <button
              disabled={requested.has(team.id)}
              onClick={() => handleRequest(team.id)}
              className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-60"
            >
              {requested.has(team.id) ? "Request Sent" : "Request to Join"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── New User My Team ──────────────────────────────────────────
function NewUserMyTeam() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <a href="/my-team/create"
          className="bg-accent text-black rounded-2xl p-4 flex flex-col gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <p className="text-sm font-bold">Register Your Team</p>
          <p className="text-xs font-normal opacity-70">Set up your team as captain</p>
        </a>
        <div className="bg-surface-2 border border-border rounded-2xl p-4 flex flex-col gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <p className="text-sm font-bold">Find a Team</p>
          <p className="text-xs text-text-secondary">Request to join below</p>
        </div>
      </div>
      <BrowseTeams />
    </div>
  );
}

type ConfirmedFixture = {
  postId: string;
  matchRowId: string | null;
  opponent: string;
  date: string;
  time: string;
  pitch: string;
  paymentStatus: "paid" | "unpaid";
  kind: "match" | "tournament";
  title?: string;
};

type HostedTournament = {
  id: string;
  title: string;
  match_date: string;
  start_time: string;
  pitch_name: string;
  status: string;
  joinedCount: number;
  max_teams: number;
};

// Tournaments this team's captain has posted (organiser_team_id = own team),
// so the captain can jump straight to the existing manage page for each one.
function useHostedTournaments(teamId?: string) {
  const [tournaments, setTournaments] = useState<HostedTournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) { setTournaments([]); setLoading(false); return; }
    async function load() {
      const { data: oms } = await supabase
        .from("open_matches")
        .select("id, title, match_date, start_time, pitch_name, status, max_teams")
        .eq("match_type", "tournament")
        .eq("organiser_team_id", teamId)
        .neq("status", "cancelled")
        .order("match_date", { ascending: true });

      const withCounts = await Promise.all((oms ?? []).map(async (m) => {
        const { count } = await supabase
          .from("open_match_teams").select("id", { count: "exact", head: true }).eq("open_match_id", m.id);
        return { ...m, joinedCount: count ?? 0 } as HostedTournament;
      }));
      setTournaments(withCounts);
      setLoading(false);
    }
    load();
  }, [teamId]);

  return { tournaments, loading };
}

// match_posts/challenges only carry the post id — Manage Match needs the matches.id row instead.
async function attachMatchRowIds<T extends { postId: string }>(fixtures: T[]): Promise<(T & { matchRowId: string | null })[]> {
  if (fixtures.length === 0) return [];
  const { data: rows } = await supabase.from("matches").select("id, post_id").in("post_id", fixtures.map((f) => f.postId));
  const byPostId = new Map((rows ?? []).map((r) => [r.post_id, r.id]));
  return fixtures.map((f) => ({ ...f, matchRowId: byPostId.get(f.postId) ?? null }));
}

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

// ── Player My Team ────────────────────────────────────────────
function PlayerMyTeam() {
  const { tactics } = useTactics();
  const { user } = useAuth();
  const dots = formationDots[tactics.formation] ?? formationDots["4-3-3"];
  const teamMedia = tactics.media.filter((m) => !m.matchId);
  const [myTeam, setMyTeam] = useState<Team | null | undefined>(undefined);
  const [fixtures, setFixtures] = useState<ConfirmedFixture[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [fixtureView, setFixtureView] = useState<"upcoming" | "past">("upcoming");
  const [fixturesExpanded, setFixturesExpanded] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [availabilityRequest, setAvailabilityRequest] = useState<{ id: string; date_options: { id: string; date: string; time: string; dayName: string }[] } | null>(null);
  const [availabilityResponses, setAvailabilityResponses] = useState<{ available_date_ids: string[] }[]>([]);
  const [myResponse, setMyResponse] = useState<string[] | null>(null); // null = not voted
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [unavailableSelected, setUnavailableSelected] = useState(false);
  const [submittingVote, setSubmittingVote] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("team_members")
      .select("team_id")
      .eq("player_id", user.id)
      .eq("status", "approved")
      .maybeSingle()
      .then(async ({ data: membership }) => {
        if (!membership?.team_id) { setMyTeam(null); return; }
        const { data: team } = await supabase.from("teams").select("*").eq("id", membership.team_id).maybeSingle();
        setMyTeam(team ?? null);
      });
  }, [user]);

  useEffect(() => {
    if (!myTeam || !user) return;
    supabase.from("availability_requests").select("id, date_options, created_at")
      .eq("team_id", myTeam.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(async ({ data: req }) => {
        setAvailabilityRequest(req ?? null);
        if (req) {
          const [{ data: resps }, { data: mine }] = await Promise.all([
            supabase.from("availability_responses").select("available_date_ids").eq("request_id", req.id),
            supabase.from("availability_responses").select("available_date_ids").eq("request_id", req.id).eq("player_id", user.id).maybeSingle(),
          ]);
          setAvailabilityResponses(resps ?? []);
          setMyResponse(mine ? mine.available_date_ids : null);
        }
      });
  }, [myTeam, user]);

  useEffect(() => {
    if (myTeam === undefined) return;
    if (!myTeam) { setFixturesLoading(false); return; }
    async function loadFixtures() {
      const captainId = myTeam!.captain_id;

      const { data: myPosts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched");

      const posterFixtures = await Promise.all(
        (myPosts ?? []).map(async (post) => {
          const { data: ch } = await supabase.from("challenges")
            .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
          return {
            postId: post.id,
            opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
            date: post.match_date,
            time: post.match_time,
            pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
          };
        })
      );

      const { data: myChallenges } = await supabase.from("challenges")
        .select("post_id, selected_pitch").eq("challenger_captain_id", captainId).eq("status", "accepted");

      const challengerFixtures = await Promise.all(
        (myChallenges ?? []).map(async (c) => {
          const { data: post } = await supabase.from("match_posts")
            .select("id, team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
          return {
            postId: c.post_id,
            opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
            date: (post as { match_date: string } | null)?.match_date ?? "",
            time: (post as { match_time: string } | null)?.match_time ?? "",
            pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
          };
        })
      );

      const allFixtures = await attachMatchRowIds([...posterFixtures, ...challengerFixtures]);
      const { data: payments } = await supabase.from("player_payments")
        .select("booking_id").eq("player_id", user!.id).eq("status", "paid")
        .in("booking_id", allFixtures.map((f) => f.postId));
      const paidIds = new Set((payments ?? []).map((p) => p.booking_id));

      const matchFixtures: ConfirmedFixture[] = allFixtures.map((f) =>
        ({ ...f, paymentStatus: paidIds.has(f.postId) ? "paid" : "unpaid", kind: "match" }) as ConfirmedFixture);

      const tournaments = await loadUpcomingTournamentFixtures(myTeam!.id);
      const tournamentFixtures: ConfirmedFixture[] = tournaments.map((t) => ({
        postId: t.id,
        matchRowId: null,
        opponent: "",
        date: t.date,
        time: t.time,
        pitch: t.pitch,
        paymentStatus: "paid",
        kind: "tournament",
        title: t.title,
      }));

      setFixtures([...matchFixtures, ...tournamentFixtures]);
      setFixturesLoading(false);
    }
    loadFixtures();
  }, [myTeam]);

  if (myTeam === undefined) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  if (myTeam === null) {
    return (
      <div className="space-y-4">
        <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
          <p className="font-semibold mb-1">You&apos;re not in a team yet</p>
          <p className="text-xs text-text-secondary mb-4">Request to join a team below or wait for a captain to approve your request.</p>
        </div>
        <BrowseTeams />
      </div>
    );
  }

  const initials = myTeam.name.split(" ").map((w: string) => w[0]).join("").slice(0,2);
  // Upcoming: nearest first. Past: most recent first, going back in time.
  // Dates are normalised first — legacy rows store "Wed, 03 JUN 2026", which
  // compares greater than any ISO date and would never leave Upcoming.
  const shownFixtures = fixtures
    .filter((f) => (fixtureView === "past" ? !isUpcomingDate(f.date) : isUpcomingDate(f.date)))
    .sort((a, b) => {
      const ka = sortKey(a.date, a.time), kb = sortKey(b.date, b.time);
      return fixtureView === "past" ? kb.localeCompare(ka) : ka.localeCompare(kb);
    });
  const visibleFixtures = fixturesExpanded ? shownFixtures : shownFixtures.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Team card */}
      <section className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-accent font-bold text-sm">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-lg">{myTeam.name}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{myTeam.level} · {myTeam.format}</p>
            <div className="flex gap-3 mt-1.5">
              <span className="text-lg font-bold text-green-400">0W</span>
              <span className="text-lg font-bold text-yellow-400">0D</span>
              <span className="text-lg font-bold text-red-400">0L</span>
            </div>
          </div>
          <button onClick={() => setBookmarked((b) => !b)} className="flex-shrink-0 p-1">
            <svg width="22" height="22" viewBox="0 0 24 24"
              fill={bookmarked ? "#00E676" : "none"}
              stroke={bookmarked ? "#00E676" : "#9E9E9E"}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
      </section>

      {/* Availability Status */}
      {availabilityRequest && !isPollExpired(availabilityRequest.date_options) && (
        <section className="bg-accent/5 border border-accent/20 rounded-2xl px-4 py-4">
          <h3 className="text-base font-bold mb-3">Availability Status</h3>

          {myResponse === null ? (
            /* ── Voting UI ── */
            <div className="space-y-2">
              {availabilityRequest.date_options.map((opt) => {
                const picked = selectedDates.includes(opt.id);
                const disabled = unavailableSelected;
                return (
                  <button key={opt.id} type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setSelectedDates((prev) =>
                        prev.includes(opt.id) ? prev.filter((d) => d !== opt.id) : [...prev, opt.id]
                      );
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors
                      ${picked ? "bg-accent/10 border-accent" : disabled ? "bg-surface-2 border-border opacity-40 cursor-not-allowed" : "bg-surface-2 border-border"}`}>
                    <div>
                      <p className={`text-sm font-semibold ${picked ? "text-accent" : ""}`}>{opt.dayName} · {opt.time}</p>
                      <p className="text-[10px] text-text-secondary mt-0.5">{opt.date}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${picked ? "border-accent bg-accent" : "border-border"}`}>
                      {picked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                  </button>
                );
              })}

              <button type="button"
                disabled={selectedDates.length > 0}
                onClick={() => { if (selectedDates.length === 0) setUnavailableSelected((v) => !v); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors
                  ${unavailableSelected ? "bg-red-500/10 border-red-400" : selectedDates.length > 0 ? "bg-surface-2 border-border opacity-40 cursor-not-allowed" : "bg-surface-2 border-border"}`}>
                <p className={`text-sm font-semibold ${unavailableSelected ? "text-red-400" : "text-text-secondary"}`}>
                  Unavailable for any of these dates
                </p>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${unavailableSelected ? "border-red-400 bg-red-400" : "border-border"}`}>
                  {unavailableSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
              </button>

              <button
                disabled={selectedDates.length === 0 && !unavailableSelected || submittingVote}
                onClick={async () => {
                  if (!user || !availabilityRequest) return;
                  setSubmittingVote(true);
                  const ids = unavailableSelected ? [] : selectedDates;
                  await supabase.from("availability_responses").upsert(
                    { request_id: availabilityRequest.id, player_id: user.id, available_date_ids: ids },
                    { onConflict: "request_id,player_id" }
                  );
                  const { data: resps } = await supabase.from("availability_responses")
                    .select("available_date_ids").eq("request_id", availabilityRequest.id);
                  setAvailabilityResponses(resps ?? []);
                  setMyResponse(ids);
                  setSubmittingVote(false);
                }}
                className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1">
                {submittingVote
                  ? <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Submitting…</>
                  : "Submit"}
              </button>
            </div>
          ) : (
            /* ── Results UI ── */
            <div className="space-y-2">
              {availabilityRequest.date_options.map((opt) => {
                const votes = availabilityResponses.filter((r) => r.available_date_ids.includes(opt.id)).length;
                const total = availabilityResponses.length;
                const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                return (
                  <div key={opt.id} className="bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold">{opt.dayName} · {opt.time}</p>
                      <span className="text-xs font-bold text-accent">{votes} vote{votes !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full">
                      <div className="h-1.5 bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1">{opt.date}</p>
                  </div>
                );
              })}
              {(() => {
                const unavailableCount = availabilityResponses.filter((r) => r.available_date_ids.length === 0).length;
                const total = availabilityResponses.length;
                const pct = total > 0 ? Math.round((unavailableCount / total) * 100) : 0;
                return (
                  <div className="bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold text-text-secondary">Unavailable for any of these dates</p>
                      <span className="text-xs font-bold text-red-400">{unavailableCount} vote{unavailableCount !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full">
                      <div className="h-1.5 bg-red-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}
              {availabilityResponses.length === 0 && (
                <p className="text-xs text-text-secondary py-1">No responses yet.</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Fixtures */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Fixtures</h3>
          <div className="flex bg-surface-2 border border-border rounded-lg p-0.5 gap-0.5">
            {(["upcoming", "past"] as const).map((v) => (
              <button key={v} onClick={() => { setFixtureView(v); setFixturesExpanded(false); }}
                className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${fixtureView === v ? "bg-accent text-black" : "text-text-secondary"}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {fixturesLoading ? (
          <div className="py-4 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : shownFixtures.length === 0 ? (
          <p className="text-sm text-text-secondary py-2">{fixtureView === "upcoming" ? "No upcoming fixtures yet." : "No past matches yet."}</p>
        ) : (
          <div className="space-y-3">
            {visibleFixtures.map((f) => (
              <div key={f.postId} className="bg-surface-2 border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{f.kind === "tournament" ? f.title : `vs ${f.opponent}`}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      {f.date} · {f.time}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {f.pitch}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {f.kind === "tournament"
                      ? <span className="text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full">Tournament</span>
                      : fixtureView === "past"
                        ? <span className="text-[10px] font-semibold bg-surface text-text-secondary border border-border px-2 py-0.5 rounded-full">Played</span>
                        : <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">Confirmed</span>}
                    {f.kind !== "tournament" && (f.paymentStatus === "paid"
                      ? <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">Paid ✓</span>
                      : fixtureView === "past"
                        ? <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full">Share due</span>
                        : null)}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <a href={f.kind === "tournament" ? `/play/tournament/${f.postId}` : `/my-team/match/${f.matchRowId ?? f.postId}`}
                    className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary text-center">View Details</a>
                </div>
              </div>
            ))}
            {shownFixtures.length > 3 && (
              <button
                onClick={() => setFixturesExpanded((e) => !e)}
                className="w-full py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary"
              >
                {fixturesExpanded ? "See less" : `See more (${shownFixtures.length - 3})`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Team Tactics */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Team Tactics</h3>
          <span className="text-xs text-text-secondary">Set by captain</span>
        </div>
        <div className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="relative w-full rounded-xl overflow-hidden mb-4" style={{ paddingBottom: "60%", background: "linear-gradient(180deg, #1a5c1a 0%, #1e6b1e 50%, #1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none">
              <rect x="3" y="3" width="94" height="54" rx="1" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <line x1="3" y1="30" x2="97" y2="30" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <circle cx="50" cy="30" r="8" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <rect x="20" y="3" width="60" height="14" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <rect x="20" y="43" width="60" height="14" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
            </svg>
            {dots.map((pos, i) => (
              <div key={i} className="absolute w-4 h-4 rounded-full bg-accent border border-white shadow" style={{ left: pos.x, top: pos.y, transform: "translate(-50%,-50%)" }} />
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-lg font-bold">{tactics.formation}</span>
            {tactics.style && <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-2 py-1 rounded-lg font-semibold">{tactics.style}</span>}
            {tactics.pressing && <span className="text-xs bg-surface border border-border px-2 py-1 rounded-lg text-text-secondary">{tactics.pressing} Press</span>}
          </div>
          {tactics.notes && (
            <div className="bg-background rounded-xl p-3 mb-3">
              <p className="text-xs font-semibold text-text-secondary mb-1">Captain&apos;s Notes</p>
              <p className="text-xs text-text-secondary leading-relaxed">{tactics.notes}</p>
            </div>
          )}
          {teamMedia.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2">Tactics Media</p>
              <div className="space-y-2">
                {teamMedia.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 bg-background rounded-xl px-3 py-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.type === "video" ? "bg-purple-500/15" : "bg-blue-500/15"}`}>
                      {item.type === "video"
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
                    </div>
                    <p className="text-xs font-medium flex-1 truncate">{item.label}</p>
                    <span className="text-[10px] text-text-secondary capitalize">{item.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Match Media */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Match Media</h3>
        <div className="space-y-3">
          {[
            { id: "v1", title: "Full Match — vs Regents FC", date: "Feb 15, 2026", duration: "1:32:10", type: "full" },
            { id: "v2", title: "Highlights — vs Regents FC", date: "Feb 15, 2026", duration: "4:22", type: "highlights" },
          ].map((video) => (
            <div key={video.id} className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
              <div className="relative w-full" style={{ paddingBottom: "52%", background: "linear-gradient(135deg, #0d1b2a 0%, #1b2a3b 50%, #0a1628 100%)" }}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-black/40 border border-white/20 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">{video.duration}</div>
                <div className="absolute top-2 left-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${video.type === "full" ? "bg-blue-500/80 text-white" : "bg-purple-500/80 text-white"}`}>
                    {video.type === "full" ? "Full Match" : "Highlights"}
                  </span>
                </div>
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-semibold">{video.title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{video.date}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Squad */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Squad ({squad.length})</h3>
        <div className="space-y-2">
          {squad.map((p) => (
            <div key={p.name} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-text-secondary">{p.avatar}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-text-secondary">{p.position}</p>
              </div>
              <span className="text-sm font-bold text-accent">{p.rating}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Find Match Button ─────────────────────────────────────────
// Posting goes through the ranked-pitch (split) flow: the captain posts up to
// 3 preferred pitches and the opponent picks one. Teams who'd rather lock a
// pitch in first do that from the Book tab and turn the booking into a post.
function FindMatchButton() {
  return (
    <a
      href="/play/create"
      onClick={() => localStorage.setItem("unitr_payment_mode", "individual")}
      className="block w-full py-2.5 rounded-xl bg-accent text-black text-sm font-bold text-center"
    >
      Post Match
    </a>
  );
}

// ── Captain My Team ───────────────────────────────────────────
function CaptainMyTeam() {
  const { user } = useAuth();
  const [myTeam, setMyTeam] = useState<Team | null | undefined>(undefined);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<ConfirmedFixture[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [fixtureView, setFixtureView] = useState<"upcoming" | "past">("upcoming");
  const [fixturesExpanded, setFixturesExpanded] = useState(false);
  const [availabilityRequest, setAvailabilityRequest] = useState<{ id: string; date_options: { id: string; date: string; time: string; dayName: string }[]; created_at: string } | null>(null);
  const [availabilityResponses, setAvailabilityResponses] = useState<{ available_date_ids: string[] }[]>([]);
  const [myResponse, setMyResponse] = useState<string[] | null>(null);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [unavailableSelected, setUnavailableSelected] = useState(false);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [deletingPoll, setDeletingPoll] = useState(false);
  const [confirmDeletePoll, setConfirmDeletePoll] = useState(false);
  const { tournaments: hostedTournaments, loading: hostedTournamentsLoading } = useHostedTournaments(myTeam?.id);

  useEffect(() => {
    if (!user) return;
    supabase.from("teams").select("*").eq("captain_id", user.id).maybeSingle()
      .then(({ data }) => setMyTeam(data ?? null));
  }, [user]);

  useEffect(() => {
    if (!myTeam) return;
    supabase.from("team_members").select("id, player_id, status, profiles(full_name, position)")
      .eq("team_id", myTeam.id).eq("status", "pending")
      .then(({ data }) => setRequests((data as unknown as JoinRequest[]) ?? []));

    // Load latest availability request + responses
    supabase.from("availability_requests").select("id, date_options, created_at")
      .eq("team_id", myTeam.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(async ({ data: req }) => {
        if (req && isPollExpired(req.date_options)) {
          await fetch("/api/availability/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: req.id, captainId: user!.id }),
          });
          setAvailabilityRequest(null);
          return;
        }
        setAvailabilityRequest(req ?? null);
        if (req) {
          const [{ data: resps }, { data: mine }] = await Promise.all([
            supabase.from("availability_responses").select("available_date_ids").eq("request_id", req.id),
            supabase.from("availability_responses").select("available_date_ids").eq("request_id", req.id).eq("player_id", user!.id).maybeSingle(),
          ]);
          setAvailabilityResponses(resps ?? []);
          setMyResponse(mine ? mine.available_date_ids : null);
        }
      });
  }, [myTeam]);

  useEffect(() => {
    if (!user) return;
    async function loadFixtures() {
      // Matches where user is the poster
      const { data: myPosts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", user!.id).eq("status", "matched");

      const posterFixtures = await Promise.all(
        (myPosts ?? []).map(async (post) => {
          const { data: ch } = await supabase.from("challenges")
            .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
          return {
            postId: post.id,
            opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
            date: post.match_date,
            time: post.match_time,
            pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
          };
        })
      );

      // Matches where user challenged
      const { data: myChallenges } = await supabase.from("challenges")
        .select("post_id, selected_pitch").eq("challenger_captain_id", user!.id).eq("status", "accepted");

      const challengerFixtures = await Promise.all(
        (myChallenges ?? []).map(async (c) => {
          const { data: post } = await supabase.from("match_posts")
            .select("id, team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
          return {
            postId: c.post_id,
            opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
            date: (post as { match_date: string } | null)?.match_date ?? "",
            time: (post as { match_time: string } | null)?.match_time ?? "",
            pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
          };
        })
      );

      const allFixtures = await attachMatchRowIds([...posterFixtures, ...challengerFixtures]);
      const { data: payments } = await supabase.from("player_payments")
        .select("booking_id").eq("player_id", user!.id).eq("status", "paid")
        .in("booking_id", allFixtures.map((f) => f.postId));
      const paidIds = new Set((payments ?? []).map((p) => p.booking_id));

      const matchFixtures: ConfirmedFixture[] = allFixtures.map((f) =>
        ({ ...f, paymentStatus: paidIds.has(f.postId) ? "paid" : "unpaid", kind: "match" }) as ConfirmedFixture);

      const { data: ownTeam } = await supabase.from("teams").select("id").eq("captain_id", user!.id).maybeSingle();
      const tournaments = await loadUpcomingTournamentFixtures(ownTeam?.id);
      const tournamentFixtures: ConfirmedFixture[] = tournaments.map((t) => ({
        postId: t.id,
        matchRowId: null,
        opponent: "",
        date: t.date,
        time: t.time,
        pitch: t.pitch,
        paymentStatus: "paid",
        kind: "tournament",
        title: t.title,
      }));

      setFixtures([...matchFixtures, ...tournamentFixtures]);
      setFixturesLoading(false);
    }
    loadFixtures();
  }, [user]);

  const handleRequest = async (requestId: string, status: "approved" | "rejected") => {
    setUpdatingId(requestId);
    await supabase.from("team_members").update({ status }).eq("id", requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    setUpdatingId(null);
  };

  if (myTeam === undefined) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  if (myTeam === null) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <p className="font-semibold">No team registered yet</p>
        <p className="text-sm text-text-secondary max-w-[240px]">Register your team on Unitr to start finding opponents and managing your squad.</p>
        <a href="/my-team/create" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm">Register Your Team</a>
      </div>
    );
  }

  const initials = myTeam.name.split(" ").map((w: string) => w[0]).join("").slice(0,2);
  // Upcoming: nearest first. Past: most recent first, going back in time.
  // Dates are normalised first — legacy rows store "Wed, 03 JUN 2026", which
  // compares greater than any ISO date and would never leave Upcoming.
  const shownFixtures = fixtures
    .filter((f) => (fixtureView === "past" ? !isUpcomingDate(f.date) : isUpcomingDate(f.date)))
    .sort((a, b) => {
      const ka = sortKey(a.date, a.time), kb = sortKey(b.date, b.time);
      return fixtureView === "past" ? kb.localeCompare(ka) : ka.localeCompare(kb);
    });
  const visibleFixtures = fixturesExpanded ? shownFixtures : shownFixtures.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Team card */}
      <section className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-accent font-bold text-sm">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-lg">{myTeam.name}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{myTeam.level} · {myTeam.format} · Captain</p>
            <div className="flex gap-3 mt-1.5">
              <span className="text-lg font-bold text-green-400">0W</span>
              <span className="text-lg font-bold text-yellow-400">0D</span>
              <span className="text-lg font-bold text-red-400">0L</span>
            </div>
          </div>
        </div>
        {availabilityRequest && !isPollExpired(availabilityRequest.date_options) && (
          <div className="bg-accent/5 border border-accent/20 rounded-2xl px-4 py-4 mb-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold">Availability Status</h3>
              <button
                type="button"
                disabled={deletingPoll}
                onClick={() => setConfirmDeletePoll(true)}
                className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deletingPoll ? (
                  <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                )}
              </button>
              {confirmDeletePoll && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
                  <div className="bg-surface-2 border border-border rounded-2xl p-6 w-full max-w-xs shadow-xl">
                    <h3 className="text-base font-bold mb-1">Remove Poll?</h3>
                    <p className="text-sm text-text-secondary mb-5">This will delete the availability poll and all responses. This cannot be undone.</p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setConfirmDeletePoll(false)}
                        className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!availabilityRequest || !user) return;
                          setConfirmDeletePoll(false);
                          setDeletingPoll(true);
                          await fetch("/api/availability/delete", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ requestId: availabilityRequest.id, captainId: user.id }),
                          });
                          setAvailabilityRequest(null);
                          setAvailabilityResponses([]);
                          setMyResponse(null);
                          setSelectedDates([]);
                          setUnavailableSelected(false);
                          setDeletingPoll(false);
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold"
                      >
                        Yes, Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {myResponse === null ? (
              <div className="space-y-2">
                {availabilityRequest.date_options.map((opt) => {
                  const picked = selectedDates.includes(opt.id);
                  const disabled = unavailableSelected;
                  return (
                    <button key={opt.id} type="button" disabled={disabled}
                      onClick={() => { if (disabled) return; setSelectedDates((prev) => prev.includes(opt.id) ? prev.filter((d) => d !== opt.id) : [...prev, opt.id]); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors ${picked ? "bg-accent/10 border-accent" : disabled ? "bg-surface-2 border-border opacity-40 cursor-not-allowed" : "bg-surface-2 border-border"}`}>
                      <div>
                        <p className={`text-sm font-semibold ${picked ? "text-accent" : ""}`}>{opt.dayName} · {opt.time}</p>
                        <p className="text-[10px] text-text-secondary mt-0.5">{opt.date}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${picked ? "border-accent bg-accent" : "border-border"}`}>
                        {picked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                    </button>
                  );
                })}
                <button type="button" disabled={selectedDates.length > 0}
                  onClick={() => { if (selectedDates.length === 0) setUnavailableSelected((v) => !v); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors ${unavailableSelected ? "bg-red-500/10 border-red-400" : selectedDates.length > 0 ? "bg-surface-2 border-border opacity-40 cursor-not-allowed" : "bg-surface-2 border-border"}`}>
                  <p className={`text-sm font-semibold ${unavailableSelected ? "text-red-400" : "text-text-secondary"}`}>Unavailable for any of these dates</p>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${unavailableSelected ? "border-red-400 bg-red-400" : "border-border"}`}>
                    {unavailableSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                </button>
                <button
                  disabled={(selectedDates.length === 0 && !unavailableSelected) || submittingVote}
                  onClick={async () => {
                    if (!user || !availabilityRequest) return;
                    setSubmittingVote(true);
                    const ids = unavailableSelected ? [] : selectedDates;
                    await supabase.from("availability_responses").upsert(
                      { request_id: availabilityRequest.id, player_id: user.id, available_date_ids: ids },
                      { onConflict: "request_id,player_id" }
                    );
                    const { data: resps } = await supabase.from("availability_responses").select("available_date_ids").eq("request_id", availabilityRequest.id);
                    setAvailabilityResponses(resps ?? []);
                    setMyResponse(ids);
                    setSubmittingVote(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1">
                  {submittingVote ? <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Submitting…</> : "Submit"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {availabilityRequest.date_options.map((opt) => {
                  const votes = availabilityResponses.filter((r) => r.available_date_ids.includes(opt.id)).length;
                  const total = availabilityResponses.length;
                  const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                  return (
                    <div key={opt.id} className="bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-semibold">{opt.dayName} · {opt.time}</p>
                        <span className="text-xs font-bold text-accent">{votes} vote{votes !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="w-full h-1.5 bg-background rounded-full">
                        <div className="h-1.5 bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-text-secondary mt-1">{opt.date}</p>
                    </div>
                  );
                })}
                {(() => {
                  const unavailableCount = availabilityResponses.filter((r) => r.available_date_ids.length === 0).length;
                  const total = availabilityResponses.length;
                  const pct = total > 0 ? Math.round((unavailableCount / total) * 100) : 0;
                  return (
                    <div className="bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-semibold text-text-secondary">Unavailable for any of these dates</p>
                        <span className="text-xs font-bold text-red-400">{unavailableCount} vote{unavailableCount !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="w-full h-1.5 bg-background rounded-full">
                        <div className="h-1.5 bg-red-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })()}
                {availabilityResponses.length === 0 && (
                  <p className="text-xs text-text-secondary py-1">No responses yet.</p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 mt-3">
          {availabilityRequest ? (
            <span className="flex-1 py-2.5 rounded-xl border border-border text-text-secondary/50 text-sm font-semibold text-center cursor-not-allowed select-none">
              Collect Availability
            </span>
          ) : (
            <a href="/my-team/collect-availability" className="flex-1 py-2.5 rounded-xl border border-accent/40 text-accent text-sm font-semibold text-center">
              Collect Availability
            </a>
          )}
          <div className="flex-1">
            <FindMatchButton />
          </div>
        </div>
      </section>

      {/* Captain actions */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Manage</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Team Management", icon: "👥", href: "/my-team/players" },
            { label: "Post Announcement", icon: "📋", href: "/my-team/announcement/create" },
            { label: "Calendar", icon: "📅", href: "/my-team/availability" },
            { label: "Team Profile", icon: "⚙️", href: "/my-team/team-profile" },
          ].map((a) => (
            <a key={a.label} href={a.href}
              className="bg-surface-2 border border-border rounded-xl p-4 flex flex-col gap-2">
              <span className="text-2xl">{a.icon}</span>
              <p className="text-sm font-semibold">{a.label}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Join requests */}
      {requests.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Join Requests</h3>
            <span className="text-xs font-bold bg-accent text-black px-2 py-0.5 rounded-full">{requests.length}</span>
          </div>
          <div className="space-y-2">
            {requests.map((req) => (
              <div key={req.id} className="bg-surface-2 border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-accent">
                    {req.profiles?.full_name?.split(" ").map((w) => w[0]).join("").slice(0,2) ?? "?"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{req.profiles?.full_name ?? "Unknown player"}</p>
                  <p className="text-xs text-text-secondary">{req.profiles?.position ?? "—"}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button disabled={updatingId === req.id} onClick={() => handleRequest(req.id, "rejected")}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary disabled:opacity-40">Decline</button>
                  <button disabled={updatingId === req.id} onClick={() => handleRequest(req.id, "approved")}
                    className="px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-40">Approve</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fixtures */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Fixtures</h3>
          <div className="flex bg-surface-2 border border-border rounded-lg p-0.5 gap-0.5">
            {(["upcoming", "past"] as const).map((v) => (
              <button key={v} onClick={() => { setFixtureView(v); setFixturesExpanded(false); }}
                className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${fixtureView === v ? "bg-accent text-black" : "text-text-secondary"}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {fixturesLoading ? (
          <div className="py-4 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : shownFixtures.length === 0 ? (
          <p className="text-sm text-text-secondary py-2">{fixtureView === "upcoming" ? "No upcoming fixtures yet." : "No past matches yet."}</p>
        ) : (
          <div className="space-y-2">
            {visibleFixtures.map((f) => (
              <div key={f.postId} className="bg-surface-2 border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{f.kind === "tournament" ? f.title : `vs ${f.opponent}`}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      {f.date} · {f.time}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {f.pitch}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {f.kind === "tournament"
                      ? <span className="text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full">Tournament</span>
                      : fixtureView === "past"
                        ? <span className="text-[10px] font-semibold bg-surface text-text-secondary border border-border px-2 py-0.5 rounded-full">Played</span>
                        : <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">Confirmed</span>}
                    {f.kind !== "tournament" && (f.paymentStatus === "paid"
                      ? <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">Paid ✓</span>
                      : fixtureView === "past"
                        ? <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full">Dues open</span>
                        : null)}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <a href={f.kind === "tournament" ? `/play/tournament/${f.postId}` : `/my-team/match/${f.matchRowId ?? f.postId}`}
                    className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary text-center">
                    {f.kind === "tournament" ? "Manage Tournament" : fixtureView === "past" ? "See Details" : "Manage Match"}
                  </a>
                </div>
              </div>
            ))}
            {shownFixtures.length > 3 && (
              <button
                onClick={() => setFixturesExpanded((e) => !e)}
                className="w-full py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary"
              >
                {fixturesExpanded ? "See less" : `See more (${shownFixtures.length - 3})`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Tournaments this team is hosting — jump straight to the manage page */}
      {(hostedTournamentsLoading || hostedTournaments.length > 0) && (
        <section>
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Tournaments You&apos;re Hosting</h3>
          {hostedTournamentsLoading ? (
            <div className="py-4 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
          ) : (
            <div className="space-y-2">
              {hostedTournaments.map((t) => (
                <div key={t.id} className="bg-surface-2 border border-border rounded-2xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{t.title}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        {t.match_date} · {t.start_time}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary truncate">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        {t.pitch_name}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-accent">{t.joinedCount}/{t.max_teams}</p>
                      <p className="text-[10px] text-text-secondary">teams</p>
                    </div>
                  </div>
                  <a href={`/play/tournament/${t.id}`} className="block w-full py-2 rounded-xl border border-accent/40 text-accent text-xs font-semibold text-center mt-3">Manage tournament</a>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Next Fixture Banner ───────────────────────────────────────
function NextFixtureBanner({ userId, role }: { userId: string; role: "captain" | "player" }) {
  const [fixture, setFixture] = useState<{ postId: string; matchRowId: string | null; opponent: string; date: string; time: string; pitch: string } | null | undefined>(undefined);

  useEffect(() => {
    async function load() {
      let captainId = userId;

      if (role === "player") {
        const { data: mem } = await supabase.from("team_members").select("team_id").eq("player_id", userId).eq("status", "approved").maybeSingle();
        if (!mem?.team_id) { setFixture(null); return; }
        const { data: team } = await supabase.from("teams").select("captain_id").eq("id", mem.team_id).maybeSingle();
        if (!team?.captain_id) { setFixture(null); return; }
        captainId = team.captain_id;
      }

      const today = new Date().toISOString().split("T")[0];
      const candidates: { postId: string; opponent: string; date: string; time: string; pitch: string }[] = [];

      const { data: posts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched").gte("match_date", today);

      for (const post of posts ?? []) {
        const { data: ch } = await supabase.from("challenges").select("challenger_team_name, selected_pitch")
          .eq("post_id", post.id).eq("status", "accepted").maybeSingle();
        candidates.push({
          postId: post.id,
          opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
          date: post.match_date,
          time: post.match_time,
          pitch: (ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name ?? "TBC",
        });
      }

      const { data: challenges } = await supabase.from("challenges")
        .select("post_id, selected_pitch").eq("challenger_captain_id", captainId).eq("status", "accepted");

      for (const c of challenges ?? []) {
        const { data: post } = await supabase.from("match_posts")
          .select("id, team_name, match_date, match_time").eq("id", c.post_id).gte("match_date", today).maybeSingle();
        if (!post) continue;
        candidates.push({
          postId: c.post_id,
          opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
          date: (post as { match_date: string } | null)?.match_date ?? "",
          time: (post as { match_time: string } | null)?.match_time ?? "",
          pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
        });
      }

      if (candidates.length === 0) { setFixture(null); return; }
      candidates.sort((a, b) => a.date.localeCompare(b.date));
      const [withMatchRowId] = await attachMatchRowIds([candidates[0]]);
      setFixture(withMatchRowId);
    }
    load();
  }, [userId, role]);

  if (!fixture) return null;

  return (
    <a href={`/my-team/match/${fixture.matchRowId ?? fixture.postId}`} className="block bg-accent/5 border border-accent/20 rounded-2xl p-4 mb-2">
      <p className="text-[10px] font-semibold text-accent uppercase tracking-wider mb-2">Next Fixture</p>
      <p className="font-bold text-base mb-2">vs {fixture.opponent}</p>
      <div className="flex flex-col gap-1 text-xs text-text-secondary">
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          {fixture.date} · {fixture.time}
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {fixture.pitch}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-accent font-medium mt-3">
        View details
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </div>
    </a>
  );
}

// ── Team Announcement Banner ────────────────────────────────────
function TeamAnnouncementBanner({ userId, role }: { userId: string; role: "captain" | "player" }) {
  const [announcement, setAnnouncement] = useState<{ title: string | null; body: string; created_at: string; authorName: string } | null | undefined>(undefined);

  useEffect(() => {
    async function load() {
      let teamId: string | undefined;
      if (role === "captain") {
        const { data } = await supabase.from("teams").select("id").eq("captain_id", userId).maybeSingle();
        teamId = data?.id;
      } else {
        const { data: mem } = await supabase.from("team_members").select("team_id").eq("player_id", userId).eq("status", "approved").maybeSingle();
        teamId = mem?.team_id;
      }
      if (!teamId) { setAnnouncement(null); return; }

      const { data: latest } = await supabase.from("team_announcements")
        .select("title, body, created_at, captain_id").eq("team_id", teamId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!latest) { setAnnouncement(null); return; }

      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (new Date(latest.created_at).getTime() < weekAgo) { setAnnouncement(null); return; }

      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", latest.captain_id).maybeSingle();
      setAnnouncement({ title: latest.title, body: latest.body, created_at: latest.created_at, authorName: profile?.full_name ?? "Captain" });
    }
    load();
  }, [userId, role]);

  if (!announcement) return null;

  const diffMins = Math.floor((Date.now() - new Date(announcement.created_at).getTime()) / 60000);
  const timeAgo = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins}m ago` : diffMins < 1440 ? `${Math.floor(diffMins / 60)}h ago` : `${Math.floor(diffMins / 1440)}d ago`;

  return (
    <div className="bg-white rounded-2xl p-4 mb-2">
      {announcement.title && <p className="text-sm font-bold text-black mb-1">{announcement.title}</p>}
      <p className="text-sm text-black whitespace-pre-wrap mb-1">{highlightMentions(announcement.body)}</p>
      <p className="text-[11px] text-black/60 mb-3">— {announcement.authorName} · {timeAgo}</p>
      <a href="/my-team/announcements" className="flex items-center gap-1 text-xs text-black font-medium underline">
        View previous announcements
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
    </div>
  );
}



// ── Page ─────────────────────────────────────────────────────
export default function MyTeamPage() {
  const { role, roleLoading } = useRole();
  const { user } = useAuth();
  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-0.5">
          {role === "new_user" ? "Browse Teams" : "My Team"}
        </h1>
        <p className="text-text-secondary text-sm">
          {role === "new_user" ? "Find teams to become your next family"
          : role === "player" ? "Your squad and performance"
          : "Manage your squad and organise matches"}
        </p>
        {(role === "captain" || role === "player") && user && (
          <TeamCreditsBar userId={user.id} role={role as "captain" | "player"} />
        )}
      </header>
      {(role === "captain" || role === "player") && user && (
        <NextFixtureBanner userId={user.id} role={role as "captain" | "player"} />
      )}
      {(role === "captain" || role === "player") && user && (
        <TeamAnnouncementBanner userId={user.id} role={role as "captain" | "player"} />
      )}
      {role === "new_user" && !user && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <p className="text-sm font-semibold">No profile yet</p>
          <p className="text-xs text-text-secondary text-center max-w-[220px]">Create an account to build your player profile and track your stats.</p>
          <div className="flex gap-3">
            <a href="/register" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm">Create Account</a>
            <a href="/login" className="px-6 py-3 rounded-xl border border-border text-text-primary font-bold text-sm">Sign In</a>
          </div>
        </div>
      )}
      {role === "new_user" && user && <NewUserMyTeam />}
      {role === "player" && <PlayerMyTeam />}
      {role === "captain" && <CaptainMyTeam />}
    </div>
  );
}
