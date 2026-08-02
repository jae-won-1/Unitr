"use client";

import { useState, useEffect } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import BookPitchPanel from "@/components/BookPitchPanel";
import MyBookingsPanel from "@/components/MyBookingsPanel";
import RingerFeed from "@/components/RingerFeed";
import ChallengePanel, { type MatchPost, type PitchOption } from "@/components/ChallengePanel";
import MyPostCard, { useMyPosts } from "@/components/MyPostCard";

type MatchTab = "matches" | "tournaments" | "ringer";


const ISO_MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
function isExpired(matchDate: string, matchTime: string): boolean {
  // Compare kickoff and "now" both as Europe/London wall-clock strings so the
  // result never depends on the viewer's device timezone. The stored kickoff is
  // a naive "YYYY-MM-DD" + "HH:mm" with no zone; parsing it via `new Date(...)`
  // would interpret it in the device's local tz — an iPad set to Korea time
  // reads it ~8–9h earlier than a UK laptop and wrongly hides not-yet-started
  // matches as "expired". "sv-SE" yields an ISO-like "YYYY-MM-DD HH:mm:ss" that
  // sorts lexicographically against the kickoff string.
  const kickoff = `${toISODate(matchDate)} ${matchTime.padStart(5, "0")}:00`;
  const nowLondon = new Date().toLocaleString("sv-SE", { timeZone: "Europe/London" });
  return kickoff < nowLondon;
}
function toISODate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const key = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    if (ISO_MONTHS[key] !== undefined) {
      const d = new Date(Number(m[3]), ISO_MONTHS[key], Number(m[1]));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return raw;
}
// Friendly "Sat, 13 Jun · 16:00" from an ISO (or legacy display) match_date.
function fmtPostDate(matchDate: string, matchTime: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) {
    const d = new Date(matchDate + "T12:00:00");
    return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${matchTime}`;
  }
  return `${matchDate} · ${matchTime}`;
}


type Tournament = {
  id: string;
  title: string;
  pitch_id: string;
  pitch_name: string;
  venue_address: string | null;
  match_date: string;
  start_time: string;
  end_time: string;
  format: string | null;
  skill_level: string;
  price_per_team_pence: number;
  max_teams: number;
  description: string | null;
  status: string;
  booking_id: string | null;
  // Set when a team (not a venue) hosts the tournament — buy-ins reimburse them.
  organiser_team_id: string | null;
  organiser_team_name: string | null;
  joinedCount: number;
  joinedTeamIds: string[];
  // Pending-invitation discount off the buy-in for the viewing captain's team (0 if none).
  inviteDiscountPence: number;
};

function Stars({ rating }: { rating: number }) {
  if (rating === 0) return <div className="flex items-center gap-1"><span className="text-xs text-text-secondary">No rating yet</span></div>;
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-bold text-yellow-400">{rating}</span>
      {[1,2,3,4,5].map((i) => (
        <svg key={i} width="11" height="11" viewBox="0 0 24 24" fill={i <= Math.round(rating) ? "#FACC15" : "none"} stroke="#FACC15" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

// ── Match Card (opponents' posts) ─────────────────────────────
function MatchCard({
  post,
  showChallenge,
  onMatched,
}: {
  post: MatchPost;
  showChallenge: boolean;
  onMatched?: (postId: string) => void;
}) {
  const [showPanel, setShowPanel] = useState(false);
  const initials = post.team.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-accent">{initials}</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold">{post.team}</p>
                <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
              </div>
              <p className="text-xs text-text-secondary mt-0.5">{post.location || "Location TBC"}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {post.pitchSecured && (
              <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                Pitch Secured
              </span>
            )}
            {post.availabilityMatch && (
              <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">
                Matches availability
              </span>
            )}
          </div>
        </div>

        <Stars rating={0} />
        {post.description && <p className="text-xs text-text-secondary my-2">{post.description}</p>}

        <div className="flex items-center gap-1 text-xs text-text-secondary mb-3 mt-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          {post.date}
        </div>

        {post.pitchOptions.length > 0 && (
          <div className="bg-background rounded-xl px-3 py-2 mb-3">
            <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Pitch Options</p>
            <div className="space-y-1">
              {post.pitchOptions.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="w-4 h-4 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[9px] font-bold flex-shrink-0">{i + 1}</span>
                  <span className="truncate">{p.name}</span>
                  <span className="text-accent font-medium flex-shrink-0">£{((p.price / 2) * 1.05).toFixed(2)}</span>
                  {i > 0 && <span className="text-[9px] text-text-secondary flex-shrink-0">backup</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {showChallenge && (
          <button onClick={() => setShowPanel(true)}
            className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
            {post.pitchSecured ? "Join — Pitch Secured" : "Challenge Team"}
          </button>
        )}
      </div>

      {showPanel && (
        <ChallengePanel
          post={post}
          onClose={() => setShowPanel(false)}
          onMatched={(id) => { setShowPanel(false); onMatched?.(id); }}
        />
      )}
    </>
  );
}

// ── Tournament list — hosted-by-you first, under its own heading ──
function TournamentList({ tournaments, myTeamId, myTeamName, onJoined }: {
  tournaments: Tournament[]; myTeamId: string | null; myTeamName: string | null; onJoined: (id: string) => void;
}) {
  const mine = myTeamId ? tournaments.filter((t) => t.organiser_team_id === myTeamId) : [];
  const others = myTeamId ? tournaments.filter((t) => t.organiser_team_id !== myTeamId) : tournaments;

  return (
    <div className="space-y-4">
      {mine.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Hosted by you</p>
          {mine.map((t) => (
            <TournamentCard key={t.id} tournament={t} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={onJoined} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="space-y-3">
          {mine.length > 0 && <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Other tournaments</p>}
          {others.map((t) => (
            <TournamentCard key={t.id} tournament={t} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={onJoined} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tournament Card ────────────────────────────────────────────
function TournamentCard({
  tournament: t,
  myTeamId,
  myTeamName,
  onJoined,
}: {
  tournament: Tournament;
  myTeamId: string | null;
  myTeamName: string | null;
  onJoined: (id: string) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const spotsLeft = Math.max(0, t.max_teams - t.joinedCount);
  const isFull = t.status === "full" || spotsLeft === 0;
  const alreadyIn = myTeamId ? t.joinedTeamIds.includes(myTeamId) : false;
  const isOrganiser = myTeamId != null && t.organiser_team_id === myTeamId;
  const hostName = t.organiser_team_name ?? t.pitch_name;
  const isInvited = !alreadyIn && !isOrganiser && t.inviteDiscountPence > 0;
  const effectivePence = Math.max(0, t.price_per_team_pence - t.inviteDiscountPence);
  const buyIn = (t.price_per_team_pence / 100).toFixed(2);

  return (
    <div className={`bg-surface-2 border rounded-2xl overflow-hidden ${isOrganiser ? "border-accent/50" : "border-border"}`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between mb-2 gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold truncate">{t.title}</p>
              {isOrganiser && (
                <span className="flex-shrink-0 text-[10px] font-bold text-accent bg-accent/10 border border-accent/30 px-1.5 py-0.5 rounded-full">Hosted by you</span>
              )}
            </div>
            <p className="text-xs text-text-secondary">
              by {hostName}
              <span className="ml-1.5 text-[10px] font-semibold text-text-secondary/70">{t.organiser_team_name ? "· Team-hosted" : "· Venue"}</span>
            </p>
          </div>
          {isInvited ? (
            <span className="text-right flex-shrink-0">
              <span className="text-[10px] text-text-secondary line-through block">£{buyIn}</span>
              <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/30 px-2 py-0.5 rounded-lg">£{(effectivePence / 100).toFixed(2)}/team</span>
            </span>
          ) : (
            <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/30 px-2 py-1 rounded-lg flex-shrink-0">£{buyIn}/team</span>
          )}
        </div>
        {isInvited && (
          <div className="inline-flex items-center gap-1.5 bg-accent/10 border border-accent/30 rounded-full px-2.5 py-1 mb-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            <span className="text-[10px] font-bold text-accent">Invited · £{(t.inviteDiscountPence / 100).toFixed(2)} off</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-text-secondary mb-3 flex-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span>{fmtPostDate(t.match_date, t.start_time)}</span>
          {t.format && <><span className="w-1 h-1 rounded-full bg-border" /><span>{t.format}</span></>}
          <span className="w-1 h-1 rounded-full bg-border" /><span className="capitalize">{t.skill_level}</span>
        </div>
        {t.description && <p className="text-xs text-text-secondary">{t.description}</p>}
      </div>

      {/* Footer: venue + teams entered */}
      <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <p className="text-sm font-semibold truncate">{t.pitch_name}</p>
          </div>
          {t.venue_address && <p className="text-xs text-text-secondary truncate mt-0.5">{t.venue_address}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-bold text-accent">{t.joinedCount}/{t.max_teams}</p>
          <p className="text-[10px] text-text-secondary">teams entered</p>
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 pb-4 space-y-2">
        {isOrganiser ? (
          <div className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-center text-sm font-semibold text-accent">You&apos;re hosting this tournament</div>
        ) : alreadyIn ? (
          <div className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-center text-sm font-semibold text-accent">Your team is entered ✓</div>
        ) : isFull ? (
          <div className="w-full py-2.5 rounded-xl bg-surface border border-border text-center text-sm font-semibold text-text-secondary">Tournament full</div>
        ) : (
          <button onClick={() => setPanelOpen(true)}
            className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
            {isInvited ? `Accept invitation — £${(effectivePence / 100).toFixed(2)}` : `Enter Tournament${spotsLeft > 0 ? ` — ${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left` : ""}`}
          </button>
        )}
        <a href={`/play/tournament/${t.id}`}
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-surface border border-border text-sm font-semibold text-text-primary">
          {isOrganiser ? "Manage schedule & referees" : "View schedule & referees"}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </a>
      </div>

      {panelOpen && (
        <EnterTournamentPanel
          tournament={t}
          myTeamId={myTeamId}
          myTeamName={myTeamName}
          onClose={() => setPanelOpen(false)}
          onJoined={() => { setPanelOpen(false); onJoined(t.id); }}
        />
      )}
    </div>
  );
}

// ── Enter Tournament Panel ─────────────────────────────────────
function EnterTournamentPanel({
  tournament: t,
  myTeamId,
  myTeamName,
  onClose,
  onJoined,
}: {
  tournament: Tournament;
  myTeamId: string | null;
  myTeamName: string | null;
  onClose: () => void;
  onJoined: () => void;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferFailed, setTransferFailed] = useState(false);
  // Effective buy-in after any pending-invitation discount (the join route
  // re-applies the discount authoritatively; this keeps the UI in sync).
  const buyIn = Math.max(0, t.price_per_team_pence - t.inviteDiscountPence);

  const handleJoin = async () => {
    if (!user || !myTeamId) { setError("You need to be a team captain to enter a tournament."); return; }
    setSaving(true);
    setError(null);

    const res = await fetch("/api/tournaments/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openMatchId: t.id, teamId: myTeamId, teamName: myTeamName, userId: user.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      setError(
        data.error === "INSUFFICIENT_CREDIT"
          ? `Your team needs £${(buyIn / 100).toFixed(2)} in available credit to enter. Top up team credit and try again.`
          : (data.error ?? "Couldn't enter the tournament. Please try again.")
      );
      return;
    }

    // The venue payout (venue-hosted tournaments only) now happens server-side
    // in the join route itself, so it can't be skipped by navigating away.
    // Surface a non-blocking warning if it failed — the team is still entered
    // and their credit was already debited; only the venue's payout is outstanding.
    setTransferFailed(data.transferStatus === "failed");

    setSaving(false);
    setConfirmed(true);
  };

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onJoined}>
        <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">You&apos;re in!</p>
          <p className="text-sm text-text-secondary mb-5">
            {myTeamName} has entered <span className="font-semibold text-text-primary">{t.title}</span>. £{(buyIn / 100).toFixed(2)} was taken from your team credit and paid to {t.organiser_team_name ?? t.pitch_name}. Your squad can settle their share afterwards from Team Credits.
          </p>
          {transferFailed && (
            <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3 py-2 mb-5 text-left">
              Your entry is confirmed and your credit was charged, but the payout to the venue didn&apos;t go through (likely a test-mode balance issue). It&apos;ll show as failed in the venue&apos;s reports.
            </p>
          )}
          <button onClick={onJoined} className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold">Enter Tournament</p>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="bg-surface-2 border border-border rounded-xl p-4 mb-4">
          <p className="text-sm font-bold">{t.title}</p>
          <p className="text-xs text-text-secondary mt-0.5">{t.pitch_name} · {fmtPostDate(t.match_date, t.start_time)}</p>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <span className="text-xs text-text-secondary">Buy-in (per team)</span>
            <span className="text-sm font-bold">
              {t.inviteDiscountPence > 0 && <span className="text-[11px] text-text-secondary line-through mr-1.5">£{(t.price_per_team_pence / 100).toFixed(2)}</span>}
              £{(buyIn / 100).toFixed(2)}
            </span>
          </div>
          {t.inviteDiscountPence > 0 && (
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-accent">Invitation discount</span>
              <span className="text-xs font-semibold text-accent">−£{(t.inviteDiscountPence / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-text-secondary">Teams entered</span>
            <span className="text-sm font-semibold">{t.joinedCount}/{t.max_teams}</span>
          </div>
        </div>

        <p className="text-xs text-text-secondary mb-4">
          The buy-in comes out of your team credit now and is paid to the venue. Your players
          each refill their share from the tournament page afterwards.
        </p>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <button onClick={handleJoin} disabled={saving || !myTeamId}
          className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
          {saving ? "Entering…" : `Pay £${(buyIn / 100).toFixed(2)} & Enter`}
        </button>
        {!myTeamId && <p className="text-[11px] text-text-secondary text-center mt-2">Only team captains can enter a tournament.</p>}
      </div>
    </div>
  );
}

// ── Open tournaments hook (venue-hosted, from open_matches) ─────
function useOpenTournaments(userId?: string) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myTeamName, setMyTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      let teamId: string | null = null;
      if (userId) {
        const { data: team } = await supabase
          .from("teams").select("id, name").eq("captain_id", userId).maybeSingle();
        teamId = team?.id ?? null;
        setMyTeamId(teamId);
        setMyTeamName(team?.name ?? null);
      }

      const { data: oms } = await supabase
        .from("open_matches")
        .select("id, title, pitch_id, pitch_name, venue_address, match_date, start_time, end_time, format, skill_level, price_per_team_pence, max_teams, description, status, booking_id, organiser_team_id, organiser_team_name")
        .eq("match_type", "tournament")
        .neq("status", "cancelled")
        .order("match_date", { ascending: true });

      // Pending invitations for the viewer's team → discount per tournament.
      const discountByTournament = new Map<string, number>();
      if (teamId) {
        const { data: invites } = await supabase
          .from("tournament_invitations")
          .select("open_match_id, discount_pence, status")
          .eq("team_id", teamId).eq("status", "pending");
        for (const inv of invites ?? []) discountByTournament.set(inv.open_match_id as string, inv.discount_pence ?? 0);
      }

      const withTeams = await Promise.all((oms ?? []).map(async (m) => {
        const { data: teams } = await supabase
          .from("open_match_teams").select("team_id").eq("open_match_id", m.id);
        const joinedTeamIds = (teams ?? []).map((x) => x.team_id as string);
        return { ...m, joinedCount: joinedTeamIds.length, joinedTeamIds, inviteDiscountPence: discountByTournament.get(m.id) ?? 0 } as Tournament;
      }));

      // Hide tournaments whose date has already passed.
      const active = withTeams.filter((t) => !isExpired(t.match_date, t.start_time));
      setTournaments(active);
      setLoading(false);
    }
    load();
  }, [userId]);

  // Optimistically bump the joined count for the team that just entered.
  const markJoined = (id: string) => setTournaments((prev) => prev.map((t) =>
    t.id === id && myTeamId && !t.joinedTeamIds.includes(myTeamId)
      ? { ...t, joinedCount: t.joinedCount + 1, joinedTeamIds: [...t.joinedTeamIds, myTeamId] }
      : t
  ));

  return { tournaments, myTeamId, myTeamName, loading, markJoined };
}

// ── Hooks ─────────────────────────────────────────────────────
function usePosts(excludeCaptainId: string | null, userId?: string) {
  const [posts, setPosts] = useState<MatchPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (excludeCaptainId === undefined) return;

    async function load() {
      // Fetch this user's team availability dates
      let availabilityDates: string[] = [];
      if (userId) {
        let teamId: string | undefined;

        const { data: captainTeam } = await supabase
          .from("teams").select("id").eq("captain_id", userId).maybeSingle();
        teamId = captainTeam?.id;

        if (!teamId) {
          const { data: membership } = await supabase
            .from("team_members").select("team_id")
            .eq("player_id", userId).eq("status", "approved").maybeSingle();
          teamId = membership?.team_id;
        }

        if (teamId) {
          const { data: req } = await supabase
            .from("availability_requests").select("date_options")
            .eq("team_id", teamId)
            .order("created_at", { ascending: false })
            .limit(1).maybeSingle();

          if (req?.date_options) {
            availabilityDates = (req.date_options as { date: string }[]).map((d) => toISODate(d.date));
          }
        }
      }

      let query = supabase
        .from("match_posts")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (excludeCaptainId) {
        query = query.neq("captain_id", excludeCaptainId);
      }

      const { data } = await query;
      const mapped = (data ?? []).map((row) => ({
        id: row.id,
        team_id: row.team_id,
        captain_id: row.captain_id,
        team: row.team_name,
        location: row.team_location ?? "",
        date: fmtPostDate(row.match_date, row.match_time),
        match_date: row.match_date,
        match_time: row.match_time,
        pitchOptions: (row.pitch_options ?? []) as PitchOption[],
        description: row.description ?? "",
        availabilityMatch: availabilityDates.includes(toISODate(row.match_date)),
        status: row.status,
        payment_mode: row.payment_mode ?? "credit",
        pitchSecured: Boolean(row.pitch_secured),
        securedBookingId: row.secured_booking_id ?? null,
      }));

      const active = mapped.filter((p) => !isExpired(p.match_date, p.match_time));

      // Secured-pitch posts float to the top (pitch already locked in, joinable
      // right away), then availability-matching posts.
      active.sort((a, b) =>
        (b.pitchSecured ? 1 : 0) - (a.pitchSecured ? 1 : 0) ||
        (b.availabilityMatch ? 1 : 0) - (a.availabilityMatch ? 1 : 0)
      );

      setPosts(active);
      setLoading(false);
    }

    load();
  }, [excludeCaptainId, userId]);

  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  return { posts, loading, removePost };
}


// ── POV Views ─────────────────────────────────────────────────
function NewUserPlay() {
  return <RingerFeed />;
}

function PlayerPlay() {
  const { user } = useAuth();
  const { posts, loading, removePost } = usePosts(null, user?.id);
  const { tournaments, myTeamId, myTeamName, loading: tLoading, markJoined } = useOpenTournaments(user?.id);
  const [tab, setTab] = useState<MatchTab>("matches");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "matches" || t === "tournaments" || t === "ringer") setTab(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {([{ key: "matches", label: "Matches" }, { key: "tournaments", label: "Tournaments" }, { key: "ringer", label: "Fill in" }] as { key: MatchTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "matches" && (
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading matches…</p>
          ) : posts.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">No open matches right now.</p>
          ) : (
            posts.map((p) => <MatchCard key={p.id} post={p} showChallenge={false} onMatched={removePost} />)
          )}
        </div>
      )}

      {tab === "tournaments" && (
        tLoading ? (
          <p className="text-sm text-text-secondary text-center py-8">Loading tournaments…</p>
        ) : tournaments.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-8">No tournaments right now.</p>
        ) : (
          <TournamentList tournaments={tournaments} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={markJoined} />
        )
      )}

      {tab === "ringer" && <RingerFeed />}
    </div>
  );
}

function CaptainPlay() {
  const { user } = useAuth();
  const { posts, loading, removePost } = usePosts(user?.id ?? null, user?.id);
  const { posts: myPosts, loading: myPostsLoading, removePost: removeMyPost } = useMyPosts(user?.id);
  const { tournaments, myTeamId, myTeamName, loading: tLoading, markJoined } = useOpenTournaments(user?.id);
  const [tab, setTab] = useState<MatchTab>("matches");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "matches" || t === "tournaments" || t === "ringer") setTab(t);
  }, []);

  const myPost = myPosts[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {([
          { key: "matches", label: "Matches" },
          { key: "tournaments", label: "Tournaments" },
          { key: "ringer", label: "Fill in" },
        ] as { key: MatchTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors relative ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "matches" && (
        <div className="space-y-4">
          {myPostsLoading ? null : myPost ? (
            <MyPostCard post={myPost} onRemoved={removeMyPost} />
          ) : (
            <a href="/play/create" onClick={() => localStorage.setItem("unitr_payment_mode", "individual")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-bold">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Create New Post
            </a>
          )}

          {loading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading matches…</p>
          ) : posts.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">No open matches from other teams right now.</p>
          ) : (
            posts.map((p) => (
              <MatchCard key={p.id} post={p} showChallenge={true} onMatched={removePost} />
            ))
          )}
        </div>
      )}

      {tab === "tournaments" && (
        <div className="space-y-4">
          <a href="/play/create-tournament"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-accent text-black text-sm font-bold">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Host a Tournament
          </a>
          {tLoading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading tournaments…</p>
          ) : tournaments.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">No tournaments right now.</p>
          ) : (
            <TournamentList tournaments={tournaments} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={markJoined} />
          )}
        </div>
      )}

      {/* Captains post ringer requests from Manage Match (the fixture there knows
          the date, pitch and squad), so this tab is browse-only for them too. */}
      {tab === "ringer" && <RingerFeed />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
type PlayView = "find" | "book" | "mybookings";

export default function PlayPage() {
  const { role, roleLoading } = useRole();
  const [view, setView] = useState<PlayView>("find");
  // Posting slot carried over from "lock in a pitch first" so the Book tab
  // opens pre-filtered to the captain's chosen match date/time — and, when the
  // captain's intent was to post, auto-posts the booking as a secured match.
  const [bookDate, setBookDate] = useState<string | undefined>();
  const [bookTime, setBookTime] = useState<string | undefined>();
  const [bookAutoPost, setBookAutoPost] = useState(false);

  // Allow deep-linking to a tab, e.g. /play?view=book from the Create Match page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    if (v === "book" || v === "mybookings") setView(v);
    const d = params.get("date");
    const t = params.get("time");
    if (d) setBookDate(d);
    if (t) setBookTime(t);
    if (params.get("intent") === "post") setBookAutoPost(true);
  }, []);

  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-bold mb-1">Play</h1>
        <p className="text-text-secondary text-sm">
          {view === "book" ? "Book a pitch directly — no opponent needed"
          : view === "mybookings" ? "Manage pitches you've booked directly"
          : role === "new_user" ? "Find a game to join in your area"
          : role === "player" ? "Find teams to challenge or events to join"
          : "Manage matches and find opponents for your team"}
        </p>
      </header>

      <div className="flex bg-surface-2 border border-border rounded-xl p-1 mb-5">
        {([{ key: "find", label: "Find Match" }, { key: "book", label: "Book" }, { key: "mybookings", label: "My Bookings" }] as { key: PlayView; label: string }[]).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${view === v.key ? "bg-accent text-black" : "text-text-secondary"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "find" ? (
        <>
          {role === "new_user" && <NewUserPlay />}
          {role === "player" && <PlayerPlay />}
          {role === "captain" && <CaptainPlay />}
        </>
      ) : view === "book" ? (
        <div className="-mx-4">
          <BookPitchPanel initialDate={bookDate} initialTime={bookTime} autoPost={bookAutoPost} />
        </div>
      ) : (
        <MyBookingsPanel />
      )}
    </div>
  );
}
