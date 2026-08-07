"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import RingerFeed from "@/components/RingerFeed";
import DateDial, { countByDate } from "@/components/DateDial";
import ChallengePanel, { type MatchPost, type PitchOption } from "@/components/ChallengePanel";
import EnterTournamentPanel from "@/components/EnterTournamentPanel";
import { fmtKickoff, isKickoffPast, toDateKey } from "@/lib/match-dates";

// The home feed for someone who has a team. Same three categories a teamless
// user sees, but nothing is greyed: Fill In is a personal one-off, Matches and
// Tournaments are things the team could enter.
//
// A squad player can't commit the team to a game — only the captain can — so
// the action here is "Suggest to team", which drops the game into the captain's
// review list rather than entering it.
//
// Note: /play still owns the captain-facing versions of these cards (challenge
// flow, buy-in panel). The read-only loaders below are deliberately separate so
// this could ship without destabilising that page; they fold together when Play
// is retired.

type Tab = "ringer" | "matches" | "tournaments";

type Tournament = {
  id: string;
  title: string;
  pitchName: string;
  matchDate: string;
  startTime: string;
  format: string | null;
  skillLevel: string;
  pricePerTeamPence: number;
  maxTeams: number;
  joinedCount: number;
  // Null for venue-hosted tournaments.
  organiserTeamName: string | null;
  // Teams already bought in — so the card can say "you're entered" instead of
  // offering the buy-in again.
  joinedTeamIds: string[];
  // Pending-invitation discount off the buy-in for the viewer's team (0 if none).
  inviteDiscountPence: number;
};

// ── Suggestions ───────────────────────────────────────────────
// Mirrors RingerFeed's handling of an unrun migration: a missing table
// disables the button with an explanation rather than throwing.
function useSuggestions(teamId: string | null, userId: string) {
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    supabase.from("match_suggestions").select("post_id").eq("team_id", teamId)
      .then(({ data, error }) => {
        if (error) { setUnavailable(true); return; }
        setSuggested(new Set((data ?? []).map((r) => r.post_id as string)));
      });
  }, [teamId]);

  const suggest = useCallback(async (postId: string, kind: "match" | "tournament") => {
    if (!teamId) return;
    setSuggested((prev) => new Set(prev).add(postId));
    const { error } = await supabase.from("match_suggestions").insert({
      team_id: teamId, suggested_by: userId, kind, post_id: postId,
    });
    // A duplicate is the desired end state anyway — only a real failure rolls back.
    if (error && !error.message.includes("duplicate")) {
      setSuggested((prev) => { const next = new Set(prev); next.delete(postId); return next; });
      setUnavailable(true);
    }
  }, [teamId, userId]);

  return { suggested, unavailable, suggest };
}

function SuggestButton({ postId, kind, suggested, unavailable, onSuggest }: {
  postId: string;
  kind: "match" | "tournament";
  suggested: boolean;
  unavailable: boolean;
  onSuggest: (id: string, kind: "match" | "tournament") => void;
}) {
  if (suggested) {
    return (
      <span className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-bold flex items-center justify-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Suggested to your captain
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSuggest(postId, kind)}
      disabled={unavailable}
      title={unavailable ? "Suggestions aren't set up yet — run supabase_match_suggestions.sql." : undefined}
      className="w-full py-2.5 rounded-xl border border-accent/40 text-accent text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Suggest to team
    </button>
  );
}

// ── Data ──────────────────────────────────────────────────────
// Selects the full post shape, not just what the card renders: a captain can
// open ChallengePanel straight from this feed, and that needs the pitch options,
// payment mode and secured-booking fields.
function useOpenMatchPosts(teamId: string | null) {
  const [posts, setPosts] = useState<MatchPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("match_posts")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setPosts(
          (data ?? [])
            .filter((r) => r.team_id !== teamId && !isKickoffPast(r.match_date, r.match_time))
            .map((r) => ({
              id: r.id,
              team_id: r.team_id,
              captain_id: r.captain_id,
              team: r.team_name,
              location: r.team_location ?? "",
              date: fmtKickoff(r.match_date, r.match_time),
              match_date: r.match_date,
              match_time: r.match_time,
              pitchOptions: (r.pitch_options ?? []) as PitchOption[],
              description: r.description ?? "",
              availabilityMatch: false,
              status: r.status,
              payment_mode: r.payment_mode ?? "credit",
              pitchSecured: Boolean(r.pitch_secured),
              securedBookingId: r.secured_booking_id ?? null,
            }))
        );
        setLoading(false);
      });
  }, [teamId]);

  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  return { posts, loading, removePost };
}

function useOpenTournaments(teamId: string | null) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: oms } = await supabase.from("open_matches")
        .select("id, title, pitch_name, match_date, start_time, format, skill_level, price_per_team_pence, max_teams, organiser_team_id, organiser_team_name")
        .eq("match_type", "tournament")
        .neq("status", "cancelled")
        .order("match_date", { ascending: true });

      const active = (oms ?? []).filter(
        (m) => m.organiser_team_id !== teamId && !isKickoffPast(m.match_date, m.start_time)
      );

      // Pending invitations for the viewer's team → discount per tournament.
      const discountByTournament = new Map<string, number>();
      if (teamId) {
        const { data: invites } = await supabase.from("tournament_invitations")
          .select("open_match_id, discount_pence").eq("team_id", teamId).eq("status", "pending");
        for (const inv of invites ?? []) discountByTournament.set(inv.open_match_id as string, inv.discount_pence ?? 0);
      }

      const withCounts = await Promise.all(active.map(async (m) => {
        const { data: joined } = await supabase.from("open_match_teams")
          .select("team_id").eq("open_match_id", m.id);
        const joinedTeamIds = (joined ?? []).map((x) => x.team_id as string);
        return {
          id: m.id,
          title: m.title,
          pitchName: m.pitch_name,
          matchDate: m.match_date,
          startTime: m.start_time,
          format: m.format,
          skillLevel: m.skill_level,
          pricePerTeamPence: m.price_per_team_pence,
          maxTeams: m.max_teams,
          joinedCount: joinedTeamIds.length,
          organiserTeamName: m.organiser_team_name ?? null,
          joinedTeamIds,
          inviteDiscountPence: discountByTournament.get(m.id) ?? 0,
        } as Tournament;
      }));

      setTournaments(withCounts);
      setLoading(false);
    }
    load();
  }, [teamId]);

  // Optimistically mark the viewer's team as entered after a successful buy-in.
  const markJoined = (id: string, joinedTeamId: string) => setTournaments((prev) => prev.map((t) =>
    t.id === id && !t.joinedTeamIds.includes(joinedTeamId)
      ? { ...t, joinedCount: t.joinedCount + 1, joinedTeamIds: [...t.joinedTeamIds, joinedTeamId] }
      : t
  ));

  return { tournaments, loading, markJoined };
}

// ── Cards ─────────────────────────────────────────────────────
function MatchPostCard({ post, children }: { post: MatchPost; children: React.ReactNode }) {
  const initials = post.team.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-accent">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{post.team}</p>
          <p className="text-xs text-text-secondary truncate mt-0.5">{post.location || "Location TBC"}</p>
        </div>
        {post.pitchSecured && (
          <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full flex-shrink-0">
            Pitch Secured
          </span>
        )}
      </div>

      <div className="space-y-1 mb-3">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          {post.date}
        </div>
        {post.pitchOptions.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {post.pitchOptions.length} pitch option{post.pitchOptions.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {post.description && <p className="text-xs text-text-secondary mb-3 line-clamp-2">{post.description}</p>}
      {children}
    </div>
  );
}

// Captain's action on an opponent's post — opens the same challenge flow the
// Play page uses.
function ChallengeButton({ post, onMatched }: { post: MatchPost; onMatched: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
        {post.pitchSecured ? "Join — Pitch Secured" : "Challenge Team"}
      </button>
      {open && (
        <ChallengePanel
          post={post}
          onClose={() => setOpen(false)}
          onMatched={(id) => { setOpen(false); onMatched(id); }}
        />
      )}
    </>
  );
}

function TournamentPostCard({ t, children }: { t: Tournament; children: React.ReactNode }) {
  const spotsLeft = Math.max(0, t.maxTeams - t.joinedCount);
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{t.title}</p>
          <p className="text-xs text-text-secondary truncate mt-0.5">{t.pitchName}</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 border ${
          spotsLeft === 0
            ? "bg-surface text-text-secondary border-border"
            : "bg-accent/10 text-accent border-accent/30"
        }`}>
          {spotsLeft === 0 ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
        </span>
      </div>

      <div className="space-y-1 mb-3">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          {fmtKickoff(t.matchDate, t.startTime)}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          {[t.format, t.skillLevel].filter(Boolean).join(" · ")} · {t.joinedCount}/{t.maxTeams} teams
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-lg font-bold text-accent">£{(t.pricePerTeamPence / 100).toFixed(2)}</span>
        <span className="text-[11px] text-text-secondary">per team</span>
      </div>

      {children}
    </div>
  );
}

// ── Enter Tournament CTA ──────────────────────────────────────
// Entering is a real transaction — the team's buy-in leaves team credit — so the
// button raises the confirmation sheet rather than linking straight through.
// The detail page (/play/tournament/[id]) is the schedule/referee view; it's the
// secondary link here, not the action.
function EnterTournamentButton({ t, teamId, teamName, onJoined }: {
  t: Tournament;
  teamId: string | null;
  teamName: string | null;
  onJoined: () => void;
}) {
  const [open, setOpen] = useState(false);
  const alreadyIn = teamId ? t.joinedTeamIds.includes(teamId) : false;
  const isFull = t.joinedCount >= t.maxTeams;
  const discounted = Math.max(0, t.pricePerTeamPence - t.inviteDiscountPence);

  return (
    <div className="space-y-2">
      {alreadyIn ? (
        <div className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-center text-sm font-semibold text-accent">Your team is entered ✓</div>
      ) : isFull ? (
        <div className="w-full py-2.5 rounded-xl bg-surface border border-border text-center text-sm font-semibold text-text-secondary">Tournament full</div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
          {t.inviteDiscountPence > 0
            ? `Accept invitation — £${(discounted / 100).toFixed(2)}`
            : "Enter Tournament"}
        </button>
      )}
      <a href={`/play/tournament/${t.id}`}
        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-surface border border-border text-sm font-semibold text-text-primary">
        View schedule &amp; referees
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
      </a>

      {open && (
        <EnterTournamentPanel
          tournament={{
            id: t.id, title: t.title, pitchName: t.pitchName,
            matchDate: t.matchDate, startTime: t.startTime,
            pricePerTeamPence: t.pricePerTeamPence, maxTeams: t.maxTeams,
            joinedCount: t.joinedCount,
            organiserName: t.organiserTeamName ?? t.pitchName,
            inviteDiscountPence: t.inviteDiscountPence,
          }}
          myTeamId={teamId}
          myTeamName={teamName}
          onClose={() => setOpen(false)}
          onJoined={() => { setOpen(false); onJoined(); }}
        />
      )}
    </div>
  );
}

// ── Feed ──────────────────────────────────────────────────────
export default function GameFeed({ teamId, userId, canAct = false, matchesHeader }: {
  teamId: string | null;
  userId: string;
  // Captains commit the team directly — challenge a post, enter a tournament.
  // Squad players can only put a game in front of their captain.
  canAct?: boolean;
  // Status pinned above the Matches list — the captain's own live post.
  matchesHeader?: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("matches");
  // Shared between Matches and Tournaments so switching category keeps the day
  // you're looking at. Fill In keeps its own dial inside RingerFeed, since its
  // dates come from a separate query.
  const [dateKey, setDateKey] = useState<string | null>(null);
  const { posts, loading: postsLoading, removePost } = useOpenMatchPosts(teamId);
  const { tournaments, loading: tLoading, markJoined } = useOpenTournaments(teamId);
  const { suggested, unavailable, suggest } = useSuggestions(teamId, userId);
  // Only needed for the tournament buy-in, which stamps the entry with the name.
  const [teamName, setTeamName] = useState<string | null>(null);
  useEffect(() => {
    if (!teamId) { setTeamName(null); return; }
    supabase.from("teams").select("name").eq("id", teamId).maybeSingle()
      .then(({ data }) => setTeamName(data?.name ?? null));
  }, [teamId]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "ringer", label: "Fill In" },
    { key: "matches", label: "Matches" },
    { key: "tournaments", label: "Tournaments" },
  ];

  const visiblePosts = dateKey ? posts.filter((p) => toDateKey(p.match_date) === dateKey) : posts;
  const visibleTournaments = dateKey ? tournaments.filter((t) => toDateKey(t.matchDate) === dateKey) : tournaments;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ringer" && <RingerFeed showIntro={false} showDateDial />}

      {tab === "matches" && (
        postsLoading ? (
          <div className="flex justify-center py-8"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            {matchesHeader}
            <DateDial value={dateKey} onChange={setDateKey} counts={countByDate(posts, (p) => p.match_date)} />
            {visiblePosts.length === 0 ? (
              <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
                <p className="text-sm text-text-secondary">
                  {posts.length > 0 ? "No matches posted for this day." : "No open matches right now."}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  {posts.length > 0
                    ? "Try another date, or pick All to see everything."
                    : "Posts from other teams looking for an opponent show up here."}
                </p>
              </div>
            ) : (
              visiblePosts.map((p) => (
                <MatchPostCard key={p.id} post={p}>
                  {canAct
                    ? <ChallengeButton post={p} onMatched={removePost} />
                    : <SuggestButton postId={p.id} kind="match" suggested={suggested.has(p.id)} unavailable={unavailable} onSuggest={suggest} />}
                </MatchPostCard>
              ))
            )}
          </div>
        )
      )}

      {tab === "tournaments" && (
        tLoading ? (
          <div className="flex justify-center py-8"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <DateDial value={dateKey} onChange={setDateKey} counts={countByDate(tournaments, (t) => t.matchDate)} />
            {visibleTournaments.length === 0 ? (
              <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
                <p className="text-sm text-text-secondary">
                  {tournaments.length > 0 ? "No tournaments on this day." : "No tournaments right now."}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  {tournaments.length > 0
                    ? "Try another date, or pick All to see everything."
                    : "Venue and team-hosted tournaments show up here."}
                </p>
              </div>
            ) : (
              visibleTournaments.map((t) => (
                <TournamentPostCard key={t.id} t={t}>
                  {canAct
                    ? (
                      <EnterTournamentButton
                        t={t}
                        teamId={teamId}
                        teamName={teamName}
                        onJoined={() => teamId && markJoined(t.id, teamId)}
                      />
                    )
                    : <SuggestButton postId={t.id} kind="tournament" suggested={suggested.has(t.id)} unavailable={unavailable} onSuggest={suggest} />}
                </TournamentPostCard>
              ))
            )}
          </div>
        )
      )}
    </section>
  );
}
