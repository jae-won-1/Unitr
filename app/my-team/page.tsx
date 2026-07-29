"use client";

import { useCallback, useEffect, useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useTactics } from "@/contexts/TacticsContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe-client";
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

// ── Credits checkout form (inside Stripe Elements) ────────────
// Shared by both the card-entry (Elements) and saved-card fast-path top-up
// flows: credit the team, then apply the payment toward a single targeted due
// (targetPcsId) or the player's own outstanding match-fee dues oldest-game-first.
async function applyTopUp(teamId: string, userId: string, amountPence: number, targetPcsId?: string): Promise<number | null> {
  const { data: newBalancePence } = await supabase.rpc("add_credit", {
    p_team_id: teamId,
    p_amount_pence: amountPence,
    p_player_id: userId,
  });

  if (targetPcsId) {
    const { data: row } = await supabase.from("payment_collection_status")
      .select("share_pence").eq("id", targetPcsId).maybeSingle();
    await supabase.from("payment_collection_status").update({
      credited_pence: row?.share_pence ?? amountPence,
      received: true,
      updated_at: new Date().toISOString(),
    }).eq("id", targetPcsId);
    return typeof newBalancePence === "number" ? newBalancePence : null;
  }

  let remaining = amountPence;
  const { data: dueRowsRaw } = await supabase.from("payment_collection_status")
    .select("id, match_id, share_pence, credited_pence").eq("player_id", userId).eq("included", true);
  const dueMatchIds = [...new Set((dueRowsRaw ?? []).map((r) => r.match_id))];
  const { data: dueMatches } = dueMatchIds.length > 0
    ? await supabase.from("matches").select("id, match_date").in("id", dueMatchIds)
    : { data: [] };
  const matchDateById = new Map((dueMatches ?? []).map((m) => [m.id, m.match_date as string]));
  const dueRows = [...(dueRowsRaw ?? [])].sort((a, b) =>
    (matchDateById.get(a.match_id) ?? "").localeCompare(matchDateById.get(b.match_id) ?? "")
  );
  for (const row of dueRows) {
    if (remaining <= 0) break;
    const need = row.share_pence - (row.credited_pence ?? 0);
    if (need <= 0) continue;
    const applied = Math.min(remaining, need);
    const newCredited = (row.credited_pence ?? 0) + applied;
    await supabase.from("payment_collection_status").update({
      credited_pence: newCredited,
      received: newCredited >= row.share_pence,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    remaining -= applied;
  }

  return typeof newBalancePence === "number" ? newBalancePence : null;
}

function CreditsCheckoutForm({ amount, teamId, userId, currentCredits, targetPcsId, onSuccess, onBack }: {
  amount: number; teamId: string; userId: string; currentCredits: number;
  targetPcsId?: string;
  onSuccess: (newBalance: number) => void; onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    setPayError(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setPayError(error.message ?? "Payment failed."); setPaying(false); return; }
    if (paymentIntent?.status === "succeeded") {
      const newBalancePence = await applyTopUp(teamId, userId, Math.round(amount * 100), targetPcsId);
      const newBalance = typeof newBalancePence === "number" ? newBalancePence / 100 : currentCredits + amount;
      onSuccess(newBalance);
    } else {
      setPayError("Payment did not complete. Please try again.");
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-xs space-y-1.5">
        <div className="flex justify-between text-text-secondary"><span>Adding to team credits</span><span className="font-bold text-text-primary">£{amount.toFixed(2)}</span></div>
        <div className="flex justify-between text-text-secondary"><span>New balance</span><span className="font-bold text-accent">£{(currentCredits + amount).toFixed(2)}</span></div>
      </div>
      <div className="bg-surface-2 border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Card Details</p>
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      </div>
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
        <p className="text-[11px] text-blue-300 font-semibold mb-0.5">Test Mode</p>
        <p className="text-[11px] text-blue-200">Use <span className="font-mono font-bold">4242 4242 4242 4242</span> · any future expiry · any CVC</p>
      </div>
      {payError && <p className="text-xs text-red-400 text-center">{payError}</p>}
      <button onClick={handlePay} disabled={!stripe || paying}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
        {paying ? "Processing…" : `Pay £${amount.toFixed(2)}`}
      </button>
      <button onClick={onBack} className="w-full py-2 text-xs text-text-secondary">← Back</button>
    </div>
  );
}

type DuePlayer = { player_id: string; name: string; status: string; sharePence: number };
type DueGroup = { matchId: string; bookingId: string | null; opponent: string; date: string; teamPoolPence: number; players: DuePlayer[] };

// Captain's Collect Payment view — grouped by match. Each recent match with
// an outstanding fee lists its charged players + individual pay status, and
// the captain can remind any unpaid player.
type CollectPlayer = { player_id: string; name: string; sharePence: number; remainingPence: number; received: boolean };
// `matchId` holds whichever id the charge targets — a matches row for a game,
// an open_matches row for a tournament entry. `kind` says which, so writes go
// to the right column.
type CollectMatch = { matchId: string; kind: "match" | "tournament"; opponent: string; date: string; players: CollectPlayer[]; totalDuePence: number; paidCount: number };

// A single match fee the logged-in player still owes (from a captain's
// "Collect Payment" request) — drives the Top Up notification badge + the
// itemised "Payments due" list the player pays from.
// `matchId` is the id of whatever the charge targets — a matches row for a
// game, an open_matches row for a tournament entry (kind says which). It is
// used as a React key and as Stripe metadata, never to join blindly.
type MyDue = { pcsId: string; matchId: string; kind: "match" | "tournament"; opponent: string; date: string; remainingPence: number; sharePence: number };
type SavedCard = { customerId: string; paymentMethodId: string; last4: string | null };

type CreditTransaction = {
  id: string;
  player_id: string;
  amount_pence: number;
  created_at: string;
  player_name: string;
};

// ── Team Credits Bar ──────────────────────────────────────────
function TeamCreditsBar({ userId, role }: { userId: string; role: "captain" | "player" }) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [reserved, setReserved] = useState(0);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logTab, setLogTab] = useState<"deposits" | "bookings" | "reimbursed">("deposits");
  const [depositsExpanded, setDepositsExpanded] = useState(false);
  const [bookingsExpanded, setBookingsExpanded] = useState(false);
  const [reimbursedExpanded, setReimbursedExpanded] = useState(false);
  const [owedByPlayer, setOwedByPlayer] = useState<Record<string, number>>({});
  const [bookingTx, setBookingTx] = useState<{ id: string; label: string; detail: string; amount_pence: number; created_at: string }[]>([]);
  const [reimbursedTx, setReimbursedTx] = useState<{ id: string; opponent: string; amount_pence: number; created_at: string }[]>([]);
  const [dues, setDues] = useState<DueGroup[]>([]);
  const [duesBusy, setDuesBusy] = useState<Set<string>>(new Set());
  const [showCollect, setShowCollect] = useState(false);
  const [collectMatches, setCollectMatches] = useState<CollectMatch[]>([]);
  const [selectedCollectMatch, setSelectedCollectMatch] = useState<string | null>(null);
  const [collectLoading, setCollectLoading] = useState(true);
  const [remindingPlayer, setRemindingPlayer] = useState<string | null>(null);
  const [remindedPlayers, setRemindedPlayers] = useState<Set<string>>(new Set());
  const [removingPlayer, setRemovingPlayer] = useState<string | null>(null);
  const [historyAlertCount, setHistoryAlertCount] = useState(0);
  const [myOwedPence, setMyOwedPence] = useState(0);
  const [myDues, setMyDues] = useState<MyDue[]>([]);
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null);
  const [dueBusy, setDueBusy] = useState<Set<string>>(new Set());
  const [dueError, setDueError] = useState<string | null>(null);
  const [duePaidFlash, setDuePaidFlash] = useState<number | null>(null);
  const [payTarget, setPayTarget] = useState<{ pcsId: string; amountPence: number } | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [topUpBusy, setTopUpBusy] = useState(false);

  // Effect 1: resolve team ID
  useEffect(() => {
    async function loadTeam() {
      let tid: string | null = null;
      if (role === "captain") {
        const { data } = await supabase.from("teams").select("id").eq("captain_id", userId).maybeSingle();
        tid = data?.id ?? null;
      } else {
        const { data } = await supabase.from("team_members").select("team_id").eq("player_id", userId).eq("status", "approved").maybeSingle();
        tid = data?.team_id ?? null;
      }
      setTeamId(tid);
    }
    loadTeam();
  }, [userId, role]);

  // Keep the outstanding-payments count fresh for the Collect Payment badge,
  // without requiring the popup to have been opened yet.
  useEffect(() => {
    if (role === "captain" && teamId) loadCollectMatches(teamId);
  }, [role, teamId]);

  // Count past matches still needing attention — no result submitted yet,
  // and/or no "Collect Payment" request sent — for the Match History badge.
  useEffect(() => {
    if (role !== "captain" || !teamId) { setHistoryAlertCount(0); return; }
    async function loadHistoryAlerts() {
      const today = new Date().toISOString().split("T")[0];
      const { data: ms } = await supabase.from("matches")
        .select("id, result_submitted")
        .or(`posting_team_id.eq.${teamId},challenging_team_id.eq.${teamId}`)
        .lt("match_date", today);
      if (!ms || ms.length === 0) { setHistoryAlertCount(0); return; }

      const matchIds = ms.map((m) => m.id);
      const { data: collectionRows } = await supabase.from("payment_collection_status")
        .select("match_id").eq("team_id", teamId).in("match_id", matchIds);
      const requestSentIds = new Set((collectionRows ?? []).map((r) => r.match_id as string));

      const count = ms.filter((m) => !m.result_submitted || !requestSentIds.has(m.id)).length;
      setHistoryAlertCount(count);
    }
    loadHistoryAlerts();
  }, [role, teamId]);

  // This player's own outstanding share across every match they've been
  // charged for (set up via the captain's "Collect Payment" flow) — drives
  // the red Top Up button + warning strip below. credited_pence tracks
  // partial pay-down from top-ups, so a top-up smaller than the full amount
  // still reduces what's shown as owed.
  const loadMyOwed = async () => {
    const { data } = await supabase.from("payment_collection_status")
      .select("share_pence, credited_pence").eq("player_id", userId).eq("included", true);
    setMyOwedPence((data ?? []).reduce((sum, r) => sum + Math.max(0, r.share_pence - (r.credited_pence ?? 0)), 0));
  };

  // Itemised version of the above: each unpaid match fee this player owes,
  // resolved to opponent + date, so the notification badge can show a count
  // and the Top Up modal can list "which match + fee" to pay individually.
  const loadMyDues = async (tid: string) => {
    const { data: rows } = await supabase.from("payment_collection_status")
      .select("id, match_id, open_match_id, share_pence, credited_pence")
      .eq("player_id", userId).eq("included", true).eq("received", false);
    const pending = (rows ?? [])
      .map((r) => ({ ...r, remaining: r.share_pence - (r.credited_pence ?? 0) }))
      .filter((r) => r.remaining > 0);
    if (pending.length === 0) { setMyDues([]); setMyOwedPence(0); return; }

    // A charge targets a match OR a tournament entry — resolve each set of
    // labels from its own table rather than assuming match_id is present.
    const matchIds = [...new Set(pending.map((r) => r.match_id).filter(Boolean))] as string[];
    const omIds = [...new Set(pending.map((r) => r.open_match_id).filter(Boolean))] as string[];
    const [{ data: ms }, { data: oms }] = await Promise.all([
      matchIds.length
        ? supabase.from("matches").select("id, posting_team_id, challenging_team_id, match_date").in("id", matchIds)
        : Promise.resolve({ data: [] as { id: string; posting_team_id: string; challenging_team_id: string; match_date: string }[] }),
      omIds.length
        ? supabase.from("open_matches").select("id, title, match_date").in("id", omIds)
        : Promise.resolve({ data: [] as { id: string; title: string; match_date: string }[] }),
    ]);
    const matchById = new Map((ms ?? []).map((m) => [m.id, m]));
    const omById = new Map((oms ?? []).map((o) => [o.id, o]));
    const oppIds = [...new Set((ms ?? []).map((m) => (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id)))];
    const { data: teamsData } = oppIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppIds)
      : { data: [] as { id: string; name: string }[] };
    const teamName = new Map((teamsData ?? []).map((t) => [t.id, t.name as string]));

    const dues: MyDue[] = pending.map((r) => {
      if (r.open_match_id) {
        const t = omById.get(r.open_match_id);
        return {
          pcsId: r.id,
          matchId: r.open_match_id,
          kind: "tournament" as const,
          opponent: t?.title || "Tournament",
          date: t?.match_date ?? "",
          remainingPence: r.remaining,
          sharePence: r.share_pence,
        };
      }
      const m = matchById.get(r.match_id);
      const oppId = m ? (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id) : null;
      return {
        pcsId: r.id,
        matchId: r.match_id,
        kind: "match" as const,
        opponent: oppId ? (teamName.get(oppId) ?? "Opponent") : "Opponent",
        date: m?.match_date ?? "",
        remainingPence: r.remaining,
        sharePence: r.share_pence,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));
    setMyDues(dues);
    setMyOwedPence(dues.reduce((sum, d) => sum + d.remainingPence, 0));
  };

  useEffect(() => {
    loadMyOwed();
    // Load the player's saved card (card-on-file) so eligible dues can be
    // charged off-session without re-entering card details.
    supabase.from("profiles").select("stripe_customer_id, stripe_payment_method_id, card_last4").eq("id", userId).maybeSingle()
      .then(({ data }) => {
        if (data?.stripe_customer_id && data?.stripe_payment_method_id) {
          setSavedCard({ customerId: data.stripe_customer_id, paymentMethodId: data.stripe_payment_method_id, last4: data.card_last4 ?? null });
        }
      });
  }, [userId]);

  // Load itemised dues + subscribe so a captain's new payment request lights up
  // the badge live, without the player needing to refresh.
  useEffect(() => {
    if (!teamId) return;
    loadMyDues(teamId);
    const suffix = Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`my_dues_${userId}_${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_collection_status", filter: `player_id=eq.${userId}` },
        () => loadMyDues(teamId))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [teamId, userId]);

  const loadDeposits = useCallback(async () => {
    if (!teamId) return;
    const { data } = await supabase
      .from("team_credit_transactions")
      .select("id, player_id, amount_pence, created_at")
      .eq("team_id", teamId)
      .eq("type", "deposit")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!data || data.length === 0) { setTransactions([]); return; }
    // Separate profiles lookup — avoids FK traversal issue with auth.users ref
    const pids = [...new Set(data.map((t) => t.player_id).filter(Boolean))];
    const { data: profs } = pids.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", pids)
      : { data: [] as { id: string; full_name: string }[] };
    const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name as string]));
    setTransactions(
      data.map((t) => ({
        id: t.id,
        player_id: t.player_id,
        amount_pence: t.amount_pence,
        created_at: t.created_at,
        player_name: nameById.get(t.player_id) ?? "Unknown",
      }))
    );
  }, [teamId]);

  // Effect 2: load balance + transactions, subscribe to both
  useEffect(() => {
    if (!teamId) return;

    // Load initial balance + reserved earmark
    supabase.from("team_credits").select("balance_pence, reserved_pence").eq("team_id", teamId).maybeSingle()
      .then(({ data }) => {
        setCredits((data?.balance_pence ?? 0) / 100);
        setReserved((data?.reserved_pence ?? 0) / 100);
      });

    loadDeposits();

    const suffix = Math.random().toString(36).slice(2);

    // Realtime: balance + reserved updates
    const balanceChannel = supabase
      .channel(`team_credits_${teamId}_${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_credits", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const row = payload.new as { balance_pence: number; reserved_pence: number } | null;
          if (row) { setCredits(row.balance_pence / 100); setReserved((row.reserved_pence ?? 0) / 100); }
        })
      .subscribe();

    // Realtime: new deposits
    const txChannel = supabase
      .channel(`team_credit_tx_${teamId}_${suffix}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_credit_transactions", filter: `team_id=eq.${teamId}` },
        async (payload) => {
          const row = payload.new as { id: string; player_id: string; amount_pence: number; created_at: string; type: string };
          if (row.type !== "deposit") return;
          const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", row.player_id).maybeSingle();
          setTransactions((prev) => [{
            id: row.id,
            player_id: row.player_id,
            amount_pence: row.amount_pence,
            created_at: row.created_at,
            player_name: (profile as { full_name: string } | null)?.full_name ?? "Unknown",
          }, ...prev].slice(0, 20));
        })
      .subscribe();

    return () => {
      supabase.removeChannel(balanceChannel);
      supabase.removeChannel(txChannel);
    };
  }, [teamId, loadDeposits]);

  const closeModal = () => {
    setShowTopUp(false);
    setSelectedAmount(null);
    setCustomInput("");
    setClientSecret(null);
    setIntentError(null);
    setSuccess(false);
    setPayTarget(null);
    setDueError(null);
    setDuePaidFlash(null);
    setTopUpBusy(false);
  };

  // Clear a paid-off due locally: refill the team's credit and mark the row.
  // add_credit returns the new balance so we set it directly — the realtime
  // subscription isn't guaranteed to reach the payer's own browser in time.
  const applyDuePaid = async (due: MyDue, paidPence: number) => {
    if (!teamId) return;
    const { data: newBalancePence } = await supabase.rpc("add_credit", { p_team_id: teamId, p_amount_pence: paidPence, p_player_id: userId });
    if (typeof newBalancePence === "number") setCredits(newBalancePence / 100);
    await supabase.from("payment_collection_status")
      .update({ credited_pence: due.sharePence, received: true, updated_at: new Date().toISOString() })
      .eq("id", due.pcsId);
    setMyDues((prev) => prev.filter((d) => d.pcsId !== due.pcsId));
    setMyOwedPence((prev) => Math.max(0, prev - paidPence));
  };

  // Pay a due off the player's saved card (no card entry). Refills team credit.
  const payDueWithCard = async (due: MyDue) => {
    if (!savedCard || !teamId) return;
    setDueBusy((prev) => new Set(prev).add(due.pcsId));
    setDueError(null);
    try {
      const res = await fetch("/api/settle-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{
          playerId: userId,
          customerId: savedCard.customerId,
          paymentMethodId: savedCard.paymentMethodId,
          amountPence: due.remainingPence,
          sharePence: due.remainingPence,
          feePence: 0,
          // Stripe metadata only — a tournament due carries its open_match id.
          matchId: due.kind === "match" ? due.matchId : undefined,
          openMatchId: due.kind === "tournament" ? due.matchId : undefined,
        }] }),
      });
      const data = await res.json();
      const r = data.results?.[0];
      if (r?.ok) {
        await applyDuePaid(due, due.remainingPence);
        setDuePaidFlash(Date.now());
      } else {
        setDueError(r?.error ?? data.error ?? "Card was declined — try topping up manually.");
      }
    } catch {
      setDueError("Payment failed. Please try again.");
    }
    setDueBusy((prev) => { const n = new Set(prev); n.delete(due.pcsId); return n; });
  };

  // No saved card: set up a one-off Stripe payment for exactly this due's amount.
  const startCardEntryForDue = async (due: MyDue) => {
    if (!teamId) return;
    setPayTarget({ pcsId: due.pcsId, amountPence: due.remainingPence });
    setDueError(null);
    setLoadingIntent(true);
    setIntentError(null);
    const res = await fetch("/api/create-credits-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPence: due.remainingPence, teamId }),
    });
    const data = await res.json();
    if (data.clientSecret) setClientSecret(data.clientSecret);
    else { setIntentError(data.error ?? "Failed to set up payment."); setPayTarget(null); }
    setLoadingIntent(false);
  };

  // Per-match dues: for every match this team played, the share each
  // participant owes toward the team's half of the pitch, plus whether it's
  // been paid (auto-charged at settlement, or a manual top-up here).
  const loadDues = async (tid: string) => {
    const { data: ms } = await supabase.from("matches")
      .select("id, post_id, posting_team_id, challenging_team_id, confirmed_pitch, match_date")
      .or(`posting_team_id.eq.${tid},challenging_team_id.eq.${tid}`)
      .order("match_date", { ascending: false }).limit(20);
    if (!ms || ms.length === 0) { setDues([]); return; }

    const matchIds = ms.map((m) => m.id);
    const postIds = ms.map((m) => m.post_id).filter(Boolean);
    const oppIds = [...new Set(ms.map((m) => (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id)))];

    const [{ data: teamsData }, { data: bks }, { data: confs }] = await Promise.all([
      supabase.from("teams").select("id, name").in("id", oppIds),
      supabase.from("pitch_bookings").select("id, post_id").in("post_id", postIds),
      supabase.from("match_confirmations")
        .select("match_id, player_id, status, profiles(full_name)")
        .in("match_id", matchIds).eq("team_id", tid),
    ]);
    const teamName = new Map((teamsData ?? []).map((t) => [t.id, t.name as string]));
    const bookingByPost = new Map((bks ?? []).map((b) => [b.post_id, b.id as string]));
    const bookingIds = (bks ?? []).map((b) => b.id);

    const { data: pays } = bookingIds.length
      ? await supabase.from("player_payments")
          .select("booking_id, player_id, status")
          .in("booking_id", bookingIds).eq("team_id", tid).eq("purpose", "replenish")
      : { data: [] as { booking_id: string; player_id: string; status: string }[] };
    const payByKey = new Map((pays ?? []).map((p) => [`${p.booking_id}:${p.player_id}`, p.status]));

    const groups: DueGroup[] = ms.map((m) => {
      const oppId = m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id;
      const bookingId = bookingByPost.get(m.post_id) ?? null;
      const isPoster = m.posting_team_id === tid;
      const feePence = Math.round(((m.confirmed_pitch as { price?: number } | null)?.price ?? 0) * 100);
      const half = Math.floor(feePence / 2);
      const teamPool = isPoster ? feePence - half : half;
      const participants = (confs ?? []).filter((c) => c.match_id === m.id && c.status === "confirmed");
      const sharePence = participants.length ? Math.round(teamPool / participants.length) : 0;
      const players: DuePlayer[] = participants.map((c) => ({
        player_id: c.player_id,
        name: (c.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player",
        status: (bookingId && payByKey.get(`${bookingId}:${c.player_id}`)) || "unpaid",
        sharePence,
      }));
      return { matchId: m.id, bookingId, opponent: teamName.get(oppId) ?? "Opponent", date: m.match_date, teamPoolPence: teamPool, players };
    }).filter((g) => g.players.length > 0);
    setDues(groups);
  };

  // Issue an individual top-up: credit the player's share back to the team and
  // mark their due paid (used when a player settles in cash / outside auto-charge).
  const markDuePaid = async (group: DueGroup, player: DuePlayer) => {
    if (!teamId || player.status === "paid") return;
    const key = `${group.matchId}:${player.player_id}`;
    setDuesBusy((prev) => new Set(prev).add(key));
    await supabase.rpc("add_credit", { p_team_id: teamId, p_amount_pence: player.sharePence, p_player_id: player.player_id });
    if (group.bookingId) {
      await supabase.from("player_payments").upsert({
        booking_id: group.bookingId,
        player_id: player.player_id,
        team_id: teamId,
        amount_pence: player.sharePence,
        unitr_fee_pence: 0,
        total_pence: player.sharePence,
        purpose: "replenish",
        status: "paid",
        applied: true,
        paid_at: new Date().toISOString(),
      }, { onConflict: "booking_id,player_id" });
    }
    setDues((prev) => prev.map((g) => g.matchId === group.matchId
      ? { ...g, players: g.players.map((p) => p.player_id === player.player_id ? { ...p, status: "paid" } : p) }
      : g));
    setDuesBusy((prev) => { const next = new Set(prev); next.delete(key); return next; });
  };

  // Group the captain's collection requests by MATCH: each recent match with an
  // outstanding fee, its charged players, and each player's pay status. Matches
  // with everyone paid are dropped from the list.
  const loadCollectMatches = async (tid: string) => {
    setCollectLoading(true);
    // Note: payment_collection_status.player_id has no FK relationship
    // registered with profiles in the Supabase schema cache, so embedding it
    // in the select makes the entire query fail (PGRST200). Fetch names separately.
    const { data: rows } = await supabase
      .from("payment_collection_status")
      .select("match_id, open_match_id, player_id, share_pence, credited_pence, received")
      .eq("team_id", tid).eq("included", true);

    if (!rows || rows.length === 0) { setCollectMatches([]); setCollectLoading(false); return; }

    // A row targets a match OR a tournament entry; group by whichever it is.
    const targetIdOf = (r: { match_id: string | null; open_match_id: string | null }) =>
      (r.open_match_id ?? r.match_id) as string;

    const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))] as string[];
    const omIds = [...new Set(rows.map((r) => r.open_match_id).filter(Boolean))] as string[];
    const playerIds = [...new Set(rows.map((r) => r.player_id))];
    const [{ data: ms }, { data: oms }, { data: profilesData }] = await Promise.all([
      matchIds.length
        ? supabase.from("matches").select("id, posting_team_id, challenging_team_id, match_date").in("id", matchIds)
        : Promise.resolve({ data: [] as { id: string; posting_team_id: string; challenging_team_id: string; match_date: string }[] }),
      omIds.length
        ? supabase.from("open_matches").select("id, title, match_date").in("id", omIds)
        : Promise.resolve({ data: [] as { id: string; title: string; match_date: string }[] }),
      supabase.from("profiles").select("id, full_name").in("id", playerIds),
    ]);
    const oppIds = [...new Set((ms ?? []).map((m) => (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id)))];
    const { data: teamsData } = oppIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppIds)
      : { data: [] as { id: string; name: string }[] };
    const teamName = new Map((teamsData ?? []).map((t) => [t.id, t.name as string]));
    const matchById = new Map((ms ?? []).map((m) => [m.id, m]));
    const omById = new Map((oms ?? []).map((o) => [o.id, o]));
    const profileName = new Map((profilesData ?? []).map((p) => [p.id, p.full_name as string]));

    const byMatch = new Map<string, CollectMatch>();
    for (const r of rows) {
      const targetId = targetIdOf(r);
      if (!targetId) continue;
      const isTournament = Boolean(r.open_match_id);
      const remainingPence = Math.max(0, r.share_pence - (r.credited_pence ?? 0));
      const paid = r.received || remainingPence === 0;
      const m = r.match_id ? matchById.get(r.match_id) : undefined;
      const t = r.open_match_id ? omById.get(r.open_match_id) : undefined;
      const oppId = m ? (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id) : null;
      const label = isTournament
        ? (t?.title || "Tournament")
        : (oppId ? (teamName.get(oppId) ?? "Opponent") : "Opponent");
      const player: CollectPlayer = {
        player_id: r.player_id,
        name: profileName.get(r.player_id) ?? "Player",
        sharePence: r.share_pence,
        remainingPence,
        received: paid,
      };
      const existing = byMatch.get(targetId);
      if (existing) {
        existing.players.push(player);
        existing.totalDuePence += remainingPence;
        if (paid) existing.paidCount += 1;
      } else {
        byMatch.set(targetId, {
          matchId: targetId,
          kind: isTournament ? "tournament" : "match",
          opponent: label,
          date: (isTournament ? t?.match_date : m?.match_date) ?? "",
          players: [player],
          totalDuePence: remainingPence,
          paidCount: paid ? 1 : 0,
        });
      }
    }
    const groups = Array.from(byMatch.values())
      .filter((g) => g.totalDuePence > 0)                       // only matches still owed
      .map((g) => ({ ...g, players: g.players.sort((a, b) => Number(a.received) - Number(b.received)) }))
      .sort((a, b) => b.date.localeCompare(a.date));             // most recent first
    setCollectMatches(groups);
    setCollectLoading(false);
  };

  // Remind one player about one match's fee via a direct message.
  const remindPlayer = async (match: CollectMatch, player: CollectPlayer) => {
    const key = `${match.matchId}:${player.player_id}`;
    setRemindingPlayer(key);
    const targetCol = match.kind === "tournament" ? "open_match_id" : "match_id";
    const what = match.kind === "tournament" ? `entering ${match.opponent}` : `the match vs ${match.opponent}`;
    await supabase.from("messages").insert({
      sender_id: userId,
      receiver_id: player.player_id,
      type: "payment_reminder",
      [targetCol]: match.matchId,
      body: `Reminder: you owe £${(player.remainingPence / 100).toFixed(2)} for ${what} (${match.date}). Please pay from the Top Up tab.`,
    });
    setRemindingPlayer(null);
    setRemindedPlayers((prev) => new Set(prev).add(key));
  };

  // Drop a player from a match's payment request — e.g. they were added by
  // mistake. Deletes their payment_collection_status row entirely, so they no
  // longer owe anything for this match and won't be reminded.
  const removePlayerFromCollection = async (match: CollectMatch, player: CollectPlayer) => {
    const key = `${match.matchId}:${player.player_id}`;
    setRemovingPlayer(key);
    await supabase.from("payment_collection_status")
      .delete()
      .eq(match.kind === "tournament" ? "open_match_id" : "match_id", match.matchId)
      .eq("player_id", player.player_id);
    setCollectMatches((prev) => prev
      .map((g) => g.matchId !== match.matchId ? g : {
        ...g,
        players: g.players.filter((p) => p.player_id !== player.player_id),
        totalDuePence: g.totalDuePence - player.remainingPence,
      })
      .filter((g) => g.players.length > 0));
    setRemovingPlayer(null);
  };

  const openLog = async (startTab: "deposits" | "bookings" | "reimbursed" = "deposits") => {
    setLogTab(startTab);
    setShowLog(true);
    if (!teamId) return;
    // Always reload deposits so the popup is fresh on every open
    loadDeposits();
    loadDues(teamId);
    // Load per-player outstanding balances from payment_collection_status
    const { data: pcs } = await supabase
      .from("payment_collection_status")
      .select("player_id, share_pence, credited_pence")
      .eq("team_id", teamId)
      .eq("included", true)
      .eq("received", false);
    const owedMap: Record<string, number> = {};
    (pcs ?? []).forEach((r) => {
      const remaining = (r.share_pence ?? 0) - (r.credited_pence ?? 0);
      if (remaining > 0) owedMap[r.player_id] = (owedMap[r.player_id] ?? 0) + remaining;
    });
    setOwedByPlayer(owedMap);
    // Load outgoing credit transactions (pitch bookings, match captures, etc.)
    // and resolve each to what it actually paid for — a direct pitch booking,
    // a tournament buy-in, or a matched game against a specific opponent —
    // instead of a generic "Pitch booking" label.
    const { data: outgoing } = await supabase
      .from("team_credit_transactions")
      .select("id, amount_pence, created_at, type, match_id, related_team_id, booking_id, open_match_id")
      .eq("team_id", teamId)
      .lt("amount_pence", 0)
      .order("created_at", { ascending: false });
    const rows = outgoing ?? [];

    const oppTeamIds = [...new Set(rows.map((r) => r.related_team_id).filter(Boolean))];
    const bookingIds = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))];
    const openMatchIds = [...new Set(rows.map((r) => r.open_match_id).filter(Boolean))];

    const { data: bookingOppTeams } = oppTeamIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppTeamIds)
      : { data: [] as { id: string; name: string }[] };
    const { data: bookings } = bookingIds.length
      ? await supabase.from("pitch_bookings").select("id, pitch_id, match_date, start_time").in("id", bookingIds)
      : { data: [] as { id: string; pitch_id: string; match_date: string; start_time: string }[] };
    const { data: tournaments } = openMatchIds.length
      ? await supabase.from("open_matches").select("id, title, pitch_name").in("id", openMatchIds)
      : { data: [] as { id: string; title: string; pitch_name: string }[] };
    const bookingOppName = new Map((bookingOppTeams ?? []).map((t) => [t.id, t.name as string]));
    const pitchIds = [...new Set((bookings ?? []).map((b) => b.pitch_id).filter(Boolean))];
    const { data: pitches } = pitchIds.length
      ? await supabase.from("pitches").select("id, name").in("id", pitchIds)
      : { data: [] as { id: string; name: string }[] };
    const pitchName = new Map((pitches ?? []).map((p) => [p.id, p.name as string]));
    const bookingById = new Map((bookings ?? []).map((b) => [b.id, b]));
    const tournamentById = new Map((tournaments ?? []).map((t) => [t.id, t]));

    setBookingTx(rows.map((t) => {
      if (t.open_match_id && tournamentById.has(t.open_match_id)) {
        const tour = tournamentById.get(t.open_match_id)!;
        return { id: t.id, label: `Tournament entry — ${tour.title}`, detail: tour.pitch_name, amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
      }
      if (t.booking_id && bookingById.has(t.booking_id)) {
        const b = bookingById.get(t.booking_id)!;
        return { id: t.id, label: "Pitch booking", detail: `${pitchName.get(b.pitch_id) ?? "Pitch"} · ${b.match_date}`, amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
      }
      if (t.match_id) {
        const opponent = t.related_team_id ? (bookingOppName.get(t.related_team_id) ?? "Opponent") : "Opponent";
        return { id: t.id, label: "Pitch booking — matched game", detail: `vs ${opponent}`, amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
      }
      return { id: t.id, label: t.type === "booking_capture" ? "Pitch booking" : "Match payment", detail: "", amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
    }));
    // Load reimbursements this team received from an opponent — e.g. when a
    // challenger joins a secured post, they pay their half straight into the
    // poster's credit (reimburse_secured_pitch → 'opponent_settlement', +ve).
    const { data: reimbursed } = await supabase
      .from("team_credit_transactions")
      .select("id, amount_pence, created_at, related_team_id")
      .eq("team_id", teamId)
      .eq("type", "opponent_settlement")
      .gt("amount_pence", 0)
      .order("created_at", { ascending: false });
    const oppIds = [...new Set((reimbursed ?? []).map((t) => t.related_team_id).filter(Boolean))];
    const { data: oppTeams } = oppIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppIds)
      : { data: [] as { id: string; name: string }[] };
    const oppName = new Map((oppTeams ?? []).map((t) => [t.id, t.name as string]));
    setReimbursedTx((reimbursed ?? []).map((t) => ({
      id: t.id,
      opponent: t.related_team_id ? (oppName.get(t.related_team_id) ?? "Opponent") : "Opponent",
      amount_pence: t.amount_pence,
      created_at: t.created_at,
    })));
  };

  const effectiveAmount = payTarget ? payTarget.amountPence / 100 : selectedAmount ?? (customInput ? parseFloat(customInput) : null);

  const handleContinue = async () => {
    if (!effectiveAmount || effectiveAmount < 1 || !teamId) return;
    setLoadingIntent(true);
    setIntentError(null);
    const res = await fetch("/api/create-credits-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPence: Math.round(effectiveAmount * 100), teamId }),
    });
    const data = await res.json();
    if (data.clientSecret) {
      setClientSecret(data.clientSecret);
    } else {
      setIntentError(data.error ?? "Failed to set up payment.");
    }
    setLoadingIntent(false);
  };

  // Fast path: charge the top-up straight to the player's saved card
  // (off-session, no card re-entry) instead of the Stripe Elements form.
  const payTopUpWithSavedCard = async () => {
    if (!savedCard || !teamId || !effectiveAmount || effectiveAmount < 1) return;
    setTopUpBusy(true);
    setIntentError(null);
    const amountPence = Math.round(effectiveAmount * 100);
    try {
      const res = await fetch("/api/settle-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{
          playerId: userId,
          customerId: savedCard.customerId,
          paymentMethodId: savedCard.paymentMethodId,
          amountPence,
          sharePence: amountPence,
          feePence: 0,
        }] }),
      });
      const data = await res.json();
      const r = data.results?.[0];
      if (r?.ok) {
        const newBalancePence = await applyTopUp(teamId, userId, amountPence, payTarget?.pcsId ?? undefined);
        setCredits(typeof newBalancePence === "number" ? newBalancePence / 100 : (credits ?? 0) + effectiveAmount);
        setSuccess(true);
        loadMyOwed();
        if (payTarget) { setMyDues((prev) => prev.filter((d) => d.pcsId !== payTarget.pcsId)); loadMyDues(teamId); }
      } else {
        setIntentError(r?.error ?? data.error ?? "Card was declined — try a different card below.");
      }
    } catch {
      setIntentError("Payment failed. Please try again.");
    }
    setTopUpBusy(false);
  };

  if (credits === null) return null;

  return (
    <>
      <div className="flex items-center gap-2 mt-2">
        <button onClick={() => openLog("deposits")}
          className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-1.5 hover:border-accent/40 transition-colors">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span className="text-sm font-bold">£{credits.toFixed(2)}</span>
          <span className="text-xs text-text-secondary">team credits</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <button onClick={() => setShowTopUp(true)}
          className={`relative text-xs font-semibold px-3 py-1.5 rounded-xl border ${myOwedPence > 0 ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-accent border-accent/30 bg-accent/10"}`}>
          + Top Up
          {myDues.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {myDues.length}
            </span>
          )}
        </button>
        {role === "captain" && (
          <button onClick={() => { setRemindedPlayers(new Set()); setSelectedCollectMatch(null); setShowCollect(true); if (teamId) loadCollectMatches(teamId); }}
            className="relative text-xs font-semibold text-text-primary border border-border bg-surface-2 px-3 py-1.5 rounded-xl">
            Unpaid Payment
            {collectMatches.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {collectMatches.length}
              </span>
            )}
          </button>
        )}
        <a href="/my-team/history" className="relative ml-auto text-xs font-semibold text-text-secondary flex items-center gap-1 flex-shrink-0">
          Match History
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          {historyAlertCount > 0 && (
            <span className="absolute -top-2 -left-4 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {historyAlertCount}
            </span>
          )}
        </a>
      </div>
      {reserved > 0 && (
        <p className="text-[11px] text-text-secondary mt-1">
          £{reserved.toFixed(2)} reserved for a pending match · £{(credits - reserved).toFixed(2)} available
        </p>
      )}
      {myOwedPence > 0 && (
        <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 mt-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <p className="text-[11px] text-yellow-400">
            Your previous matches haven&apos;t been paid off. Top up your required amount above.
          </p>
        </div>
      )}

      {/* Transaction log modal — captain only */}
      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-5" onClick={() => setShowLog(false)}>
          <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-5 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div>
                <p className="font-bold text-base">Team Credits</p>
                <p className="text-xs text-text-secondary">Balance: <span className="text-accent font-semibold">£{credits.toFixed(2)}</span></p>
              </div>
              <button onClick={() => setShowLog(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-1 mb-4 flex-shrink-0">
              {(["deposits", "bookings", "reimbursed"] as const).map((t) => (
                <button key={t} onClick={() => setLogTab(t)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${logTab === t ? "bg-accent text-black" : "text-text-secondary"}`}>
                  {t}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1">
              {logTab === "deposits" && (() => {
                const playerMap = new Map<string, { player_id: string; player_name: string; totalDeposited: number }>();
                transactions.forEach((tx) => {
                  const existing = playerMap.get(tx.player_id);
                  if (existing) { existing.totalDeposited += tx.amount_pence; }
                  else { playerMap.set(tx.player_id, { player_id: tx.player_id, player_name: tx.player_name, totalDeposited: tx.amount_pence }); }
                });
                const sorted = [...playerMap.values()].sort((a, b) => b.totalDeposited - a.totalDeposited);
                const displayed = depositsExpanded ? sorted : sorted.slice(0, 5);
                if (sorted.length === 0) return <p className="text-[11px] text-text-secondary text-center py-8">No deposits yet.</p>;
                return (
                  <div className="space-y-1.5">
                    {displayed.map((p) => {
                      const owed = owedByPlayer[p.player_id] ?? 0;
                      const initials = p.player_name.split(" ").filter(Boolean).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <div key={p.player_id} className="flex items-center gap-2.5 bg-surface-2 border border-border rounded-xl px-3 py-2">
                          <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-accent">{initials}</span>
                          </div>
                          <p className="flex-1 min-w-0 text-xs font-medium truncate">{p.player_id === userId ? "You" : p.player_name}</p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="text-xs font-bold text-green-400">+£{(p.totalDeposited / 100).toFixed(2)}</span>
                            {owed > 0 && <span className="text-xs font-semibold text-red-400">(£{(owed / 100).toFixed(2)})</span>}
                          </div>
                        </div>
                      );
                    })}
                    {sorted.length > 5 && (
                      <div className="flex justify-end pt-1">
                        <button onClick={() => setDepositsExpanded(!depositsExpanded)}
                          className="text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
                          {depositsExpanded ? "Show less" : "View More"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {logTab === "bookings" && (() => {
                const displayed = bookingsExpanded ? bookingTx : bookingTx.slice(0, 5);
                if (bookingTx.length === 0) return <p className="text-[11px] text-text-secondary text-center py-8">No booking payments yet.</p>;
                return (
                  <div className="space-y-1.5">
                    {displayed.map((p) => {
                      const initials = p.label.split(" ").filter(Boolean).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                      const diffMins = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000);
                      const timeAgo = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins}m ago` : diffMins < 1440 ? `${Math.floor(diffMins / 60)}h ago` : `${Math.floor(diffMins / 1440)}d ago`;
                      return (
                        <div key={p.id} className="flex items-center gap-2.5 bg-surface-2 border border-border rounded-xl px-3 py-2">
                          <div className="w-7 h-7 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-text-secondary">{initials}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{p.label}</p>
                            <p className="text-[10px] text-text-secondary truncate">{p.detail ? `${p.detail} · ` : ""}{timeAgo}</p>
                          </div>
                          <span className="text-xs font-bold text-red-400 flex-shrink-0">-£{(p.amount_pence / 100).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    {bookingTx.length > 5 && (
                      <div className="flex justify-end pt-1">
                        <button onClick={() => setBookingsExpanded(!bookingsExpanded)}
                          className="text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
                          {bookingsExpanded ? "Show less" : "View More"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {logTab === "reimbursed" && (() => {
                const displayed = reimbursedExpanded ? reimbursedTx : reimbursedTx.slice(0, 5);
                if (reimbursedTx.length === 0) return <p className="text-[11px] text-text-secondary text-center py-8">No reimbursements yet.</p>;
                return (
                  <div className="space-y-1.5">
                    {displayed.map((p) => {
                      const diffMins = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000);
                      const timeAgo = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins}m ago` : diffMins < 1440 ? `${Math.floor(diffMins / 60)}h ago` : `${Math.floor(diffMins / 1440)}d ago`;
                      return (
                        <div key={p.id} className="flex items-center gap-2.5 bg-surface-2 border border-border rounded-xl px-3 py-2">
                          <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">Reimbursed by {p.opponent}</p>
                            <p className="text-[10px] text-text-secondary">{timeAgo}</p>
                          </div>
                          <span className="text-xs font-bold text-green-400">+£{(p.amount_pence / 100).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    {reimbursedTx.length > 5 && (
                      <div className="flex justify-end pt-1">
                        <button onClick={() => setReimbursedExpanded(!reimbursedExpanded)}
                          className="text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
                          {reimbursedExpanded ? "Show less" : "View More"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Collect Payment modal — captain only. Drill-down: recent matches with
          payments due → a match's players + pay status → remind unpaid players. */}
      {showCollect && (() => {
        const selected = selectedCollectMatch ? collectMatches.find((m) => m.matchId === selectedCollectMatch) ?? null : null;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-5" onClick={() => setShowCollect(false)}>
          <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-5 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {selected && (
                  <button onClick={() => setSelectedCollectMatch(null)} className="flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                  </button>
                )}
                <div className="min-w-0">
                  <p className="font-bold text-base truncate">{selected ? (selected.kind === "tournament" ? selected.opponent : `vs ${selected.opponent}`) : "Collect Payment"}</p>
                  <p className="text-xs text-text-secondary truncate">
                    {selected ? `${selected.date} · tap Remind to notify a player` : "Recent matches with payments due"}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowCollect(false)} className="flex-shrink-0 ml-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2">
              {collectLoading ? (
                <div className="py-8 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
              ) : selected ? (
                /* ── Players in the selected match ── */
                selected.players.map((p) => {
                  const key = `${selected.matchId}:${p.player_id}`;
                  const busy = remindingPlayer === key;
                  const removing = removingPlayer === key;
                  const reminded = remindedPlayers.has(key);
                  return (
                    <div key={p.player_id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{p.player_id === userId ? "You" : p.name}</p>
                        <p className="text-[10px] text-text-secondary">£{(p.sharePence / 100).toFixed(2)} share</p>
                      </div>
                      {p.received ? (
                        <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/20 px-2.5 py-1 rounded-full flex-shrink-0">Paid ✓</span>
                      ) : (
                        <>
                          <button onClick={() => remindPlayer(selected, p)} disabled={busy || reminded || removing}
                            className="text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/30 px-2.5 py-1 rounded-full flex-shrink-0 disabled:opacity-60">
                            {busy ? "Sending…" : reminded ? "Reminded ✓" : "Remind"}
                          </button>
                          <button onClick={() => removePlayerFromCollection(selected, p)} disabled={removing || busy}
                            title="Remove from payment request — added by mistake"
                            className="text-text-secondary hover:text-red-400 flex-shrink-0 disabled:opacity-50">
                            {removing
                              ? <div className="w-3.5 h-3.5 rounded-full border-2 border-text-secondary border-t-transparent animate-spin" />
                              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })
              ) : collectMatches.length === 0 ? (
                <p className="text-xs text-text-secondary text-center py-8">Everyone&apos;s paid up — no missing payments.</p>
              ) : (
                /* ── Recent matches with payments due ── */
                collectMatches.map((g) => {
                  const unpaid = g.players.length - g.paidCount;
                  return (
                    <button key={g.matchId} onClick={() => { setSelectedCollectMatch(g.matchId); }}
                      className="w-full bg-surface-2 border border-border rounded-xl p-3 text-left">
                      <div className="flex items-center gap-2">
                        <p className="flex-1 min-w-0 text-sm font-semibold truncate">{g.kind === "tournament" ? g.opponent : `vs ${g.opponent}`}</p>
                        <span className="text-sm font-bold text-red-400 flex-shrink-0">£{(g.totalDuePence / 100).toFixed(2)}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                      <p className="text-[10px] text-text-secondary mt-1">
                        {g.date} · {unpaid} player{unpaid !== 1 ? "s" : ""} still to pay · {g.paidCount}/{g.players.length} paid
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {showTopUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5" onClick={closeModal}>
          <div className="w-full max-w-sm bg-[#141414] border border-border rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>

            {/* Success state */}
            {success ? (
              <div className="flex flex-col items-center text-center gap-4 py-4">
                <div className="w-16 h-16 rounded-full bg-accent/20 border-2 border-accent/40 flex items-center justify-center">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="font-bold text-lg">Credits Added!</p>
                <p className="text-sm text-text-secondary">£{effectiveAmount?.toFixed(2)} added to your team balance.</p>
                <p className="text-base font-bold text-accent">New balance: £{credits.toFixed(2)}</p>
                <button onClick={closeModal} className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">Done</button>
              </div>
            ) : clientSecret && effectiveAmount && teamId ? (
              /* Stripe payment step */
              <>
                <div className="flex items-center justify-between mb-5">
                  <p className="font-bold text-lg">Pay & Top Up</p>
                  <button onClick={closeModal}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#00E676", colorBackground: "#1a1a1a", colorText: "#ffffff", borderRadius: "12px" } } }}>
                  <CreditsCheckoutForm
                    amount={effectiveAmount}
                    teamId={teamId}
                    userId={userId}
                    currentCredits={credits}
                    targetPcsId={payTarget?.pcsId}
                    onSuccess={(newBalance) => {
                      setCredits(newBalance);
                      setSuccess(true);
                      loadMyOwed();
                      if (payTarget) { setMyDues((prev) => prev.filter((d) => d.pcsId !== payTarget.pcsId)); if (teamId) loadMyDues(teamId); }
                    }}
                    onBack={() => { setClientSecret(null); setPayTarget(null); }}
                  />
                </Elements>
              </>
            ) : (
              /* Amount selection step */
              <>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-lg">Top Up Credits</p>
                  <button onClick={closeModal}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                <p className="text-xs text-text-secondary mb-4">
                  Current balance: <span className="font-semibold text-text-primary">£{credits.toFixed(2)}</span>
                </p>

                {/* Payments due — itemised match fees the captain has requested.
                    Tap a fee to pay it: charged off a saved card instantly, or
                    via card entry otherwise. Paying refills the team credit. */}
                {myDues.length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <p className="text-xs font-bold text-red-400 uppercase tracking-wider">Payments due</p>
                      <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 rounded-full">{myDues.length}</span>
                    </div>
                    <div className="space-y-2">
                      {myDues.map((due) => {
                        const busy = dueBusy.has(due.pcsId);
                        return (
                          <div key={due.pcsId} className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">{due.kind === "tournament" ? due.opponent : `vs ${due.opponent}`}</p>
                              <p className="text-[10px] text-text-secondary">{due.date} · £{(due.remainingPence / 100).toFixed(2)} share</p>
                            </div>
                            <button
                              onClick={() => (savedCard ? payDueWithCard(due) : startCardEntryForDue(due))}
                              disabled={busy || loadingIntent}
                              className="flex-shrink-0 text-xs font-bold bg-accent text-black px-3 py-2 rounded-lg disabled:opacity-50">
                              {busy ? "Paying…" : `Pay £${(due.remainingPence / 100).toFixed(2)}`}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {savedCard ? (
                      <p className="text-[10px] text-text-secondary mt-2">Charged instantly to your saved card •••• {savedCard.last4 ?? "0000"}.</p>
                    ) : (
                      <p className="text-[10px] text-text-secondary mt-2">Tap to pay — add a card on your Profile to skip card entry next time.</p>
                    )}
                    {dueError && <p className="text-[11px] text-red-400 mt-2">{dueError}</p>}
                    <div className="flex items-center gap-2 my-4">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-text-secondary uppercase tracking-wider">or top up manually</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  </div>
                )}

                {duePaidFlash && (
                  <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2 mb-4">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <p className="text-[11px] text-accent font-semibold">Payment received — team credit topped up.</p>
                  </div>
                )}

                {/* Preset amounts */}
                <div className={`grid gap-2 mb-4 ${myOwedPence > 0 ? "grid-cols-5" : "grid-cols-4"}`}>
                  {myOwedPence > 0 && (() => {
                    const owedAmount = myOwedPence / 100;
                    return (
                      <button onClick={() => { setSelectedAmount(owedAmount); setCustomInput(""); }}
                        className={`py-3 rounded-xl border text-sm font-bold transition-colors ${selectedAmount === owedAmount && !customInput ? "bg-red-500 text-white border-red-500" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
                        £{owedAmount.toFixed(2)}
                      </button>
                    );
                  })()}
                  {[10, 20, 50, 100].map((amt) => (
                    <button key={amt} onClick={() => { setSelectedAmount(amt); setCustomInput(""); }}
                      className={`py-3 rounded-xl border text-sm font-bold transition-colors ${selectedAmount === amt && !customInput ? "bg-accent text-black border-accent" : "bg-surface-2 border-border text-text-primary"}`}>
                      £{amt}
                    </button>
                  ))}
                </div>

                {/* Custom amount */}
                <div className="relative mb-5">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary">£</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="Custom amount"
                    value={customInput}
                    onChange={(e) => { setCustomInput(e.target.value); setSelectedAmount(null); }}
                    className="w-full bg-surface-2 border border-border rounded-xl pl-7 pr-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
                  />
                </div>

                {effectiveAmount && effectiveAmount >= 1 && (
                  <div className="bg-surface-2 border border-border rounded-xl px-4 py-3 mb-4 text-xs space-y-1.5">
                    <div className="flex justify-between text-text-secondary"><span>Adding</span><span className="font-semibold text-text-primary">£{effectiveAmount.toFixed(2)}</span></div>
                    <div className="flex justify-between text-text-secondary"><span>New balance</span><span className="font-semibold text-accent">£{(credits + effectiveAmount).toFixed(2)}</span></div>
                  </div>
                )}

                {intentError && <p className="text-xs text-red-400 text-center mb-3">{intentError}</p>}

                {savedCard ? (
                  <>
                    <button
                      disabled={!effectiveAmount || effectiveAmount < 1 || topUpBusy}
                      onClick={payTopUpWithSavedCard}
                      className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {topUpBusy ? (
                        <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Charging…</>
                      ) : effectiveAmount && effectiveAmount >= 1 ? `Pay £${effectiveAmount.toFixed(2)} with •••• ${savedCard.last4 ?? "0000"}` : "Enter an amount"}
                    </button>
                    <button
                      disabled={!effectiveAmount || effectiveAmount < 1 || loadingIntent || topUpBusy}
                      onClick={handleContinue}
                      className="w-full py-2.5 text-xs text-text-secondary disabled:opacity-50"
                    >
                      {loadingIntent ? "Setting up…" : "Use a different card"}
                    </button>
                  </>
                ) : (
                  <button
                    disabled={!effectiveAmount || effectiveAmount < 1 || loadingIntent}
                    onClick={handleContinue}
                    className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loadingIntent ? (
                      <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Setting up…</>
                    ) : effectiveAmount && effectiveAmount >= 1 ? `Continue to pay £${effectiveAmount.toFixed(2)}` : "Enter an amount"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
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
