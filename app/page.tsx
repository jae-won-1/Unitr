"use client";

import { useEffect, useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import HomeSearchBar from "@/components/HomeSearchBar";
import RingerFeed from "@/components/RingerFeed";
import { loadUpcomingTournamentFixtures } from "@/lib/tournament-fixtures";
import { isUpcomingDate, sortKey } from "@/lib/match-dates";

type ConfirmedFixture = {
  id: string;
  opponent: string;
  date: string;
  time: string;
  pitch: string;
  side: "poster" | "challenger";
  kind: "match" | "tournament";
  title?: string;
};

// ── Shared data ──────────────────────────────────────────────
type NearbyTeam = { id: string; name: string; location: string; level: string; format: string; description: string };

function useNearbyTeams() {
  const [teams, setTeams] = useState<NearbyTeam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("teams").select("id, name, location, level, format, description").limit(3)
      .then(({ data }) => {
        setTeams(data ?? []);
        setLoading(false);
      });
  }, []);

  return { teams, loading };
}

function useConfirmedFixtures(userId: string | undefined) {
  const [fixtures, setFixtures] = useState<ConfirmedFixture[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }

    async function load() {
      // Side A: posts I created that are now matched
      const { data: myPosts } = await supabase
        .from("match_posts")
        .select("id, team_name, match_date, match_time")
        .eq("captain_id", userId)
        .eq("status", "matched");

      const posterFixtures: ConfirmedFixture[] = await Promise.all(
        (myPosts ?? []).map(async (post) => {
          const { data: challenge } = await supabase
            .from("challenges")
            .select("challenger_team_name, selected_pitch")
            .eq("post_id", post.id)
            .eq("status", "accepted")
            .maybeSingle();
          return {
            id: post.id,
            opponent: (challenge as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
            date: post.match_date,
            time: post.match_time,
            pitch: ((challenge as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
            side: "poster" as const,
            kind: "match" as const,
          };
        })
      );

      // Side B: challenges I sent that were accepted
      const { data: myChallenges } = await supabase
        .from("challenges")
        .select("post_id, selected_pitch")
        .eq("challenger_captain_id", userId)
        .eq("status", "accepted");

      const challengerFixtures: ConfirmedFixture[] = await Promise.all(
        (myChallenges ?? []).map(async (c) => {
          const { data: post } = await supabase
            .from("match_posts")
            .select("id, team_name, match_date, match_time")
            .eq("id", c.post_id)
            .maybeSingle();
          return {
            id: c.post_id,
            opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
            date: (post as { match_date: string } | null)?.match_date ?? "",
            time: (post as { match_time: string } | null)?.match_time ?? "",
            pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
            side: "challenger" as const,
            kind: "match" as const,
          };
        })
      );

      // Resolve this user's team (captain or approved member) to pull in
      // tournament fixtures — entered or hosted — alongside matches.
      const { data: ownTeam } = await supabase.from("teams").select("id").eq("captain_id", userId).maybeSingle();
      let teamId: string | null = ownTeam?.id ?? null;
      if (!teamId) {
        const { data: membership } = await supabase.from("team_members")
          .select("team_id").eq("player_id", userId).eq("status", "approved").maybeSingle();
        teamId = membership?.team_id ?? null;
      }
      const tournaments = await loadUpcomingTournamentFixtures(teamId);
      const tournamentFixtures: ConfirmedFixture[] = tournaments.map((t) => ({
        id: t.id,
        opponent: "",
        date: t.date,
        time: t.time,
        pitch: t.pitch,
        side: "poster" as const,
        kind: "tournament" as const,
        title: t.title,
      }));

      // Home only surfaces upcoming, confirmed fixtures — nearest first.
      // Dates are normalised first: legacy rows store "Wed, 03 JUN 2026", which
      // compares greater than any ISO date and would never leave Upcoming.
      const upcoming = [...posterFixtures, ...challengerFixtures, ...tournamentFixtures]
        .filter((f) => isUpcomingDate(f.date))
        .sort((a, b) => sortKey(a.date, a.time).localeCompare(sortKey(b.date, b.time)));

      setFixtures(upcoming);
      setLoading(false);
    }

    load();
  }, [userId]);

  return { fixtures, loading };
}

// Renders a fixtures list capped at 3, expandable via See more / See less.
function UpcomingFixturesList({ fixtures }: { fixtures: ConfirmedFixture[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? fixtures : fixtures.slice(0, 3);
  return (
    <div className="space-y-3">
      {shown.map((f) => <ConfirmedFixtureCard key={f.id} fixture={f} />)}
      {fixtures.length > 3 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary"
        >
          {expanded ? "See less" : `See more (${fixtures.length - 3})`}
        </button>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────
function TeamCard({ team }: { team: NearbyTeam }) {
  return (
    <a href={`/my-team/${team.id}`} className="block bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-accent">{team.name.split(" ").map((w) => w[0]).join("").slice(0,2)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{team.name}</p>
          <p className="text-xs text-text-secondary">{team.location}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-lg flex-shrink-0 ${team.level === "Casual" ? "bg-blue-500/10 text-blue-400" : team.level === "Competitive" ? "bg-orange-500/10 text-orange-400" : "bg-purple-500/10 text-purple-400"}`}>
          {team.level}
        </span>
      </div>
      {team.description && <p className="text-xs text-text-secondary line-clamp-1">{team.description}</p>}
    </a>
  );
}

function ConfirmedFixtureCard({ fixture }: { fixture: ConfirmedFixture }) {
  const isTournament = fixture.kind === "tournament";
  const Wrapper = isTournament ? "a" : "div";
  return (
    <Wrapper {...(isTournament ? { href: `/play/tournament/${fixture.id}` } : {})}
      className="block bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{isTournament ? fixture.title : `vs ${fixture.opponent}`}</p>
          <p className="text-xs text-text-secondary mt-0.5">
            {isTournament ? "Tournament" : fixture.side === "poster" ? "You posted · they challenged" : "You challenged"}
          </p>
        </div>
        <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">
          {isTournament ? "Tournament" : "Confirmed"}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          {fixture.date} · {fixture.time}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {fixture.pitch}
        </div>
      </div>
    </Wrapper>
  );
}

// Home splits into the usual dashboard and a Fill In feed of ringer spots —
// the quick way into a game when your team has nothing on, or you have no team
// yet. Deep-linkable via /?tab=ringer.
type HomeTab = "home" | "ringer";

function useHomeTab() {
  const [tab, setTab] = useState<HomeTab>("home");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "ringer") setTab("ringer");
  }, []);
  return { tab, setTab };
}

function HomeTabs({ tab, setTab }: { tab: HomeTab; setTab: (t: HomeTab) => void }) {
  return (
    <div className="flex items-center gap-2">
      {([{ key: "home", label: "Home" }, { key: "ringer", label: "Fill In" }] as { key: HomeTab; label: string }[]).map((t) => (
        <button key={t.key} type="button" onClick={() => setTab(t.key)}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function EmptySocialFeed() {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
      <p className="text-sm text-text-secondary">No posts yet.</p>
      <p className="text-xs text-text-secondary mt-1">Match results, highlights, and stats from your area will show up here.</p>
    </div>
  );
}

// ── POV Views ────────────────────────────────────────────────
function NewUserHome() {
  const { user } = useAuth();
  const { teams, loading: teamsLoading } = useNearbyTeams();
  const { tab, setTab } = useHomeTab();

  // Logged in but not yet in a team — show onboarding
  if (user) {
    return (
      <div className="flex flex-col gap-6">
        <HomeTabs tab={tab} setTab={setTab} />
        {tab === "ringer" ? <RingerFeed /> : <>
        <section className="rounded-2xl bg-surface-2 border border-border p-5">
          <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-1">Welcome to Unitr</p>
          <h2 className="text-lg font-bold mb-1">You&apos;re in — now pick your path</h2>
          <p className="text-text-secondary text-sm">Register your own team as captain, or find an existing team to join.</p>
        </section>
        <div className="grid grid-cols-2 gap-3">
          <a href="/my-team/create" className="bg-accent text-black rounded-2xl p-4 flex flex-col gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <p className="text-sm font-bold">Register Your Team</p>
            <p className="text-xs font-normal opacity-70">Become a captain</p>
          </a>
          <a href="/my-team" className="bg-surface-2 border border-border rounded-2xl p-4 flex flex-col gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <p className="text-sm font-bold">Find a Team</p>
            <p className="text-xs text-text-secondary">Browse and request to join</p>
          </a>
        </div>
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold">Teams Near You</h3>
              <p className="text-xs text-text-secondary mt-0.5">Find a team to join</p>
            </div>
            <a href="/my-team" className="text-xs text-accent font-medium">See all</a>
          </div>
          {teamsLoading ? (
            <div className="flex justify-center py-6"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
          ) : teams.length === 0 ? (
            <div className="bg-surface-2 border border-border rounded-2xl p-5 text-center">
              <p className="text-sm text-text-secondary">No teams registered yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {teams.map((t) => <TeamCard key={t.id} team={t} />)}
            </div>
          )}
        </section>
        <EmptySocialFeed />
        </>}
      </div>
    );
  }

  // Not logged in — landing page
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl bg-surface-2 border border-border p-6 text-center">
        <p className="text-text-secondary text-sm mb-2">The football platform</p>
        <h2 className="text-2xl font-bold mb-1">Connect. Compete.</h2>
        <h2 className="text-2xl font-bold text-accent mb-3">Conquer Together.</h2>
        <p className="text-text-secondary text-sm mb-5">Find opponents, book pitches, and build your legacy.</p>
        <div className="flex gap-3">
          <a href="/register" className="flex-1 py-3 rounded-xl bg-accent text-black font-semibold text-sm text-center">Register</a>
          <a href="/login" className="flex-1 py-3 rounded-xl border border-border text-text-primary font-semibold text-sm text-center">Sign In</a>
        </div>
      </section>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Teams Near You</h3>
            <p className="text-xs text-text-secondary mt-0.5">Find a team to join</p>
          </div>
          <a href="/my-team" className="text-xs text-accent font-medium">See all</a>
        </div>
        {teamsLoading ? (
          <div className="flex justify-center py-6"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : teams.length === 0 ? (
          <div className="bg-surface-2 border border-border rounded-2xl p-5 text-center">
            <p className="text-sm text-text-secondary">No teams registered yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teams.map((t) => <TeamCard key={t.id} team={t} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function PlayerHome({ userId }: { userId: string | undefined }) {
  const { fixtures, loading: fixturesLoading } = useConfirmedFixtures(userId);
  const { tab, setTab } = useHomeTab();

  return (
    <div className="flex flex-col gap-6">
      <HomeTabs tab={tab} setTab={setTab} />

      {tab === "ringer" ? <RingerFeed /> : <>

      {/* Availability notification */}
      <a href="/my-team/availability" className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
        <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FB923C" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-orange-400">Action needed</p>
          <p className="text-xs text-text-secondary mt-0.5 truncate">Captain wants your availability for the next match</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>

      {/* Confirmed fixtures */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Upcoming Fixtures</h3>
            <p className="text-xs text-text-secondary mt-0.5">Confirmed matches only</p>
          </div>
          <a href="/my-team" className="text-xs text-accent font-medium">See all</a>
        </div>
        {fixturesLoading ? (
          <div className="flex justify-center py-6"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : fixtures.length === 0 ? (
          <div className="bg-surface-2 border border-border rounded-2xl p-5 text-center">
            <p className="text-sm text-text-secondary">No confirmed fixtures yet.</p>
            <p className="text-xs text-text-secondary mt-1">Matches will appear here once confirmed.</p>
          </div>
        ) : (
          <UpcomingFixturesList fixtures={fixtures} />
        )}
      </section>

      {/* Social feed */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Your Area</h3>
            <p className="text-xs text-text-secondary mt-0.5">Results, highlights &amp; local news</p>
          </div>
        </div>
        <EmptySocialFeed />
      </section>
      </>}
    </div>
  );
}

function CaptainHome({ userId }: { userId: string | undefined }) {
  const { fixtures, loading: fixturesLoading } = useConfirmedFixtures(userId);
  const { tab, setTab } = useHomeTab();

  return (
    <div className="flex flex-col gap-6">
      <HomeTabs tab={tab} setTab={setTab} />

      {tab === "ringer" ? <RingerFeed /> : <>

      {/* Quick actions */}
      <section>
        <h3 className="font-bold mb-3">Quick Actions</h3>
        <div className="flex justify-between gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            {
              label: "Fill in for Game", href: "/play?tab=ringer",
              icon: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /><path d="M19 8v6" /><path d="M16 11h6" /></>,
            },
            {
              label: "Transfer Window", href: "/my-team/transfer",
              icon: <><path d="M17 3l4 4-4 4" /><path d="M21 7H7" /><path d="M7 21l-4-4 4-4" /><path d="M3 17h14" /></>,
            },
            {
              label: "Calendar", href: "/my-team/availability",
              icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
            },
            {
              label: "Book Court", href: "/book",
              icon: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M12 5v14" /><circle cx="12" cy="12" r="3" /></>,
            },
            {
              label: "Stats", href: "/profile",
              icon: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
            },
          ].map((action) => (
            <a key={action.label} href={action.href} className="flex flex-col items-center gap-2 flex-1 min-w-[64px]">
              <span className="w-14 h-14 rounded-full bg-accent text-black flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {action.icon}
                </svg>
              </span>
              <p className="text-[11px] font-semibold text-center leading-tight">{action.label}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Confirmed fixtures */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Upcoming Fixtures</h3>
            <p className="text-xs text-text-secondary mt-0.5">Confirmed matches only</p>
          </div>
          <a href="/my-team" className="text-xs text-accent font-medium">See all</a>
        </div>
        {fixturesLoading ? (
          <div className="flex justify-center py-6"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : fixtures.length === 0 ? (
          <div className="bg-surface-2 border border-border rounded-2xl p-5 text-center">
            <p className="text-sm text-text-secondary">No confirmed fixtures yet.</p>
            <a href="/play/create" className="inline-block mt-2 text-xs text-accent font-medium">Post a match to get started →</a>
          </div>
        ) : (
          <UpcomingFixturesList fixtures={fixtures} />
        )}
      </section>

      {/* Social feed */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Your Area</h3>
            <p className="text-xs text-text-secondary mt-0.5">Results, highlights &amp; local news</p>
          </div>
        </div>
        <EmptySocialFeed />
      </section>
      </>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function HomePage() {
  const { role, roleLoading } = useRole();
  const { user } = useAuth();

  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16">
      <HomeSearchBar />
      {role === "new_user" && <NewUserHome />}
      {role === "player" && <PlayerHome userId={user?.id} />}
      {role === "captain" && <CaptainHome userId={user?.id} />}
    </div>
  );
}
