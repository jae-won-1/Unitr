"use client";

import { useEffect, useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import RingerFeed from "@/components/RingerFeed";
import QuickNav from "@/components/QuickNav";
import TeamsPanel from "@/components/TeamsPanel";
import PlayerActionStrip from "@/components/PlayerActionStrip";
import GameFeed, { GameTypeSelect } from "@/components/GameFeed";
import TeamCreditsBar from "@/components/TeamCreditsBar";
import PollStatusTile from "@/components/PollStatusTile";
import MyPostCard, { useMyPosts } from "@/components/MyPostCard";
import SuggestionsStrip from "@/components/SuggestionsStrip";
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
  /** matches.id — the id Manage Match needs. `id` above is the post id. */
  matchId?: string | null;
};

// ── Shared data ──────────────────────────────────────────────
// A join request leaves the requester classed as `new_user` until a captain
// approves it — RoleContext only counts approved memberships. Without this the
// user lands back on an identical onboarding home with no trace of the request
// and re-sends it, so surface the pending state explicitly.
// The viewer's team, whether they captain it or were approved into it.
function useMyTeamId(userId: string | undefined) {
  const [teamId, setTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { setTeamId(null); return; }
    async function load() {
      const { data: own } = await supabase.from("teams").select("id").eq("captain_id", userId!).maybeSingle();
      if (own) { setTeamId(own.id); return; }
      const { data: mem } = await supabase.from("team_members")
        .select("team_id").eq("player_id", userId!).eq("status", "approved").maybeSingle();
      setTeamId(mem?.team_id ?? null);
    }
    load();
  }, [userId]);

  return teamId;
}

type PendingRequest = { teamId: string; teamName: string };

function usePendingJoinRequests(userId: string | undefined) {
  const [pending, setPending] = useState<PendingRequest[]>([]);

  useEffect(() => {
    if (!userId) { setPending([]); return; }

    async function load() {
      const { data: rows } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("player_id", userId!)
        .eq("status", "pending");
      if (!rows || rows.length === 0) { setPending([]); return; }

      const { data: teams } = await supabase
        .from("teams").select("id, name").in("id", rows.map((r) => r.team_id));
      setPending((teams ?? []).map((t) => ({ teamId: t.id, teamName: t.name as string })));
    }
    load();
  }, [userId]);

  return pending;
}

// Players waiting on the captain to approve them. Exception-based: the count
// already lives in the TopBar bell, so home only speaks up when there is
// actually something to review.
function useJoinRequestCount(teamId: string | null) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!teamId) { setCount(0); return; }
    supabase.from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId).eq("status", "pending")
      .then(({ count: c }) => setCount(c ?? 0));
  }, [teamId]);

  return count;
}

function JoinRequestsStrip({ count }: { count: number }) {
  return (
    <a href="/my-team/transfer"
      className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-2xl p-4">
      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-accent-ink">
          {count} player{count === 1 ? "" : "s"} want{count === 1 ? "s" : ""} to join
        </p>
        <p className="text-xs text-text-secondary mt-0.5 truncate">Review and approve them in Transfer Window</p>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </a>
  );
}

function PendingRequestStrip({ request }: { request: PendingRequest }) {
  return (
    <a href={`/my-team/${request.teamId}`}
      className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4">
      <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-yellow-600">Request pending</p>
        <p className="text-xs text-text-secondary mt-0.5 truncate">
          Waiting on {request.teamName} to approve you
        </p>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    </a>
  );
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

      // Both sides above only know the post id, but Manage Match is keyed by
      // matches.id — linking with the post id landed on "Match not found".
      // One lookup for every post, same as lib/calendar-entries.ts.
      const matchFixtures = [...posterFixtures, ...challengerFixtures];
      if (matchFixtures.length > 0) {
        const { data: matchRows } = await supabase
          .from("matches")
          .select("id, post_id")
          .in("post_id", matchFixtures.map((f) => f.id));
        const matchByPost = new Map((matchRows ?? []).map((r) => [r.post_id as string, r.id as string]));
        for (const f of matchFixtures) f.matchId = matchByPost.get(f.id) ?? null;
      }

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
// The rebrand's hero card: a stylised pitch banner carrying the status badge,
// then the fixture in a display face over a plain white body. `action` is the
// management CTA the viewer is entitled to — it lives inside the card in the
// new design rather than as a separate button underneath, so a card with no
// action simply ends after the venue line.
function ConfirmedFixtureCard({ fixture, action }: { fixture: ConfirmedFixture; action?: React.ReactNode }) {
  const isTournament = fixture.kind === "tournament";
  const Wrapper = isTournament ? "a" : "div";
  return (
    <Wrapper {...(isTournament ? { href: `/play/tournament/${fixture.id}` } : {})}
      className="block bg-surface border border-border rounded-card shadow-card overflow-hidden">
      <div className="pitch-art pitch-art-line h-[110px]">
        <span className="pitch-halfway" />
        <span className="absolute top-2.5 left-2.5 bg-accent-2 text-white text-[10px] font-extrabold tracking-[0.06em] px-2.5 py-1 rounded-full">
          {isTournament ? "TOURNAMENT" : "CONFIRMED"}
        </span>
      </div>
      <div className="px-4 pt-3.5 pb-4 flex flex-col gap-2.5">
        <span className="text-[13px] font-extrabold text-accent-ink uppercase">
          {fixture.date} · {fixture.time}
        </span>
        <p className="text-xl font-extrabold tracking-[-0.01em] uppercase truncate">
          {isTournament ? fixture.title : `vs ${fixture.opponent}`}
        </p>
        <p className="text-[13px] font-medium text-text-secondary truncate">{fixture.pitch}</p>
        <p className="text-[11px] font-medium text-text-secondary">
          {isTournament ? "Tournament" : fixture.side === "poster" ? "You posted · they challenged" : "You challenged"}
        </p>
        {action}
      </div>
    </Wrapper>
  );
}

// The game-type toggle above the feed. For someone without a team, Matches and
// Tournaments are both team-entry only, so they render greyed rather than
// hidden — the point is to show what joining a team unlocks. A signed-out
// visitor sees the identical control; only the note under it differs, because
// for them the missing step is the account, not the team.
function TeamlessFeedToggle({ note }: { note?: string }) {
  return (
    // The same dropdown GameFeed uses, so the control doesn't change shape when
    // joining a team unlocks it — only what's inside does. Fill In is the sole
    // option that can be picked, so it's also the value.
    <GameTypeSelect
      value="ringer"
      onChange={() => {}}
      locked={["all", "matches", "tournaments"]}
      note={note ?? "Matches and tournaments are team entries — join or register a team to unlock them."}
    />
  );
}

// ── POV Views ────────────────────────────────────────────────
function NewUserHome() {
  const { user } = useAuth();
  const pending = usePendingJoinRequests(user?.id);

  // Registered but not yet in a team. The shape mirrors the other two homes —
  // quick nav, status strips, then a feed — so nothing about the page moves
  // once they join a team.
  if (user) {
    return (
      <div className="flex flex-col gap-6">
        <QuickNav />

        {pending.map((p) => <PendingRequestStrip key={p.teamId} request={p} />)}

        <a href="/my-team/create" className="bg-accent text-white rounded-2xl p-4 flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Register Your Team</p>
            <p className="text-xs font-normal opacity-70">Become a captain</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </a>

        <TeamsPanel />

        <section className="space-y-4">
          <h3 className="font-bold">Find Matches</h3>
          <TeamlessFeedToggle />
          <RingerFeed showIntro={false} showDateDial />
        </section>
      </div>
    );
  }

  // Not logged in — landing page
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl bg-surface-2 border border-border p-4">
        <div className="flex gap-3">
          <a href="/register" className="flex-1 py-3 rounded-btn bg-accent text-white font-semibold text-sm text-center">Register</a>
          <a href="/login" className="flex-1 py-3 rounded-xl border border-border text-text-primary font-semibold text-sm text-center">Sign In</a>
        </div>
      </section>
      <QuickNav />
      <TeamsPanel />

      {/* Match discovery, same shape as the teamless-but-registered home above.
          A visitor should be able to see there are real games happening here
          before being asked for anything — tapping a team or a match is what
          raises the sign-up gate, not scrolling. */}
      <section className="space-y-4">
        <div>
          <h3 className="font-bold">Find Matches</h3>
          <p className="text-xs text-text-secondary mt-0.5">Teams near you looking for players</p>
        </div>
        <TeamlessFeedToggle note="Matches and tournaments are team entries — create an account and join a team to unlock them." />
        <RingerFeed showIntro={false} showDateDial />
      </section>
    </div>
  );
}

function PlayerHome({ userId }: { userId: string | undefined }) {
  const { fixtures, loading: fixturesLoading } = useConfirmedFixtures(userId);
  const teamId = useMyTeamId(userId);
  const next = fixtures[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <QuickNav />

      {/* What the captain needs from you — both resolve in a popup */}
      {userId && <PlayerActionStrip teamId={teamId} userId={userId} />}

      {/* Next fixture only. Everything else lives in the calendar. */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Next Fixture</h3>
            <p className="text-xs text-text-secondary mt-0.5">Confirmed matches only</p>
          </div>
          <a href="/calendar" className="text-xs text-accent-ink font-medium">See all</a>
        </div>
        {fixturesLoading ? (
          <div className="flex justify-center py-6"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : !next ? (
          <div className="bg-surface border border-border shadow-card rounded-card p-5 text-center">
            <p className="text-sm text-text-secondary">No confirmed fixtures yet.</p>
            <p className="text-xs text-text-secondary mt-1">Matches will appear here once confirmed.</p>
          </div>
        ) : (
          <ConfirmedFixtureCard fixture={next} />
        )}
      </section>

      {/* Games the team could enter */}
      {userId && <GameFeed teamId={teamId} userId={userId} />}
    </div>
  );
}

function CaptainHome({ userId }: { userId: string | undefined }) {
  const { fixtures, loading: fixturesLoading } = useConfirmedFixtures(userId);
  const teamId = useMyTeamId(userId);
  const joinRequests = useJoinRequestCount(teamId);
  const { posts: myPosts, removePost: removeMyPost } = useMyPosts(userId);
  const next = fixtures[0] ?? null;
  const myPost = myPosts[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <QuickNav />

      {joinRequests > 0 && <JoinRequestsStrip count={joinRequests} />}

      <SuggestionsStrip teamId={teamId} />

      {/* Money: credits, top up / settle up, payment status, settle payments */}
      {userId && (
        <section>
          <h3 className="text-lg font-bold tracking-[-0.01em] uppercase mb-2">Team Money</h3>
          <TeamCreditsBar userId={userId} role="captain" />
        </section>
      )}

      {/* Availability poll progress */}
      <PollStatusTile teamId={teamId} userId={userId} />

      {/* Next fixture only. Everything else lives in the calendar. */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <h3 className="text-lg font-bold tracking-[-0.01em] uppercase">Next Fixture</h3>
          <a href="/calendar" className="text-xs text-accent-ink font-semibold">See all</a>
        </div>
        {fixturesLoading ? (
          <div className="flex justify-center py-6"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : !next ? (
          <div className="bg-surface border border-border shadow-card rounded-card p-5 text-center">
            <p className="text-sm text-text-secondary">No confirmed fixtures yet.</p>
            <a href="/play/create" className="inline-block mt-2 text-xs text-accent-ink font-semibold">Post a match to get started →</a>
          </div>
        ) : (
          <ConfirmedFixtureCard
            fixture={next}
            action={next.kind === "match" && (
              next.matchId ? (
                <a href={`/my-team/match/${next.matchId}`}
                  className="block w-full py-3 rounded-btn bg-accent text-white text-sm font-bold text-center">
                  Manage match
                </a>
              ) : (
                /* Greyed, not hidden — a missing button shifts the card below it. */
                <div className="w-full py-3 rounded-btn border border-border text-text-secondary text-sm font-bold text-center">
                  Manage match
                  <span className="block text-[10px] font-normal mt-0.5">Available once the match record is created</span>
                </div>
              )
            )}
          />
        )}
      </section>

      {/* Games to enter — captains act directly, with their own live post pinned above */}
      {userId && (
        <GameFeed
          teamId={teamId}
          userId={userId}
          canAct
          matchesHeader={myPost ? <MyPostCard post={myPost} onRemoved={removeMyPost} /> : null}
        />
      )}
    </div>
  );
}

function AdminHome({ userId }: { userId: string | undefined }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Hosting hub CTA — admins post events from /admin, not /play/create */}
      <section className="bg-surface border border-border shadow-card rounded-card p-5">
        <h2 className="text-lg font-bold">Unitr Admin</h2>
        <p className="text-sm text-text-secondary mt-1">
          Host and manage tournaments, leagues and friendlies on pitches booked
          outside the app.
        </p>
        <a href="/admin"
          className="inline-block mt-3 px-4 py-2.5 rounded-btn bg-accent text-white text-sm font-bold">
          Open the Admin hub
        </a>
      </section>

      {/* The feed exactly as players see it — read-only, no team behind it */}
      {userId && <GameFeed teamId={null} userId={userId} />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function HomePage() {
  const { role, roleLoading } = useRole();
  const { user } = useAuth();

  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    /* Search lives in the Transfer Market now — home is a dashboard of things
       already happening to you, and a search box there only led away from it. */
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      {role === "new_user" && <NewUserHome />}
      {role === "player" && <PlayerHome userId={user?.id} />}
      {role === "captain" && <CaptainHome userId={user?.id} />}
      {role === "admin" && <AdminHome userId={user?.id} />}
    </div>
  );
}
