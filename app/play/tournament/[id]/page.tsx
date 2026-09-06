"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import TournamentInvitePanel from "@/components/TournamentInvitePanel";
import EnterTournamentPanel from "@/components/EnterTournamentPanel";
import { isKickoffPast } from "@/lib/match-dates";
import { computeStandings } from "@/lib/standings";
import { loadEventRevenue, fmtPence, type EventRevenue } from "@/lib/event-revenue";
import { loadLedTeam, loadLeadership } from "@/lib/team-leadership";
import { useRole } from "@/contexts/RoleContext";
import { takeDownEvent } from "@/lib/take-down-event";

// Event detail + management — tournaments, leagues and admin-hosted friendlies
// (all open_matches rows). The organiser (the hosting team's captain, the venue
// owner, or the Unitr admin who posted it) can generate a schedule of fixtures
// between the joined teams — manually or randomly — save results, and rate
// players. Every fixture is assigned a referee: a randomly chosen player from a
// team NOT in that fixture, who is notified. Everyone can view the schedule,
// results, referees and standings.

type Tournament = {
  id: string;
  title: string;
  match_type: string; // 'tournament' | 'league' | 'match'
  pitch_name: string;
  match_date: string;
  start_time: string;
  end_time: string;
  format: string | null;
  skill_level: string;
  max_teams: number;
  price_per_team_pence: number;
  status: string;
  organiser_team_id: string | null;
  organiser_team_name: string | null;
  venue_owner_id: string | null;
  organiser_admin_id: string | null;
  organiser_admin_name: string | null;
};

type JoinedTeam = { team_id: string; team_name: string };
type RosterPlayer = { player_id: string; name: string; team_id: string; team_name: string };
type Fixture = {
  id: string;
  slot_index: number;
  scheduled_time: string | null;
  home_team_id: string | null;
  home_team_name: string | null;
  away_team_id: string | null;
  away_team_name: string | null;
  referee_player_id: string | null;
  referee_name: string | null;
  referee_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
};

const timeToMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const minToTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { role } = useRole();

  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [teams, setTeams] = useState<JoinedTeam[]>([]);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myPlayingTeamId, setMyPlayingTeamId] = useState<string | null>(null);
  const [myTeamName, setMyTeamName] = useState<string | null>(null);
  const [inviteDiscountPence, setInviteDiscountPence] = useState(0);
  const [showEnter, setShowEnter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [revenue, setRevenue] = useState<EventRevenue | null>(null);
  const [takenDownReason, setTakenDownReason] = useState<string | null>(null);

  // Take-down — Unitr staff, Unitr's own events only (see the section below).
  const [confirmingTakeDown, setConfirmingTakeDown] = useState(false);
  const [takeDownReason, setTakeDownReason] = useState("");
  const [takeDownBusy, setTakeDownBusy] = useState(false);
  const [takeDownError, setTakeDownError] = useState<string | null>(null);
  const [takeDownNote, setTakeDownNote] = useState<string | null>(null);

  // Manual-fixture form
  const [mHome, setMHome] = useState("");
  const [mAway, setMAway] = useState("");
  const [mTime, setMTime] = useState("");

  // Result entry (organiser): per-fixture score drafts.
  const [scoreDraft, setScoreDraft] = useState<Record<string, { h: string; a: string }>>({});

  // Player ratings (organiser): drafts + already-saved ratings for this event.
  const [ratingDraft, setRatingDraft] = useState<Record<string, { rating: string; note: string }>>({});
  const [savedRatings, setSavedRatings] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const baseCols = "id, title, match_type, pitch_name, match_date, start_time, end_time, format, skill_level, max_teams, price_per_team_pence, status, organiser_team_id, organiser_team_name, venue_owner_id";
    let { data: om, error: omErr } = await supabase.from("open_matches")
      .select(`${baseCols}, organiser_admin_id, organiser_admin_name`)
      .eq("id", params.id).maybeSingle();
    // 42703: supabase_admin_hosting.sql not run yet — fall back to the old shape.
    if (omErr?.code === "42703") {
      const { data: legacy } = await supabase.from("open_matches").select(baseCols).eq("id", params.id).maybeSingle();
      om = legacy ? { ...legacy, organiser_admin_id: null, organiser_admin_name: null } : null;
    }
    if (!om) { setT(null); return; }
    setT(om as Tournament);

    // Why it was taken down, for the banner. Its own query rather than another
    // column on the one above: supabase_event_takedown.sql is a separate
    // migration, and a 42703 there would take organiser_admin_id down with it
    // and leave the admin who hosts this unable to see that they do.
    if ((om as Tournament).status === "cancelled") {
      const { data: down } = await supabase.from("open_matches")
        .select("taken_down_reason").eq("id", params.id).maybeSingle();
      setTakenDownReason((down?.taken_down_reason as string | null) ?? null);
    } else {
      setTakenDownReason(null);
    }

    const { data: jt } = await supabase.from("open_match_teams")
      .select("team_id, team_name").eq("open_match_id", params.id);
    const joined = (jt ?? []) as JoinedTeam[];
    setTeams(joined);

    // Build the referee pool: approved members + captain of every joined team.
    const teamIds = joined.map((x) => x.team_id);
    const nameByTeam = new Map(joined.map((x) => [x.team_id, x.team_name]));
    const pool: RosterPlayer[] = [];
    if (teamIds.length) {
      const [{ data: members }, { data: teamRows }] = await Promise.all([
        supabase.from("team_members").select("player_id, team_id, profiles(full_name)").in("team_id", teamIds).eq("status", "approved"),
        supabase.from("teams").select("id, captain_id").in("id", teamIds),
      ]);
      const capIds = (teamRows ?? []).map((r) => r.captain_id).filter(Boolean);
      const { data: capProfiles } = capIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", capIds)
        : { data: [] as { id: string; full_name: string }[] };
      const capName = new Map((capProfiles ?? []).map((p) => [p.id, p.full_name as string]));
      for (const m of members ?? []) {
        pool.push({
          player_id: m.player_id as string,
          name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player",
          team_id: m.team_id as string,
          team_name: nameByTeam.get(m.team_id as string) ?? "",
        });
      }
      for (const r of teamRows ?? []) {
        if (r.captain_id && !pool.some((p) => p.player_id === r.captain_id)) {
          pool.push({ player_id: r.captain_id, name: capName.get(r.captain_id) ?? "Captain", team_id: r.id, team_name: nameByTeam.get(r.id) ?? "" });
        }
      }
    }
    setRoster(pool);

    const { data: fx } = await supabase.from("tournament_matches")
      .select("id, slot_index, scheduled_time, home_team_id, home_team_name, away_team_id, away_team_name, referee_player_id, referee_name, referee_team_name, home_score, away_score, status")
      .eq("open_match_id", params.id).order("slot_index", { ascending: true });
    setFixtures((fx ?? []) as Fixture[]);

    // Saved event ratings — table may not exist yet (migration not run): the
    // query just errors and data stays null, so this degrades silently.
    const { data: rt } = await supabase.from("admin_player_ratings")
      .select("player_id, rating").eq("open_match_id", params.id);
    setSavedRatings(Object.fromEntries((rt ?? []).map((r) => [r.player_id as string, r.rating as number])));
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    loadLedTeam<{ id: string; name: string }>(user.id, "id, name")
      .then((data) => { setMyTeamId(data?.id ?? null); setMyTeamName(data?.name ?? null); });
  }, [user]);

  // The squad the viewer plays for, whatever their rank. Distinct from
  // myTeamId, which is deliberately leader-only because it gates buying in.
  // This one only decides which fixtures in the schedule are "ours" — a player
  // needs to walk into their own game and read the lineup as much as a captain
  // does.
  useEffect(() => {
    if (!user) { setMyPlayingTeamId(null); return; }
    loadLeadership(user.id).then((led) => setMyPlayingTeamId(led?.teamId ?? null));
  }, [user]);

  // Pending invitation for this team → discount off the buy-in.
  useEffect(() => {
    if (!myTeamId) { setInviteDiscountPence(0); return; }
    supabase.from("tournament_invitations")
      .select("discount_pence").eq("open_match_id", params.id).eq("team_id", myTeamId).eq("status", "pending").maybeSingle()
      .then(({ data }) => setInviteDiscountPence(data?.discount_pence ?? 0));
  }, [myTeamId, params.id]);

  // Takings, for the admin who hosts this event (see the block below for why
  // it is admin-hosted only). Reloads whenever the entry list changes.
  const isAdminHost = Boolean(t && user && t.organiser_admin_id && t.organiser_admin_id === user.id);
  useEffect(() => {
    if (!t || !isAdminHost) { setRevenue(null); return; }
    loadEventRevenue([{ id: t.id, price_per_team_pence: t.price_per_team_pence, max_teams: t.max_teams }])
      .then((m) => setRevenue(m.get(t.id) ?? null));
  }, [t, isAdminHost, teams.length]);

  const canManage = Boolean(t && user && (
    (t.organiser_team_id && t.organiser_team_id === myTeamId) ||
    (t.venue_owner_id && t.venue_owner_id === user.id) ||
    (t.organiser_admin_id && t.organiser_admin_id === user.id)
  ));

  // Cosmetic noun for copy — the page manages all three event shapes.
  const noun = t?.match_type === "league" ? "League" : t?.match_type === "match" ? "Friendly" : "Tournament";

  // Pick a random referee from a team not playing in this fixture.
  const pickReferee = (homeId: string, awayId: string): RosterPlayer | null => {
    const eligible = roster.filter((p) => p.team_id !== homeId && p.team_id !== awayId);
    if (eligible.length === 0) return null;
    return eligible[Math.floor(Math.random() * eligible.length)];
  };

  const notifyReferee = (ref: RosterPlayer, home: string, away: string, time: string | null) => ({
    user_id: ref.player_id,
    type: "referee_assignment",
    title: "You're refereeing a tournament game",
    body: `${home} vs ${away}${time ? ` at ${time}` : ""} · ${t?.title ?? "Tournament"}`,
    link: `/play/tournament/${params.id}`,
  });

  // Random round-robin: every team plays every other once, in a shuffled order,
  // spread evenly across the booked block, each with a random referee.
  const generateRandom = async () => {
    if (!t || teams.length < 2) return;
    setBusy(true); setError(null);

    const pairs: [JoinedTeam, JoinedTeam][] = [];
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++)
        pairs.push([teams[i], teams[j]]);
    const order = shuffle(pairs);

    const startMin = timeToMin(t.start_time);
    const endMin = timeToMin(t.end_time);
    const slot = order.length > 0 ? Math.max(15, Math.floor((endMin - startMin) / order.length)) : 30;

    const rows = order.map(([home, away], i) => {
      const ref = pickReferee(home.team_id, away.team_id);
      return {
        open_match_id: t.id,
        round_label: "Group",
        slot_index: i,
        scheduled_time: minToTime(startMin + i * slot),
        home_team_id: home.team_id, home_team_name: home.team_name,
        away_team_id: away.team_id, away_team_name: away.team_name,
        referee_player_id: ref?.player_id ?? null,
        referee_name: ref?.name ?? null,
        referee_team_id: ref?.team_id ?? null,
        referee_team_name: ref?.team_name ?? null,
        status: "scheduled",
      };
    });

    // Replace any existing schedule.
    await supabase.from("tournament_matches").delete().eq("open_match_id", t.id);
    const { error: insErr } = await supabase.from("tournament_matches").insert(rows);
    if (insErr) { setBusy(false); setError(insErr.code === "42P01" ? "Run supabase_tournament_schedule.sql in Supabase first." : insErr.message); return; }

    // Notify every assigned referee.
    const notifs = rows.filter((r) => r.referee_player_id)
      .map((r) => notifyReferee(
        { player_id: r.referee_player_id!, name: r.referee_name!, team_id: r.referee_team_id!, team_name: r.referee_team_name! },
        r.home_team_name, r.away_team_name, r.scheduled_time
      ));
    if (notifs.length) await supabase.from("notifications").insert(notifs);

    await load();
    setBusy(false);
  };

  const addManualFixture = async () => {
    if (!t) return;
    if (!mHome || !mAway || mHome === mAway) { setError("Pick two different teams."); return; }
    setBusy(true); setError(null);
    const home = teams.find((x) => x.team_id === mHome)!;
    const away = teams.find((x) => x.team_id === mAway)!;
    const ref = pickReferee(home.team_id, away.team_id);
    const slot_index = fixtures.length;
    const { error: insErr } = await supabase.from("tournament_matches").insert({
      open_match_id: t.id, round_label: "Group", slot_index,
      scheduled_time: mTime || null,
      home_team_id: home.team_id, home_team_name: home.team_name,
      away_team_id: away.team_id, away_team_name: away.team_name,
      referee_player_id: ref?.player_id ?? null, referee_name: ref?.name ?? null,
      referee_team_id: ref?.team_id ?? null, referee_team_name: ref?.team_name ?? null,
      status: "scheduled",
    });
    if (insErr) { setBusy(false); setError(insErr.code === "42P01" ? "Run supabase_tournament_schedule.sql in Supabase first." : insErr.message); return; }
    if (ref) await supabase.from("notifications").insert(notifyReferee(ref, home.team_name, away.team_name, mTime || null));
    setMHome(""); setMAway(""); setMTime("");
    await load();
    setBusy(false);
  };

  // Re-roll the referee for one fixture (organiser tweak).
  const reshuffleReferee = async (fx: Fixture) => {
    if (!fx.home_team_id || !fx.away_team_id) return;
    const ref = pickReferee(fx.home_team_id, fx.away_team_id);
    if (!ref) return;
    await supabase.from("tournament_matches").update({
      referee_player_id: ref.player_id, referee_name: ref.name, referee_team_id: ref.team_id, referee_team_name: ref.team_name,
    }).eq("id", fx.id);
    await supabase.from("notifications").insert(notifyReferee(ref, fx.home_team_name ?? "", fx.away_team_name ?? "", fx.scheduled_time));
    await load();
  };

  const clearSchedule = async () => {
    if (!t) return;
    setBusy(true);
    await supabase.from("tournament_matches").delete().eq("open_match_id", t.id);
    await load();
    setBusy(false);
  };

  // Save a fixture's final score (organiser). Nothing else writes results —
  // standings below are computed from these rows.
  const saveResult = async (fx: Fixture) => {
    const d = scoreDraft[fx.id];
    const h = Number(d?.h), a = Number(d?.a);
    if (!d || d.h === "" || d.a === "" || Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0) {
      setError("Enter both scores to save a result."); return;
    }
    setBusy(true); setError(null);
    const { error: upErr } = await supabase.from("tournament_matches")
      .update({ home_score: h, away_score: a, status: "played" }).eq("id", fx.id);
    if (upErr) { setBusy(false); setError(upErr.message); return; }
    await load();
    setBusy(false);
  };

  // Rate one player 1–10 for this event (organiser). Upsert: re-rating replaces.
  const saveRating = async (p: RosterPlayer) => {
    if (!t || !user) return;
    const d = ratingDraft[p.player_id];
    const rating = Number(d?.rating);
    if (!rating) return;
    setError(null);
    const { error: rErr } = await supabase.from("admin_player_ratings").upsert({
      open_match_id: t.id,
      player_id: p.player_id,
      team_id: p.team_id,
      team_name: p.team_name,
      rated_by: user.id,
      rating,
      note: d?.note?.trim() || null,
    }, { onConflict: "open_match_id,player_id" });
    if (rErr) {
      setError(rErr.code === "42P01" ? "Run supabase_admin_hosting.sql in Supabase first." : rErr.message);
      return;
    }
    setSavedRatings((prev) => ({ ...prev, [p.player_id]: rating }));
    setRatingDraft((prev) => ({ ...prev, [p.player_id]: { rating: "", note: "" } }));
  };

  // Take an admin-hosted event off the feed and hand every buy-in back. The
  // route does the deciding — this only collects the reason and reports what
  // came back, including the case where the event went down but a refund
  // didn't.
  const handleTakeDown = async () => {
    if (!t) return;
    setTakeDownBusy(true);
    setTakeDownError(null);
    const res = await takeDownEvent(t.id, takeDownReason.trim());
    setTakeDownBusy(false);
    if ("error" in res) { setTakeDownError(res.error); return; }
    const { refundedPence, refundedTeams, warning } = res.result;
    setTakeDownNote(
      warning ??
      (refundedTeams > 0
        ? `Taken down. £${(refundedPence / 100).toFixed(2)} returned to ${refundedTeams} team${refundedTeams === 1 ? "" : "s"}.`
        : "Taken down. No buy-ins had been taken, so nothing was refunded."),
    );
    setConfirmingTakeDown(false);
    setTakeDownReason("");
    await load();
  };

  if (t === undefined) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  if (!t) return <div className="flex items-center justify-center min-h-screen px-4"><p className="text-text-secondary">Event not found.</p></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold truncate">{t.title}</h1>
          <p className="text-xs text-text-secondary">{t.pitch_name} · {fmtDate(t.match_date)} · {t.start_time}–{t.end_time}</p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {/* Cancelled — the loudest thing on the page, because everything below
            it (the schedule, the entered teams, the buy-in) is now history. */}
        {t.status === "cancelled" && (
          <section className="bg-red-500/10 border border-red-500/30 rounded-card p-4">
            <p className="text-sm font-bold text-red-600">This {noun.toLowerCase()} was cancelled</p>
            <p className="text-xs text-text-secondary mt-1">
              It has left every team&apos;s feed and calendar, and any buy-in taken went back to the team&apos;s credit.
            </p>
            {takenDownReason && (
              <p className="text-xs text-text-secondary mt-2 pt-2 border-t border-red-500/20 break-words">
                <span className="font-semibold">Reason:</span> {takenDownReason}
              </p>
            )}
          </section>
        )}

        {/* Teams entered */}
        <section className="bg-surface border border-border shadow-card rounded-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Teams</p>
            <span className="text-xs text-text-secondary">{teams.length}/{t.max_teams}</span>
          </div>
          {teams.length === 0 ? (
            <p className="text-xs text-text-secondary">No teams have joined yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {teams.map((tm) => (
                <span key={tm.team_id} className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tm.team_id === t.organiser_team_id ? "bg-accent/10 border-accent/30 text-accent-ink" : "bg-background border-border text-text-primary"}`}>
                  {tm.team_name}{tm.team_id === t.organiser_team_id ? " · host" : ""}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Takings — admin-hosted events only. A venue host reads its money in
            the venue portal's Reports, and a team host sees the buy-ins land
            back in Team Credits; only the admin, whose buy-ins simply stay with
            the platform, has nowhere else to look. */}
        {isAdminHost && revenue && (
          <section className="bg-surface border border-border shadow-card rounded-card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">Revenue</p>
              <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-2 py-0.5 rounded-full">kept by Unitr</span>
            </div>
            <div className="flex items-end justify-between">
              <p className="text-2xl font-extrabold tabular-nums">{fmtPence(revenue.collectedPence)}</p>
              <p className="text-[11px] text-text-secondary text-right">
                {revenue.payingTeams} of {teams.length} entr{teams.length === 1 ? "y" : "ies"} paid<br />
                {fmtPence(t.price_per_team_pence)} list price per team
              </p>
            </div>
            <div className="mt-3 pt-3 border-t border-border space-y-1.5">
              {revenue.discountsPence > 0 && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-text-secondary">Invitation discounts given</span>
                  <span className="text-[11px] font-semibold tabular-nums">−{fmtPence(revenue.discountsPence)}</span>
                </div>
              )}
              {!isKickoffPast(t.match_date, t.start_time) && revenue.potentialPence > revenue.collectedPence && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-text-secondary">If every spot sells at list price</span>
                  <span className="text-[11px] font-semibold tabular-nums">{fmtPence(revenue.potentialPence)}</span>
                </div>
              )}
              <p className="text-[10px] text-text-secondary pt-1">
                {revenue.estimated
                  ? "Estimated from entries at list price — run supabase_credit_ledger.sql for exact figures."
                  : "Buy-ins debited from each team's credit. You paid the venue outside the app, so nothing is transferred on."}
              </p>
            </div>
          </section>
        )}

        {/* Entry CTA — a captain arriving from the feed or a suggestion needs to
            be able to actually buy in from here, not just read the schedule. */}
        {(() => {
          const alreadyIn = Boolean(myTeamId && teams.some((tm) => tm.team_id === myTeamId));
          const isFull = teams.length >= t.max_teams || t.status === "full";
          const past = isKickoffPast(t.match_date, t.start_time);
          if (canManage || past || t.status === "cancelled") return null;
          const discounted = Math.max(0, t.price_per_team_pence - inviteDiscountPence);
          return (
            <section className="bg-surface border border-border shadow-card rounded-card p-4">
              {alreadyIn ? (
                <div className="w-full py-2.5 rounded-btn bg-accent/10 border border-accent/30 text-center text-sm font-semibold text-accent-ink">Your team is entered ✓</div>
              ) : isFull ? (
                <div className="w-full py-2.5 rounded-xl bg-surface border border-border text-center text-sm font-semibold text-text-secondary">{noun} full</div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-text-secondary">Buy-in (per team)</span>
                    <span className="text-sm font-bold">
                      {inviteDiscountPence > 0 && <span className="text-[11px] text-text-secondary line-through mr-1.5">£{(t.price_per_team_pence / 100).toFixed(2)}</span>}
                      £{(discounted / 100).toFixed(2)}
                    </span>
                  </div>
                  <button onClick={() => setShowEnter(true)} disabled={!myTeamId}
                    className="w-full py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
                    {inviteDiscountPence > 0 ? `Accept invitation — £${(discounted / 100).toFixed(2)}` : `Enter ${noun}`}
                  </button>
                  {!myTeamId && <p className="text-[11px] text-text-secondary text-center mt-2">Only team captains can enter.</p>}
                </>
              )}
            </section>
          );
        })()}

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3"><p className="text-sm text-red-600">{error}</p></div>}

        {/* Organiser: invite good-fit teams */}
        {canManage && t.status !== "full" && t.status !== "cancelled" && teams.length < t.max_teams && (
          <section className="bg-surface border border-border shadow-card rounded-card p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Invite teams</p>
              <p className="text-[11px] text-text-secondary">Invite good-fit teams{t.venue_owner_id === user?.id || t.organiser_admin_id === user?.id ? " with an optional discount" : ""} to fill the {Math.max(0, t.max_teams - teams.length)} open spot{t.max_teams - teams.length !== 1 ? "s" : ""}.</p>
            </div>
            <button onClick={() => setShowInvite(true)}
              className="px-4 py-2.5 rounded-btn bg-accent text-white text-sm font-bold flex-shrink-0">Invite</button>
          </section>
        )}

        {/* Organiser scheduling controls */}
        {canManage && (
          <section className="bg-surface border border-border shadow-card rounded-card p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Schedule</p>
              {fixtures.length > 0 && (
                <button onClick={clearSchedule} disabled={busy} className="text-xs text-red-600 font-semibold disabled:opacity-50">Clear</button>
              )}
            </div>

            <button onClick={generateRandom} disabled={busy || teams.length < 2}
              className="w-full py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <><svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Working…</> : "Generate random schedule"}
            </button>
            <p className="text-[11px] text-text-secondary -mt-2">Round-robin — every team plays each other once. Referees are drawn randomly from teams sitting out each game and notified.</p>

            {/* Manual add */}
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Add a fixture manually</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <select value={mHome} onChange={(e) => setMHome(e.target.value)} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                  <option value="">Home team</option>
                  {teams.map((tm) => <option key={tm.team_id} value={tm.team_id}>{tm.team_name}</option>)}
                </select>
                <select value={mAway} onChange={(e) => setMAway(e.target.value)} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none text-text-primary">
                  <option value="">Away team</option>
                  {teams.filter((tm) => tm.team_id !== mHome).map((tm) => <option key={tm.team_id} value={tm.team_id}>{tm.team_name}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <input type="time" value={mTime} onChange={(e) => setMTime(e.target.value)}
                  className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none [color-scheme:dark]" />
                <button onClick={addManualFixture} disabled={busy || !mHome || !mAway}
                  className="px-4 py-2.5 rounded-xl bg-surface border border-border text-sm font-semibold disabled:opacity-50">Add</button>
              </div>
            </div>
          </section>
        )}

        {/* Schedule / fixtures */}
        <section className="bg-surface border border-border shadow-card rounded-card p-4">
          <p className="text-sm font-semibold mb-3">Fixtures</p>
          {fixtures.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-6">No fixtures scheduled yet{canManage ? " — generate a schedule above." : "."}</p>
          ) : (
            <div className="space-y-2">
              {fixtures.map((fx, i) => {
                const played = fx.status === "played" && fx.home_score != null && fx.away_score != null;
                const d = scoreDraft[fx.id] ?? { h: "", a: "" };
                return (
                  <div key={fx.id} className="bg-background border border-border rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-text-secondary w-12 flex-shrink-0">{fx.scheduled_time ?? `#${i + 1}`}</span>
                      <span className="flex-1 text-right text-sm font-semibold truncate">{fx.home_team_name}</span>
                      <span className={`text-xs font-bold px-2 ${played ? "text-accent-ink" : "text-text-secondary"}`}>
                        {played ? `${fx.home_score}–${fx.away_score}` : "vs"}
                      </span>
                      <span className="flex-1 text-left text-sm font-semibold truncate">{fx.away_team_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 pl-14">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16v12H5.17L4 17.17V4z"/></svg>
                      <span className="text-[11px] text-text-secondary">
                        Ref: {fx.referee_name ? <span className="text-text-primary font-medium">{fx.referee_name}</span> : "unassigned"}
                        {fx.referee_team_name ? ` (${fx.referee_team_name})` : ""}
                      </span>
                      {canManage && (
                        <button onClick={() => reshuffleReferee(fx)} className="ml-auto text-[11px] text-accent-ink font-semibold">Reshuffle</button>
                      )}
                    </div>
                    {/* Our own game gets a door into it. The organiser owns the
                        score and the referee here; the lineup and the match plan
                        belong to each team privately, which is what that page is. */}
                    {myPlayingTeamId
                      && (fx.home_team_id === myPlayingTeamId || fx.away_team_id === myPlayingTeamId) && (
                      <a href={`/my-team/tournament-match/${fx.id}`}
                        className="block w-full mt-2 py-2 rounded-lg border border-border text-[11px] font-semibold text-text-secondary text-center">
                        {myPlayingTeamId === myTeamId ? "Set lineup & tactics" : "View lineup & details"}
                      </a>
                    )}
                    {/* Organiser result entry — the only place scores are written. */}
                    {canManage && !played && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                        <input type="number" min="0" inputMode="numeric" placeholder="0" value={d.h}
                          onChange={(e) => setScoreDraft((prev) => ({ ...prev, [fx.id]: { ...d, h: e.target.value } }))}
                          className="w-14 bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:border-accent/50" />
                        <span className="text-xs text-text-secondary">–</span>
                        <input type="number" min="0" inputMode="numeric" placeholder="0" value={d.a}
                          onChange={(e) => setScoreDraft((prev) => ({ ...prev, [fx.id]: { ...d, a: e.target.value } }))}
                          className="w-14 bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:border-accent/50" />
                        <button onClick={() => saveResult(fx)} disabled={busy || d.h === "" || d.a === ""}
                          className="ml-auto px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-bold disabled:opacity-50">
                          Save result
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Standings — computed from played fixtures, visible to everyone. */}
        {teams.length > 2 && fixtures.some((f) => f.status === "played") && (
          <section className="bg-surface border border-border shadow-card rounded-card p-4">
            <p className="text-sm font-semibold mb-3">Standings</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-secondary">
                    <th className="text-left font-semibold pb-2">Team</th>
                    <th className="text-center font-semibold pb-2 px-1.5">P</th>
                    <th className="text-center font-semibold pb-2 px-1.5">W</th>
                    <th className="text-center font-semibold pb-2 px-1.5">D</th>
                    <th className="text-center font-semibold pb-2 px-1.5">L</th>
                    <th className="text-center font-semibold pb-2 px-1.5">GD</th>
                    <th className="text-center font-semibold pb-2 pl-1.5">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {computeStandings(teams, fixtures).map((r, i) => (
                    <tr key={r.name} className="border-t border-border">
                      <td className="py-2 font-semibold truncate max-w-[140px]">{i + 1}. {r.name}</td>
                      <td className="text-center py-2 px-1.5 text-text-secondary">{r.played}</td>
                      <td className="text-center py-2 px-1.5 text-text-secondary">{r.w}</td>
                      <td className="text-center py-2 px-1.5 text-text-secondary">{r.d}</td>
                      <td className="text-center py-2 px-1.5 text-text-secondary">{r.l}</td>
                      <td className="text-center py-2 px-1.5 text-text-secondary">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                      <td className="text-center py-2 pl-1.5 font-bold text-accent-ink">{r.pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Organiser: rate players (1–10) — feeds the profile "Event rating". */}
        {canManage && roster.length > 0 && (
          <section className="bg-surface border border-border shadow-card rounded-card p-4">
            <p className="text-sm font-semibold">Rate players</p>
            <p className="text-[11px] text-text-secondary mt-0.5 mb-3">1–10 per player. Saving again replaces the previous rating for this event.</p>
            <div className="space-y-4">
              {teams.map((tm) => {
                const players = roster.filter((p) => p.team_id === tm.team_id);
                if (players.length === 0) return null;
                return (
                  <div key={tm.team_id}>
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">{tm.team_name}</p>
                    <div className="space-y-1.5">
                      {players.map((p) => {
                        const d = ratingDraft[p.player_id] ?? { rating: "", note: "" };
                        const saved = savedRatings[p.player_id];
                        return (
                          <div key={p.player_id} className="flex items-center gap-2 bg-background border border-border rounded-xl px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{p.name}</p>
                              {saved != null && <p className="text-[10px] text-accent-ink font-semibold">Rated {saved}/10</p>}
                            </div>
                            <select value={d.rating}
                              onChange={(e) => setRatingDraft((prev) => ({ ...prev, [p.player_id]: { ...d, rating: e.target.value } }))}
                              className="bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm outline-none text-text-primary">
                              <option value="">–</option>
                              {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <input value={d.note} placeholder="Note"
                              onChange={(e) => setRatingDraft((prev) => ({ ...prev, [p.player_id]: { ...d, note: e.target.value } }))}
                              className="w-24 bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent/50" />
                            <button onClick={() => saveRating(p)} disabled={!d.rating}
                              className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-bold disabled:opacity-40 flex-shrink-0">
                              Save
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Take it down — Unitr staff, Unitr's own events only.
            A team's or a venue's event is their fixture and their money, so
            the button isn't offered for one (and /api/events/take-down refuses
            it anyway). It disappears once kickoff has passed: an event that has
            already been played can't be un-run, and taking it down would hand
            back buy-ins for football that happened. */}
        {role === "admin" && t.organiser_admin_id && t.status !== "cancelled" && !isKickoffPast(t.match_date, t.start_time) && (
          <section className="bg-surface border border-red-500/30 shadow-card rounded-card p-4">
            <p className="text-sm font-semibold">Take this {noun.toLowerCase()} down</p>
            <p className="text-[11px] text-text-secondary mt-1">
              It leaves every team&apos;s feed and calendar, no one else can enter, and every
              buy-in taken goes straight back to that team&apos;s credit. This can&apos;t be undone.
            </p>

            {!confirmingTakeDown ? (
              <button onClick={() => setConfirmingTakeDown(true)}
                className="w-full mt-3 py-2.5 rounded-btn border border-red-500/30 text-red-600 text-sm font-semibold">
                Take down {noun.toLowerCase()}
              </button>
            ) : (
              <div className="mt-3 border-t border-border pt-3 space-y-2">
                <p className="text-[11px] text-text-secondary">
                  {teams.length === 0
                    ? "No team has entered yet."
                    : `${teams.length} team${teams.length === 1 ? " is" : "s are"} entered — each captain is told what you type here, and gets their buy-in back.`}
                </p>
                <input value={takeDownReason} onChange={(e) => setTakeDownReason(e.target.value)} autoFocus
                  placeholder="Reason — e.g. pitch double-booked, too few teams"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-accent/50 placeholder:text-text-secondary" />
                {takeDownError && <p className="text-[11px] text-red-600">{takeDownError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setConfirmingTakeDown(false); setTakeDownError(null); }} disabled={takeDownBusy}
                    className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold disabled:opacity-40">Keep it up</button>
                  <button onClick={handleTakeDown} disabled={takeDownBusy || !takeDownReason.trim()}
                    className="flex-1 py-2 rounded-xl bg-red-500 text-white text-xs font-bold disabled:opacity-40">
                    {takeDownBusy ? "Taking down…" : "Take down"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Stays after the section above disappears — the refund total is the
            only place the admin sees what the take-down actually paid out. */}
        {takeDownNote && (
          <section className="bg-surface-2 border border-border rounded-card p-4">
            <p className="text-xs text-text-secondary">{takeDownNote}</p>
          </section>
        )}
      </div>

      {showInvite && user && (
        <TournamentInvitePanel
          openMatchId={t.id}
          tournamentTitle={t.title}
          buyInPence={t.price_per_team_pence}
          inviterUserId={user.id}
          inviterKind={t.venue_owner_id === user.id ? "venue" : t.organiser_admin_id === user.id ? "admin" : "team"}
          inviterName={t.organiser_team_name ?? t.organiser_admin_name ?? t.pitch_name}
          onClose={() => setShowInvite(false)}
          onSent={load}
        />
      )}

      {showEnter && (
        <EnterTournamentPanel
          tournament={{
            id: t.id, title: t.title, pitchName: t.pitch_name,
            matchDate: t.match_date, startTime: t.start_time,
            pricePerTeamPence: t.price_per_team_pence, maxTeams: t.max_teams,
            joinedCount: teams.length,
            organiserName: t.organiser_team_name ?? t.organiser_admin_name ?? t.pitch_name,
            inviteDiscountPence,
          }}
          myTeamId={myTeamId}
          myTeamName={myTeamName}
          onClose={() => setShowEnter(false)}
          onJoined={() => { setShowEnter(false); load(); }}
        />
      )}
    </div>
  );
}
