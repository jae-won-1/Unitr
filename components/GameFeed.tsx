"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// "all" is the default — the feed's job is discovery, and three separate tabs
// meant a game only ever showed up if you already knew which category to look
// in. The named types stay as a way to narrow the search, now from a dropdown
// rather than a row of pills that ran out of width as categories were added.
type Tab = "all" | "ringer" | "matches" | "tournaments";

export const GAME_TYPES: { key: Tab; label: string }[] = [
  { key: "all", label: "All games" },
  { key: "matches", label: "Matches" },
  { key: "tournaments", label: "Tournaments" },
  { key: "ringer", label: "Fill In" },
];

// ── Game-type dropdown ────────────────────────────────────────
// Shared with the teamless home (app/page.tsx), which renders the same control
// with everything but Fill In locked, so both roles get an identical shape.
export function GameTypeSelect({ value, onChange, locked = [], note }: {
  value: Tab;
  onChange: (v: Tab) => void;
  // Types this viewer can't use. Greyed inside the open menu rather than
  // dropped from it — the point is to show what a team unlocks.
  locked?: Tab[];
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const current = GAME_TYPES.find((t) => t.key === value) ?? GAME_TYPES[0];

  return (
    <div>
      <div className="relative inline-block" ref={ref}>
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 bg-surface border border-border rounded-full pl-4 pr-3 py-2 text-[13px] font-semibold text-text-primary hover:border-accent transition-colors">
          {current.label}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className={`text-text-secondary transition-transform ${open ? "rotate-180" : ""}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          // z-30: above the feed cards below it, still under the z-40 chrome and
          // the z-[60] sheet floor.
          <div className="absolute left-0 top-11 z-30 w-52 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden">
            {GAME_TYPES.map((t) => {
              const isLocked = locked.includes(t.key);
              return (
                <button key={t.key} type="button" disabled={isLocked}
                  onClick={() => { onChange(t.key); setOpen(false); }}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-semibold border-b border-border last:border-b-0 transition-colors ${
                    isLocked
                      ? "text-text-secondary opacity-60 cursor-not-allowed"
                      : value === t.key
                        ? "text-accent-ink bg-accent/[0.06]"
                        : "text-text-primary hover:bg-surface-2"
                  }`}>
                  {t.label}
                  {isLocked ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  ) : value === t.key ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {note && <p className="text-[11px] text-text-secondary mt-2">{note}</p>}
    </div>
  );
}

type Tournament = {
  id: string;
  title: string;
  // 'tournament' | 'league' | 'match' — this tab carries all multi-team events.
  matchType: string;
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
  // Set on admin-hosted (Unitr staff) events.
  organiserAdminName: string | null;
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

// `compact` is the match-feed shape — a pill sharing the card's bottom line with
// the price. Tournament cards still take the full-width form, since their action
// block stacks a second link underneath it.
function SuggestButton({ postId, kind, suggested, unavailable, onSuggest, compact = false }: {
  postId: string;
  kind: "match" | "tournament";
  suggested: boolean;
  unavailable: boolean;
  onSuggest: (id: string, kind: "match" | "tournament") => void;
  compact?: boolean;
}) {
  if (suggested) {
    return compact ? (
      <span className="px-4 py-2 rounded-full bg-success-bg border border-success-border text-accent-ink text-[13px] font-bold flex items-center gap-1.5 whitespace-nowrap flex-none">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Suggested
      </span>
    ) : (
      <span className="w-full py-2.5 rounded-btn bg-success-bg border border-success-border text-accent-ink text-sm font-bold flex items-center justify-center gap-1.5">
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
      className={compact
        ? "px-4 py-2 rounded-full bg-accent text-white text-[13px] font-bold whitespace-nowrap flex-none disabled:bg-surface-2 disabled:text-text-secondary disabled:opacity-70 disabled:cursor-not-allowed"
        : "w-full py-2.5 rounded-btn border border-accent text-accent-ink text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"}
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
      const baseCols = "id, title, match_type, pitch_name, match_date, start_time, format, skill_level, price_per_team_pence, max_teams, organiser_team_id, organiser_team_name";
      let { data: oms, error: omErr } = await supabase.from("open_matches")
        .select(`${baseCols}, organiser_admin_name`)
        .in("match_type", ["tournament", "league", "match"])
        .neq("status", "cancelled")
        .order("match_date", { ascending: true });
      // 42703: supabase_admin_hosting.sql not run yet — retry without the admin column.
      if (omErr?.code === "42703") {
        const { data: legacy } = await supabase.from("open_matches")
          .select(baseCols)
          .in("match_type", ["tournament", "league", "match"])
          .neq("status", "cancelled")
          .order("match_date", { ascending: true });
        oms = (legacy ?? []).map((m) => ({ ...m, organiser_admin_name: null }));
      }

      // Hide the viewer's own hosted events; the !teamId branch keeps venue- and
      // admin-hosted posts (organiser_team_id null) visible to teamless viewers.
      const active = (oms ?? []).filter(
        (m) => (!teamId || m.organiser_team_id !== teamId) && !isKickoffPast(m.match_date, m.start_time)
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
          matchType: m.match_type ?? "tournament",
          pitchName: m.pitch_name,
          matchDate: m.match_date,
          startTime: m.start_time,
          format: m.format,
          skillLevel: m.skill_level,
          pricePerTeamPence: m.price_per_team_pence,
          maxTeams: m.max_teams,
          joinedCount: joinedTeamIds.length,
          organiserTeamName: m.organiser_team_name ?? null,
          organiserAdminName: ("organiser_admin_name" in m ? m.organiser_admin_name : null) ?? null,
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
// The rebrand turns the feed row on its side: a pitch thumbnail on the left,
// and everything else in one column that ends with the price and the action on
// a single baseline. The badge slot carries whichever signal the post actually
// has — a secured pitch, or a date the squad already said it can make.
function MatchPostCard({ post, children }: { post: MatchPost; children: React.ReactNode }) {
  // Format and fee come off the pitch options; a post can carry several, so the
  // cheapest is quoted as a "from". This is the *pitch* fee, not a per-player
  // share — splitting it needs a confirmed squad, which an open post has not got.
  const cheapest = post.pitchOptions.length
    ? post.pitchOptions.reduce((a, b) => (b.price < a.price ? b : a))
    : null;
  const meta = [post.location || "Location TBC", cheapest?.format, post.date]
    .filter(Boolean).join(" · ");

  return (
    <div className="bg-surface border border-border rounded-card shadow-card p-3 flex gap-3">
      <div className="pitch-art pitch-art-sm w-[92px] h-28 rounded-btn flex-none" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-extrabold text-accent-ink">{post.match_time}</span>
          {post.pitchSecured ? (
            <span className="text-[10px] font-extrabold bg-surface-2 text-text-primary px-2 py-0.5 rounded-full">PITCH SECURED</span>
          ) : post.availabilityMatch ? (
            <span className="text-[10px] font-extrabold bg-accent-2 text-white px-2 py-0.5 rounded-full">MATCHES AVAILABILITY</span>
          ) : null}
        </div>
        <p className="text-base font-bold tracking-[-0.01em] uppercase truncate">{post.team}</p>
        <p className="text-xs font-medium text-text-secondary truncate">{meta}</p>
        <div className="flex items-center justify-between gap-2 mt-auto pt-1">
          {cheapest ? (
            <span className="text-[15px] font-extrabold whitespace-nowrap">
              {post.pitchOptions.length > 1 ? "from " : ""}£{cheapest.price.toFixed(2)}
              <span className="text-[11px] font-medium text-text-secondary"> pitch</span>
            </span>
          ) : <span />}
          {children}
        </div>
      </div>
    </div>
  );
}

// Captain's action on an opponent's post — opens the same challenge flow the
// Play page uses.
function ChallengeButton({ post, onMatched }: { post: MatchPost; onMatched: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Compact pill: it now shares the card's bottom line with the price
          rather than spanning the card on its own row. */}
      <button type="button" onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-full bg-accent text-white font-bold text-[13px] whitespace-nowrap flex-none">
        {post.pitchSecured ? "Join now" : "Challenge"}
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

const EVENT_TYPE_LABEL: Record<string, string> = { tournament: "Tournament", league: "League", match: "Friendly" };

function TournamentPostCard({ t, children }: { t: Tournament; children: React.ReactNode }) {
  const spotsLeft = Math.max(0, t.maxTeams - t.joinedCount);
  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-btn bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{t.title}</p>
          <p className="text-xs text-text-secondary truncate mt-0.5">{t.pitchName}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-surface text-text-secondary border-border">
            {EVENT_TYPE_LABEL[t.matchType] ?? "Tournament"}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            spotsLeft === 0
              ? "bg-surface text-text-secondary border-border"
              : "bg-accent/10 text-accent-ink border-accent/30"
          }`}>
            {spotsLeft === 0 ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
          </span>
        </div>
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
        <span className="text-lg font-bold text-accent-ink">£{(t.pricePerTeamPence / 100).toFixed(2)}</span>
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
        <div className="w-full py-2.5 rounded-btn bg-accent/10 border border-accent/30 text-center text-sm font-semibold text-accent-ink">Your team is entered ✓</div>
      ) : isFull ? (
        <div className="w-full py-2.5 rounded-xl bg-surface border border-border text-center text-sm font-semibold text-text-secondary">{EVENT_TYPE_LABEL[t.matchType] ?? "Tournament"} full</div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="w-full py-2.5 rounded-btn bg-accent text-white font-bold text-sm">
          {t.inviteDiscountPence > 0
            ? `Accept invitation — £${(discounted / 100).toFixed(2)}`
            : `Enter ${EVENT_TYPE_LABEL[t.matchType] ?? "Tournament"}`}
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
            organiserName: t.organiserTeamName ?? t.organiserAdminName ?? t.pitchName,
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

// ── Section furniture ─────────────────────────────────────────
// Only shown in All, where the sections need telling apart. Narrowed to one
// type, the dropdown above already names what you're looking at.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-extrabold tracking-[0.08em] text-text-secondary uppercase pt-1">
      {children}
    </p>
  );
}

function FeedSpinner() {
  return <div className="flex justify-center py-8"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
}

function FeedEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
      <p className="text-sm text-text-secondary">{title}</p>
      <p className="text-xs text-text-secondary mt-1">{hint}</p>
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
  const [tab, setTab] = useState<Tab>("all");
  // Shared across every category so narrowing the type keeps the day you're
  // looking at. Fill In's dates come from a separate query inside RingerFeed,
  // which reports them up here so one dial can count all three.
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [ringerCounts, setRingerCounts] = useState<Map<string, number>>(new Map());
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

  const showAll = tab === "all";
  const showMatches = showAll || tab === "matches";
  const showTournaments = showAll || tab === "tournaments";
  const showRinger = showAll || tab === "ringer";

  const visiblePosts = dateKey ? posts.filter((p) => toDateKey(p.match_date) === dateKey) : posts;
  const visibleTournaments = dateKey ? tournaments.filter((t) => toDateKey(t.matchDate) === dateKey) : tournaments;

  // One dial for the whole feed, so the date survives a change of type. In All
  // it counts every source at once; narrowed, it counts only what's on screen,
  // otherwise a day would show a badge for games the filter has hidden.
  const dialCounts = (() => {
    const merged = new Map<string, number>();
    const add = (m: Map<string, number>) => m.forEach((n, k) => merged.set(k, (merged.get(k) ?? 0) + n));
    if (showMatches) add(countByDate(posts, (p) => p.match_date));
    if (showTournaments) add(countByDate(tournaments, (t) => t.matchDate));
    if (showRinger) add(ringerCounts);
    return merged;
  })();

  // Empty sections are dropped in All rather than stacking three "nothing here"
  // cards; narrowed to one type, the empty state is the whole answer and stays.
  const matchesEmpty = visiblePosts.length === 0;
  const tournamentsEmpty = visibleTournaments.length === 0;
  const nothingAtAll = showAll && matchesEmpty && tournamentsEmpty;

  return (
    <section className="space-y-4">
      <GameTypeSelect value={tab} onChange={setTab} />

      <DateDial value={dateKey} onChange={setDateKey} counts={dialCounts} />

      {/* The captain's own live post stays pinned to the top of the feed
          whenever matches are in view, above the type sections. */}
      {showMatches && !postsLoading && matchesHeader}

      {showMatches && (
        postsLoading ? (
          <FeedSpinner />
        ) : matchesEmpty ? (
          showAll ? null : (
            <FeedEmpty
              title={posts.length > 0 ? "No matches posted for this day." : "No open matches right now."}
              hint={posts.length > 0
                ? "Try another date, or pick All to see everything."
                : "Posts from other teams looking for an opponent show up here."}
            />
          )
        ) : (
          <div className="space-y-4">
            {showAll && <SectionLabel>Matches</SectionLabel>}
            {visiblePosts.map((p) => (
              <MatchPostCard key={p.id} post={p}>
                {canAct
                  ? <ChallengeButton post={p} onMatched={removePost} />
                  : <SuggestButton postId={p.id} kind="match" suggested={suggested.has(p.id)} unavailable={unavailable} onSuggest={suggest} compact />}
              </MatchPostCard>
            ))}
          </div>
        )
      )}

      {showTournaments && (
        tLoading ? (
          <FeedSpinner />
        ) : tournamentsEmpty ? (
          showAll ? null : (
            <FeedEmpty
              title={tournaments.length > 0 ? "No events on this day." : "No events right now."}
              hint={tournaments.length > 0
                ? "Try another date, or pick All to see everything."
                : "Tournaments, leagues and hosted friendlies show up here."}
            />
          )
        ) : (
          <div className="space-y-4">
            {showAll && <SectionLabel>Tournaments</SectionLabel>}
            {visibleTournaments.map((t) => (
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
            ))}
          </div>
        )
      )}

      {/* In All the two team sections vanish when empty, so say once that they
          were empty rather than leaving Fill In looking like the whole feed. */}
      {nothingAtAll && !postsLoading && !tLoading && (
        <p className="text-xs text-text-secondary">
          {dateKey ? "No matches or tournaments on this day." : "No open matches or tournaments right now."}
        </p>
      )}

      {showRinger && (
        <div className="space-y-4">
          {showAll && <SectionLabel>Fill In</SectionLabel>}
          {/* The dial above owns the date for every section here, so this feed
              takes it as a prop and shows no dial of its own. Passing dateKey is
              what suppresses it — the teamless home mounts RingerFeed without it
              and keeps the built-in dial. */}
          <RingerFeed dateKey={dateKey} onDateCounts={setRingerCounts} showIntro={false} />
        </div>
      )}
    </section>
  );
}
