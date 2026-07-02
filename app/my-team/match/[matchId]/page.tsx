"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTactics } from "@/contexts/TacticsContext";
import { supabase } from "@/lib/supabase";
import { splitPence } from "@/lib/money";

type PitchInfo = { id?: string; name: string; address?: string; price: number };

type Match = {
  id: string;
  postId: string;
  postingTeamId: string;
  challengingTeamId: string;
  postingTeamName: string;
  challengingTeamName: string;
  confirmedPitch: PitchInfo;
  match_date: string;
  match_time: string;
  status: string;
  created_at: string;
};

type Confirmation = {
  player_id: string;
  team_id: string;
  status: string;
  full_name: string;
};

type OriginalPost = { match_date: string; match_time: string };

// status to use for display/payment purposes when no final confirmation is required
function effectiveStatus(status: string, timeChanged: boolean) {
  return timeChanged ? status : "confirmed";
}

type Tab = "overview" | "squad" | "payment" | "tactics" | "result";

type ResultPlayer = { player_id: string; name: string; started: boolean; subbed_on: boolean; goals: number };

const formations: Record<string, { position: string; x: number; y: number }[]> = {
  "4-3-3": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 25, y: 52 }, { position: "CM", x: 50, y: 50 }, { position: "CM", x: 75, y: 52 },
    { position: "LW", x: 15, y: 28 }, { position: "ST", x: 50, y: 22 }, { position: "RW", x: 85, y: 28 },
  ],
  "4-4-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "LM", x: 15, y: 50 }, { position: "CM", x: 35, y: 50 }, { position: "CM", x: 65, y: 50 }, { position: "RM", x: 85, y: 50 },
    { position: "ST", x: 35, y: 22 }, { position: "ST", x: 65, y: 22 },
  ],
  "4-2-3-1": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CDM", x: 35, y: 55 }, { position: "CDM", x: 65, y: 55 },
    { position: "LW", x: 18, y: 36 }, { position: "CAM", x: 50, y: 36 }, { position: "RW", x: 82, y: 36 },
    { position: "ST", x: 50, y: 18 },
  ],
  "3-5-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "CB", x: 25, y: 72 }, { position: "CB", x: 50, y: 74 }, { position: "CB", x: 75, y: 72 },
    { position: "LWB", x: 10, y: 52 }, { position: "CM", x: 30, y: 50 }, { position: "CM", x: 50, y: 55 }, { position: "CM", x: 70, y: 50 }, { position: "RWB", x: 90, y: 52 },
    { position: "ST", x: 35, y: 22 }, { position: "ST", x: 65, y: 22 },
  ],
};

function ConfirmBadge({ status }: { status: string }) {
  if (status === "confirmed") return <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full">In</span>;
  if (status === "declined") return <span className="text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Out</span>;
  return <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">Pending</span>;
}

export default function ManageMatchPage({ params }: { params: { matchId: string } }) {
  const { user } = useAuth();
  const { tactics, saveTactics } = useTactics();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [myConfirmStatus, setMyConfirmStatus] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [originalPost, setOriginalPost] = useState<OriginalPost | null | undefined>(undefined);
  const [formation, setFormation] = useState("4-3-3");
  const [style, setStyle] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [lineup, setLineup] = useState<Record<number, string>>({});
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [tacticsLoaded, setTacticsLoaded] = useState(false);
  const [savingTactics, setSavingTactics] = useState(false);
  const [isCaptain, setIsCaptain] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleResults, setSettleResults] = useState<Record<string, { ok: boolean; reason?: string }> | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [rosterLocked, setRosterLocked] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());  // players the captain removed from charging
  const [resultVerified, setResultVerified] = useState(false);
  const [myResult, setMyResult] = useState<{ teamScore: number; opponentScore: number } | null>(null);
  const [oppResult, setOppResult] = useState<{ teamScore: number; opponentScore: number } | null>(null);
  const [myResultPlayers, setMyResultPlayers] = useState<ResultPlayer[]>([]);
  const [oppResultPlayers, setOppResultPlayers] = useState<ResultPlayer[]>([]);

  const matchMedia = tactics.media.filter((m) => m.matchId === params.matchId);
  const teamMedia = tactics.media.filter((m) => !m.matchId);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: m } = await supabase.from("matches").select("*").eq("id", params.matchId).maybeSingle();
      if (!m) { setMatch(null); return; }

      const [{ data: pt }, { data: ct }] = await Promise.all([
        supabase.from("teams").select("name").eq("id", m.posting_team_id).maybeSingle(),
        supabase.from("teams").select("name").eq("id", m.challenging_team_id).maybeSingle(),
      ]);

      setMatch({
        id: m.id,
        postId: m.post_id,
        postingTeamId: m.posting_team_id,
        challengingTeamId: m.challenging_team_id,
        postingTeamName: pt?.name ?? "Unknown",
        challengingTeamName: ct?.name ?? "Unknown",
        confirmedPitch: m.confirmed_pitch as PitchInfo,
        match_date: m.match_date,
        match_time: m.match_time,
        status: m.status,
        created_at: m.created_at,
      });

      const { data: captainTeam } = await supabase.from("teams").select("id").eq("captain_id", user.id).maybeSingle();
      let tid = captainTeam?.id ?? null;
      if (!tid) {
        const { data: mem } = await supabase.from("team_members").select("team_id")
          .eq("player_id", user.id).eq("status", "approved").maybeSingle();
        tid = mem?.team_id ?? null;
      }
      setMyTeamId(tid);
      setIsCaptain(!!captainTeam && captainTeam.id === tid);
      setRosterLocked(!!m.roster_locked_at);

      // Booking row backs the replenishment player_payments for this match.
      const { data: bk } = await supabase.from("pitch_bookings").select("id").eq("post_id", m.post_id).maybeSingle();
      setBookingId(bk?.id ?? null);

      const { data: confs } = await supabase
        .from("match_confirmations")
        .select("player_id, team_id, status, profiles(full_name)")
        .eq("match_id", m.id);

      const mapped = (confs ?? []).map((c) => ({
        player_id: c.player_id,
        team_id: c.team_id,
        status: c.status,
        full_name: (c.profiles as { full_name: string } | null)?.full_name ?? "Unknown",
      }));
      setConfirmations(mapped);
      setMyConfirmStatus(mapped.find((c) => c.player_id === user.id)?.status ?? null);
    }
    load();
  }, [user, params.matchId]);

  // Was the confirmed slot a different time/date than the team originally posted/polled for?
  // (e.g. an alt-time backup pitch got picked) — if so, players need to give a final confirmation.
  useEffect(() => {
    if (!match?.postId) return;
    supabase.from("match_posts").select("match_date, match_time").eq("id", match.postId).maybeSingle()
      .then(({ data }) => setOriginalPost(data ?? null));
  }, [match?.postId]);

  // Load this team's private match tactics/lineup (separate from the opposing captain's)
  useEffect(() => {
    if (!myTeamId || !match) return;
    supabase.from("match_tactics").select("*").eq("match_id", match.id).eq("team_id", myTeamId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFormation(data.formation ?? "4-3-3");
          setStyle(data.style ?? null);
          setNotes(data.notes ?? "");
          setLineup((data.lineup ?? {}) as Record<number, string>);
        }
        setTacticsLoaded(true);
      });
  }, [myTeamId, match]);

  // Live countdown: 3h from match creation
  useEffect(() => {
    if (!match) return;
    const deadline = new Date(match.created_at).getTime() + 3 * 60 * 60 * 1000;
    function tick() {
      const r = deadline - Date.now();
      if (r <= 0) { setCountdown("Expired"); return; }
      const h = Math.floor(r / 3600000);
      const min = Math.floor((r % 3600000) / 60000);
      const s = Math.floor((r % 60000) / 1000);
      setCountdown(`${h}h ${String(min).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [match]);

  // Load submitted results + players for both teams whenever the match and team are known.
  useEffect(() => {
    if (!match || !myTeamId) return;
    const currentMatch = match;
    const tid = myTeamId;
    async function loadResults() {
      const [{ data: results }, { data: players }] = await Promise.all([
        supabase.from("match_results").select("team_id, team_score, opponent_score").eq("match_id", params.matchId),
        supabase.from("match_result_players").select("team_id, player_id, started, subbed_on, goals").eq("match_id", params.matchId),
      ]);

      // Fetch names for all players in the result.
      const playerIds = [...new Set((players ?? []).map((p) => p.player_id))];
      const { data: profiles } = playerIds.length > 0
        ? await supabase.from("profiles").select("id, full_name").in("id", playerIds)
        : { data: [] };
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name as string]));

      // Check if result is verified via DB (both teams submitted matching scores).
      const { data: matchMeta } = await supabase.from("matches").select("result_verified").eq("id", params.matchId).maybeSingle();
      setResultVerified(!!matchMeta?.result_verified);

      const oppId = tid === currentMatch.postingTeamId ? currentMatch.challengingTeamId : currentMatch.postingTeamId;

      const myRes = (results ?? []).find((r) => r.team_id === tid);
      const oppRes = (results ?? []).find((r) => r.team_id === oppId);
      setMyResult(myRes ? { teamScore: myRes.team_score, opponentScore: myRes.opponent_score } : null);
      setOppResult(oppRes ? { teamScore: oppRes.team_score, opponentScore: oppRes.opponent_score } : null);

      const toPlayer = (p: { player_id: string; started: boolean; subbed_on: boolean; goals: number }): ResultPlayer => ({
        player_id: p.player_id,
        name: nameById.get(p.player_id) ?? "Player",
        started: p.started,
        subbed_on: p.subbed_on,
        goals: p.goals,
      });
      setMyResultPlayers((players ?? []).filter((p) => p.team_id === tid).map(toPlayer));
      setOppResultPlayers((players ?? []).filter((p) => p.team_id === oppId).map(toPlayer));
    }
    loadResults();
  }, [match, myTeamId, params.matchId]);

  const handleConfirmAttendance = async (newStatus: "confirmed" | "declined") => {
    if (!user || !myTeamId) return;
    await supabase.from("match_confirmations").upsert({
      match_id: params.matchId,
      player_id: user.id,
      team_id: myTeamId,
      status: newStatus,
    }, { onConflict: "match_id,player_id" });
    setMyConfirmStatus(newStatus);
    setConfirmations((prev) => prev.map((c) => c.player_id === user.id ? { ...c, status: newStatus } : c));
  };

  // Roster-lock settlement (captain): freeze MY team's confirmed squad and charge
  // each actual participant's saved card off-session, refilling the team's credit.
  const handleSettleSquad = async () => {
    if (!match || !myTeamId) return;
    setSettling(true);
    setSettleError(null);

    if (!bookingId) {
      setSettleError("No booking is linked to this match yet — settlement isn't available.");
      setSettling(false);
      return;
    }

    // Actual participants on my team = those confirmed for the (possibly retimed)
    // slot, minus anyone the captain explicitly excluded from this charge.
    const participants = confirmations.filter(
      (c) => c.team_id === myTeamId && effectiveStatus(c.status, timeChanged) === "confirmed" && !excluded.has(c.player_id)
    );
    if (participants.length === 0) {
      setSettleError("No players selected to charge.");
      setSettling(false);
      return;
    }

    // This team's pool = the net it owes (poster: P − ⌊P/2⌋, challenger: ⌊P/2⌋).
    const feePence = Math.round(match.confirmedPitch.price * 100);
    const halfPence = Math.floor(feePence / 2);
    const isPoster = myTeamId === match.postingTeamId;
    const poolPence = isPoster ? feePence - halfPence : halfPence;
    const shares = splitPence(poolPence, participants.length);

    // Already-settled players (e.g. a prior partial run) must not be charged again.
    const { data: existing } = await supabase
      .from("player_payments").select("player_id, status")
      .eq("booking_id", bookingId).eq("purpose", "replenish");
    const alreadyPaid = new Set((existing ?? []).filter((r) => r.status === "paid").map((r) => r.player_id));

    // Saved cards for the players we still need to charge.
    const toCharge = participants
      .map((p, i) => ({ p, share: shares[i] }))
      .filter(({ p }) => !alreadyPaid.has(p.player_id));

    if (toCharge.length === 0) {
      setSettleError("Everyone on your squad is already settled.");
      setSettling(false);
      return;
    }

    const { data: profs } = await supabase
      .from("profiles").select("id, stripe_customer_id, stripe_payment_method_id")
      .in("id", toCharge.map(({ p }) => p.player_id));
    const cardOf = new Map((profs ?? []).map((p) => [p.id, p]));

    const items = toCharge.map(({ p, share }) => {
      const fee = Math.round(share * 0.05);
      const card = cardOf.get(p.player_id);
      return {
        playerId: p.player_id,
        customerId: card?.stripe_customer_id ?? null,
        paymentMethodId: card?.stripe_payment_method_id ?? null,
        sharePence: share,
        feePence: fee,
        amountPence: share + fee,
        matchId: match.id,
        bookingId,
      };
    });

    type ChargeResult = { playerId: string; ok: boolean; paymentIntentId?: string; error?: string; noCard?: boolean };
    let results: ChargeResult[] = [];
    try {
      const res = await fetch("/api/settle-match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await res.json();
      if (!res.ok) { setSettleError(d.error ?? "Settlement failed."); setSettling(false); return; }
      results = d.results ?? [];
    } catch {
      setSettleError("Could not reach the payment service.");
      setSettling(false);
      return;
    }

    // Persist outcomes: paid rows refill credit via apply_replenishment; failed
    // rows are stored so the player can settle manually at /pay.
    const resultMap: Record<string, { ok: boolean; reason?: string }> = {};
    for (const it of items) {
      const r = results.find((x) => x.playerId === it.playerId);
      const ok = !!r?.ok;
      const { data: row } = await supabase.from("player_payments").upsert({
        booking_id: bookingId,
        player_id: it.playerId,
        team_id: myTeamId,
        amount_pence: it.sharePence,
        unitr_fee_pence: it.feePence,
        total_pence: it.amountPence,
        purpose: "replenish",
        off_session: true,
        status: ok ? "paid" : "failed",
        stripe_payment_intent_id: r?.paymentIntentId ?? null,
        failure_reason: ok ? null : (r?.noCard ? "No saved card" : r?.error ?? "Charge failed"),
        paid_at: ok ? new Date().toISOString() : null,
      }, { onConflict: "booking_id,player_id" }).select("id").single();

      if (ok && row?.id) await supabase.rpc("apply_replenishment", { p_payment_id: row.id });
      resultMap[it.playerId] = { ok, reason: r?.noCard ? "No saved card" : r?.error };
    }

    await supabase.from("matches").update({
      roster_locked_at: new Date().toISOString(),
      settled_at: new Date().toISOString(),
    }).eq("id", match.id);

    setSettleResults(resultMap);
    setRosterLocked(true);
    setSettling(false);
  };

  const handleSaveMatchTactics = async () => {
    if (!myTeamId || !match) return;
    setSavingTactics(true);
    await supabase.from("match_tactics").upsert({
      match_id: match.id,
      team_id: myTeamId,
      formation,
      style,
      notes,
      lineup,
    }, { onConflict: "match_id,team_id" });
    setSavingTactics(false);
  };

  const loadFromTeamTactics = () => {
    setFormation(tactics.formation);
    setStyle(tactics.style);
    setNotes(tactics.notes);
  };

  if (match === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }
  if (match === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 gap-4 text-center">
        <p className="text-text-secondary">Match not found.</p>
        <a href="/my-team" className="text-sm text-accent font-medium">Back to My Team</a>
      </div>
    );
  }

  const timeChanged = originalPost
    ? (originalPost.match_time !== match.match_time || originalPost.match_date !== match.match_date)
    : false;
  const confirmedCount = confirmations.filter((c) => effectiveStatus(c.status, timeChanged) === "confirmed").length;
  const totalPlayers = confirmations.length > 0 ? confirmations.length : 22;
  const effectivePlayers = confirmedCount > 0 ? confirmedCount : totalPlayers;
  const perPlayer = ((match.confirmedPitch.price * 1.05) / effectivePlayers).toFixed(2);
  const myTeamName = myTeamId === match.postingTeamId ? match.postingTeamName : match.challengingTeamName;
  const opponentTeamId = myTeamId === match.postingTeamId ? match.challengingTeamId : match.postingTeamId;
  const opponentName = myTeamId === match.postingTeamId ? match.challengingTeamName : match.postingTeamName;
  const myTeamConfs = confirmations.filter((c) => c.team_id === myTeamId);
  const opponentConfs = confirmations.filter((c) => c.team_id === opponentTeamId);
  const players = formations[formation];

  // Roster-lock settlement figures for MY team (PAYMENT_PLAN §10).
  const myParticipants = confirmations.filter(
    (c) => c.team_id === myTeamId && effectiveStatus(c.status, timeChanged) === "confirmed"
  );
  const chargedParticipants = myParticipants.filter((c) => !excluded.has(c.player_id));
  const feePence = Math.round(match.confirmedPitch.price * 100);
  const halfPence = Math.floor(feePence / 2);
  const isPoster = myTeamId === match.postingTeamId;
  const teamPoolPence = isPoster ? feePence - halfPence : halfPence;
  const teamShare = chargedParticipants.length > 0 ? teamPoolPence / chargedParticipants.length / 100 : 0;

  // ── Result-view derived data ──────────────────────────────────
  const pitchPositions = formations[formation] ?? formations["4-3-3"];
  const myStarters = myResultPlayers.filter((p) => p.started);
  const myBench    = myResultPlayers.filter((p) => p.subbed_on);
  const myScorers  = myResultPlayers.filter((p) => p.goals > 0);
  const oppScorers = oppResultPlayers.filter((p) => p.goals > 0);
  const hasResult  = !!myResult || !!oppResult;
  const myS = myResult?.teamScore ?? 0;
  const oppS = myResult?.opponentScore ?? 0;
  const myInitials  = myTeamName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const oppInitials = opponentName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const fmtMatchDate = /^\d{4}-\d{2}-\d{2}$/.test(match.match_date)
    ? new Date(match.match_date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : match.match_date;
  const playerNameMap = new Map<string, string>([
    ...confirmations.map((c): [string, string] => [c.player_id, c.full_name]),
    ...myResultPlayers.map((p): [string, string] => [p.player_id, p.name]),
  ]);
  // Returns initials + first name for the player assigned to pitch slot i
  // (from match_tactics lineup), falling back to result-order if no lineup.
  const slotPlayer = (i: number): { initials: string; firstName: string } | null => {
    const pid = lineup[i] ?? myStarters[i]?.player_id;
    if (!pid) return null;
    const n = playerNameMap.get(pid) ?? myResultPlayers.find((p) => p.player_id === pid)?.name ?? "";
    if (!n) return null;
    return { initials: n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(), firstName: n.split(" ")[0] };
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1">
          <h1 className="text-base font-bold">{myTeamName} vs {opponentName}</h1>
        </div>
      </div>

      {/* ── Result view (no tabs) ──────────────────────────────── */}

      {/* ── Score block ── */}
      <div className="bg-surface-2 border border-border rounded-2xl pt-5 pb-4 px-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
              <span className="text-sm font-bold text-accent">{myInitials}</span>
            </div>
            <p className="text-xs font-semibold text-center leading-tight">{myTeamName}</p>
          </div>
          <div className="flex flex-col items-center px-3">
            {hasResult ? (
              <>
                <p className="text-5xl font-extrabold tracking-tighter leading-none mb-1">{myS} – {oppS}</p>
                <p className="text-[11px] text-text-secondary">{resultVerified ? "Full time" : "Pending"}</p>
              </>
            ) : (
              <p className="text-sm text-text-secondary font-medium">No result yet</p>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center">
              <span className="text-sm font-bold text-text-secondary">{oppInitials}</span>
            </div>
            <p className="text-xs font-semibold text-center leading-tight">{opponentName}</p>
          </div>
        </div>

        <div className="border-t border-border pt-3 flex flex-col items-center gap-0.5">
          <p className="text-[11px] text-text-secondary">{fmtMatchDate} · {match.match_time}</p>
          <p className="text-[11px] text-text-secondary">{match.confirmedPitch.name}</p>
        </div>

        {(myScorers.length > 0 || oppScorers.length > 0) && (
          <div className="border-t border-border pt-3 flex gap-2 text-[11px]">
            <div className="flex-1 space-y-0.5">
              {myScorers.map((p) => (
                <p key={p.player_id} className="text-text-secondary">⚽ {p.name}{p.goals > 1 ? ` ×${p.goals}` : ""}</p>
              ))}
            </div>
            <div className="flex-1 space-y-0.5 text-right">
              {oppScorers.map((p) => (
                <p key={p.player_id} className="text-text-secondary">{p.name}{p.goals > 1 ? ` ×${p.goals}` : ""} ⚽</p>
              ))}
            </div>
          </div>
        )}

        {!myResult && isCaptain && (
          <a href={`/my-team/match/${params.matchId}/result`}
            className="block w-full py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold text-center">
            Submit Result
          </a>
        )}
        {myResult && !resultVerified && !oppResult && (
          <p className="text-[11px] text-yellow-400 text-center">Waiting for {opponentName} to submit their result</p>
        )}
      </div>

      {myStarters.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{myTeamName} · Starting XI</p>
          <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg,#1a5c1a 0%,#1e6b1e 25%,#1a5c1a 50%,#1e6b1e 75%,#1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
              <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="5" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="107" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
            </svg>
            {pitchPositions.map((pos, i) => {
              const sp = slotPlayer(i);
              if (!sp) return null;
              return (
                <div key={i} className="absolute flex flex-col items-center gap-0.5"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }}>
                  <div className="w-9 h-9 rounded-full bg-white border-2 border-white/80 flex items-center justify-center shadow-lg">
                    <span className="text-[10px] font-bold text-black leading-none">{sp.initials}</span>
                  </div>
                  <span className="text-[9px] font-semibold text-white drop-shadow-md bg-black/40 rounded px-1 truncate max-w-[48px] text-center">{sp.firstName}</span>
                </div>
              );
            })}
          </div>

          {myBench.length > 0 && (
            <div className="mt-3 bg-surface-2 border border-border rounded-xl p-3">
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Bench</p>
              <div className="space-y-2">
                {myBench.map((p) => {
                  const init = p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key={p.player_id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#22c55e"><path d="M12 2l10 20H2z"/></svg>
                        <p className="text-sm">{p.name}</p>
                      </div>
                      {p.goals > 0 && <span className="text-[11px] text-text-secondary">⚽ {p.goals}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {oppResultPlayers.length > 0 && (
        <div className="bg-surface-2 border border-border rounded-2xl p-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">{opponentName}</p>
          {oppResultPlayers.filter((p) => p.started).map((p) => {
            const init = p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            return (
              <div key={p.player_id} className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                </div>
                <p className="flex-1 text-sm">{p.name}</p>
                {p.goals > 0 && <span className="text-[11px] text-text-secondary">⚽ {p.goals}</span>}
              </div>
            );
          })}
          {oppResultPlayers.filter((p) => p.subbed_on).length > 0 && (
            <>
              <div className="border-t border-border pt-2 mt-1 mb-2">
                <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Bench</p>
              </div>
              {oppResultPlayers.filter((p) => p.subbed_on).map((p) => {
                const init = p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={p.player_id} className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#22c55e"><path d="M12 2l10 20H2z"/></svg>
                      <p className="text-sm">{p.name}</p>
                    </div>
                    {p.goals > 0 && <span className="text-[11px] text-text-secondary">⚽ {p.goals}</span>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
