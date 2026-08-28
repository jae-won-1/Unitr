"use client";

// ── Manage Match ──────────────────────────────────────────────────────
// Deliberately shows only the NEXT TWO fixtures. My Team used to carry a full
// upcoming/past fixture list, which duplicated the Calendar — and the Calendar
// is better at it, with month grids and filters. What was missing was the other
// thing: somewhere to walk into the next game and actually organise it.
//
// So this tab is a doorway, not a list. Two cards, each with the availability
// buttons right there (answering "am I in?" without opening anything) and a tap
// through to /my-team/match/[matchId] for the real work.
//
// Tournaments appear here too but have no matches row, so they route to the
// tournament page and carry no availability buttons.
//
// The captain's own still-open posts get a section of their own, below the
// fixtures. They deliberately don't occupy the two fixture slots: nobody has
// challenged them, so there's no opponent, no matches row, and nothing to set a
// lineup or take attendance against. But they can't be left out either — a
// captain who posts a match and then finds "No fixtures coming up · Post a
// Match" has been told to do the thing they just did.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { isUpcomingDate, sortKey, fmtKickoff } from "@/lib/match-dates";
import { loadUpcomingTournamentFixtures } from "@/lib/tournament-fixtures";
import AvailabilityButtons from "@/components/AvailabilityButtons";

export type TeamFixture = {
  postId: string;
  matchRowId: string | null;
  opponent: string;
  date: string;
  time: string;
  pitch: string;
  kind: "match" | "tournament" | "open_post";
  title?: string;
  /** Only set on open posts — "Awaiting opponent" / "Pitch secured · awaiting opponent". */
  badge?: string;
};

// match_posts/challenges only carry the post id — Manage Match needs matches.id.
async function attachMatchRowIds<T extends { postId: string }>(
  fixtures: T[],
): Promise<(T & { matchRowId: string | null })[]> {
  if (fixtures.length === 0) return [];
  const { data: rows } = await supabase
    .from("matches").select("id, post_id").in("post_id", fixtures.map((f) => f.postId));
  const byPostId = new Map((rows ?? []).map((r) => [r.post_id, r.id]));
  return fixtures.map((f) => ({ ...f, matchRowId: byPostId.get(f.postId) ?? null }));
}

/**
 * Every confirmed fixture the viewer is involved in, from both sides of the
 * posting relationship: matches they posted that got challenged, and matches
 * they challenged into. Tournaments are appended from open_matches.
 */
export async function loadTeamFixtures(userId: string, teamId: string | null): Promise<TeamFixture[]> {
  const { data: myPosts } = await supabase
    .from("match_posts").select("id, match_date, match_time")
    .eq("captain_id", userId).eq("status", "matched");

  const posterFixtures = await Promise.all(
    (myPosts ?? []).map(async (post) => {
      const { data: ch } = await supabase
        .from("challenges").select("challenger_team_name, selected_pitch")
        .eq("post_id", post.id).eq("status", "accepted").maybeSingle();
      return {
        postId: post.id,
        opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
        date: post.match_date,
        time: post.match_time,
        pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
      };
    }),
  );

  const { data: myChallenges } = await supabase
    .from("challenges").select("post_id, selected_pitch")
    .eq("challenger_captain_id", userId).eq("status", "accepted");

  const challengerFixtures = await Promise.all(
    (myChallenges ?? []).map(async (c) => {
      const { data: post } = await supabase
        .from("match_posts").select("id, team_name, match_date, match_time")
        .eq("id", c.post_id).maybeSingle();
      return {
        postId: c.post_id,
        opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
        date: (post as { match_date: string } | null)?.match_date ?? "",
        time: (post as { match_time: string } | null)?.match_time ?? "",
        pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
      };
    }),
  );

  const withIds = await attachMatchRowIds([...posterFixtures, ...challengerFixtures]);
  const matchFixtures: TeamFixture[] = withIds.map((f) => ({ ...f, kind: "match" }));

  // Filtering on captain_id means a player simply gets none of these, without
  // needing to know the viewer's role here.
  const { data: openPosts } = await supabase
    .from("match_posts")
    .select("id, match_date, match_time, pitch_options, pitch_secured")
    .eq("captain_id", userId).eq("status", "open");

  const openPostFixtures: TeamFixture[] = (openPosts ?? []).map((p) => {
    const options = (p.pitch_options ?? []) as { name?: string }[];
    return {
      postId: p.id,
      matchRowId: null,
      opponent: "",
      date: p.match_date,
      time: p.match_time,
      pitch: options[0]?.name ?? "TBC",
      kind: "open_post" as const,
      badge: p.pitch_secured ? "Pitch secured · awaiting opponent" : "Awaiting opponent",
    };
  });

  const tournaments = await loadUpcomingTournamentFixtures(teamId ?? undefined);
  const tournamentFixtures: TeamFixture[] = tournaments.map((t) => ({
    postId: t.id,
    matchRowId: null,
    opponent: "",
    date: t.date,
    time: t.time,
    pitch: t.pitch,
    kind: "tournament",
    title: t.title,
  }));

  return [...matchFixtures, ...tournamentFixtures, ...openPostFixtures];
}

function FixtureCard({
  fixture, teamId, userId,
}: {
  fixture: TeamFixture;
  teamId: string;
  userId: string;
}) {
  const href = fixture.kind === "tournament"
    ? `/play/tournament/${fixture.postId}`
    : fixture.kind === "open_post"
      ? `/play/edit/${fixture.postId}`
      : fixture.matchRowId
        ? `/my-team/match/${fixture.matchRowId}`
        : null;

  const title = fixture.kind === "tournament"
    ? (fixture.title ?? "Tournament")
    : fixture.kind === "open_post"
      ? "Your match post"
      : `vs ${fixture.opponent}`;

  // Not a <button> wrapping everything: the availability row below contains its
  // own buttons, and buttons cannot nest.
  return (
    <div className={`bg-surface-2 border rounded-2xl p-4 ${
      fixture.kind === "open_post" ? "border-indigo-500/40" : "border-border"
    }`}>
      {href ? (
        <a href={href} className="block">
          <CardBody fixture={fixture} title={title} />
        </a>
      ) : (
        <CardBody fixture={fixture} title={title} />
      )}

      {fixture.kind === "match" && fixture.matchRowId && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[11px] text-text-secondary mb-1.5">Can you make it?</p>
          <AvailabilityButtons
            matchId={fixture.matchRowId}
            playerId={userId}
            teamId={teamId}
            size="sm"
          />
        </div>
      )}
    </div>
  );
}

function CardBody({ fixture, title }: { fixture: TeamFixture; title: string }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Matching the Calendar's colour language: indigo is "your post". */}
          <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border mb-1.5 ${
            fixture.kind === "open_post"
              ? "bg-indigo-500/10 text-indigo-600 border-indigo-500/40"
              : "bg-accent/10 text-accent-ink border-accent/20"
          }`}>
            {fixture.kind === "tournament" ? "Tournament" : fixture.kind === "open_post" ? "Your post" : "Match"}
          </span>
          <p className="text-sm font-bold truncate">{title}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-text-secondary mt-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        {fmtKickoff(fixture.date, fixture.time)}
      </div>
      {fixture.pitch && (
        <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span className="truncate">{fixture.pitch}</span>
        </div>
      )}
      {fixture.badge && (
        <p className="text-[11px] text-indigo-600 font-semibold mt-1.5">{fixture.badge}</p>
      )}
    </>
  );
}

export default function ManageMatchTab({
  teamId, userId, isCaptain,
}: {
  teamId: string;
  userId: string;
  isCaptain: boolean;
}) {
  const [fixtures, setFixtures] = useState<TeamFixture[]>([]);
  const [openPosts, setOpenPosts] = useState<TeamFixture[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const all = await loadTeamFixtures(userId, teamId);
    // Normalise through match-dates before comparing: legacy rows store
    // "Wed, 03 JUN 2026", which sorts above any ISO date and would otherwise
    // occupy both slots forever.
    const upcoming = all
      .filter((f) => isUpcomingDate(f.date))
      .sort((a, b) => sortKey(a.date, a.time).localeCompare(sortKey(b.date, b.time)));
    setFixtures(upcoming.filter((f) => f.kind !== "open_post").slice(0, 2));
    setOpenPosts(upcoming.filter((f) => f.kind === "open_post"));
    setLoading(false);
  }, [userId, teamId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="py-12 flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold mb-0.5">Next up</h2>
        <p className="text-xs text-text-secondary">
          {isCaptain
            ? "Open a fixture to set the lineup, tactics and squad tasks."
            : "Open a fixture to see the lineup, tactics and what you've been asked to bring."}
        </p>
      </div>

      {fixtures.length === 0 ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
          <p className="text-sm font-semibold mb-1">No confirmed fixtures yet</p>
          <p className="text-xs text-text-secondary mb-4">
            {!isCaptain
              ? "Your captain hasn't confirmed a match yet."
              : openPosts.length > 0
                // Don't tell a captain to post a match when their post is right
                // below, waiting — say what's actually missing.
                ? "Your post is live below. Once a team challenges it and you accept, the fixture appears here ready to organise."
                : "Post a match or challenge another team to get one in the diary."}
          </p>
          {isCaptain && openPosts.length === 0 && (
            <a href="/play/create" className="inline-block px-5 py-2.5 rounded-btn bg-accent text-white font-bold text-xs">
              Post a Match
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {fixtures.map((f) => (
            <FixtureCard key={`${f.kind}:${f.postId}`} fixture={f} teamId={teamId} userId={userId} />
          ))}
        </div>
      )}

      {openPosts.length > 0 && (
        <div className="space-y-3 pt-2">
          <div>
            <h2 className="text-sm font-bold mb-0.5">Waiting for an opponent</h2>
            <p className="text-xs text-text-secondary">
              Live on the match feed. There&apos;s no squad to organise until a team joins.
            </p>
          </div>
          {openPosts.map((f) => (
            <FixtureCard key={`${f.kind}:${f.postId}`} fixture={f} teamId={teamId} userId={userId} />
          ))}
        </div>
      )}

      <a href="/calendar" className="block w-full py-3 rounded-xl border border-border text-center text-sm font-semibold text-text-secondary">
        See all fixtures in Calendar
      </a>
    </div>
  );
}
