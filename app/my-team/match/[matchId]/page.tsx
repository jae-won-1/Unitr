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

type Tab = "overview" | "squad" | "payment" | "tactics";

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

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1">
          <h1 className="text-base font-bold">{myTeamName} vs {opponentName}</h1>
          <p className="text-xs text-text-secondary">{match.match_date} · {match.match_time}</p>
        </div>
        <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-1 rounded-full">Confirmed</span>
      </div>

      {/* Tabs */}
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 mb-5 gap-0.5">
        {(["overview", "squad", "payment", "tactics"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${tab === t ? "bg-accent text-black" : "text-text-secondary"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="bg-accent/10 border border-accent/30 rounded-2xl p-4 space-y-2.5">
            <p className="text-sm font-bold text-accent mb-1">Match Details</p>
            {[
              { label: "My Team", value: myTeamName },
              { label: "Opponent", value: opponentName },
              { label: "Date", value: match.match_date },
              { label: "Kick-off", value: match.match_time },
              { label: "Venue", value: match.confirmedPitch.name },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>

          {/* Match share — settled after the match via Team Credits */}
          <div className="bg-surface-2 border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold">Match Share</p>
              <span className="text-sm font-bold text-accent">£{perPlayer}/player</span>
            </div>
            <p className="text-xs text-text-secondary mb-3">
              {confirmedCount}/{confirmations.length} players confirmed
            </p>
            {isCaptain ? (
              <button onClick={() => setTab("payment")}
                className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
                Settle Squad
              </button>
            ) : (
              <p className="text-xs text-text-secondary">
                After the match, your share is collected under <span className="text-accent font-semibold">Team Credits → Dues</span>. You&apos;ll get a reminder to settle it.
              </p>
            )}
          </div>

          {/* Attendance */}
          {timeChanged ? (
            myConfirmStatus !== null && (
              <div className="bg-surface-2 border border-border rounded-2xl p-4">
                <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1.5">Final Confirmation Needed</p>
                <p className="text-xs text-text-secondary mb-3">
                  Kick-off ({match.match_time}) is different from your team&apos;s original availability poll ({originalPost?.match_time}). Confirm you can still make it.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => handleConfirmAttendance("confirmed")}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${myConfirmStatus === "confirmed" ? "bg-accent text-black" : "bg-surface border border-border text-text-secondary"}`}>
                    ✓ I&apos;m In
                  </button>
                  <button onClick={() => handleConfirmAttendance("declined")}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${myConfirmStatus === "declined" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-surface border border-border text-text-secondary"}`}>
                    ✕ Can&apos;t Make It
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="bg-surface-2 border border-border rounded-2xl p-4 flex items-center gap-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
              <p className="text-xs text-text-secondary">Kick-off matches your team&apos;s original availability poll — no further confirmation needed.</p>
            </div>
          )}
        </div>
      )}

      {/* ── SQUAD ── */}
      {tab === "squad" && (
        <div>
          {!timeChanged && (
            <p className="text-[11px] text-text-secondary mb-3">Kick-off matches each team&apos;s availability poll — listed players are participating.</p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            {/* My team */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1 truncate">{myTeamName}</p>
              {myTeamConfs.length === 0 ? (
                <p className="text-[11px] text-text-secondary py-4 text-center">No players listed.</p>
              ) : myTeamConfs.map((c) => {
                const initials = c.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                const isMe = c.player_id === user?.id;
                return (
                  <div key={c.player_id} className="bg-surface-2 border border-border rounded-xl px-2.5 py-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-accent">{initials}</span>
                      </div>
                      <p className="flex-1 min-w-0 text-xs font-medium truncate">{c.full_name}{isMe ? " (You)" : ""}</p>
                    </div>
                    {timeChanged ? (
                      isMe ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleConfirmAttendance("confirmed")}
                            className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition-colors ${myConfirmStatus === "confirmed" ? "bg-accent text-black" : "bg-surface border border-border text-text-secondary"}`}>
                            In
                          </button>
                          <button onClick={() => handleConfirmAttendance("declined")}
                            className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition-colors ${myConfirmStatus === "declined" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-surface border border-border text-text-secondary"}`}>
                            Out
                          </button>
                        </div>
                      ) : <ConfirmBadge status={c.status} />
                    ) : (
                      <span className="text-[9px] font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full self-start">Playing</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Opponent team */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1 truncate">{opponentName}</p>
              {opponentConfs.length === 0 ? (
                <p className="text-[11px] text-text-secondary py-4 text-center">No players listed.</p>
              ) : opponentConfs.map((c) => {
                const initials = c.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={c.player_id} className="bg-surface-2 border border-border rounded-xl px-2.5 py-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-text-secondary">{initials}</span>
                      </div>
                      <p className="flex-1 min-w-0 text-xs font-medium truncate">{c.full_name}</p>
                    </div>
                    {timeChanged ? (
                      <ConfirmBadge status={c.status} />
                    ) : (
                      <span className="text-[9px] font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full self-start">Playing</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── PAYMENT ── */}
      {tab === "payment" && (
        <div className="space-y-4">
          <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold">Payment Breakdown</p>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-text-secondary">
                <span>Pitch hire (1hr)</span>
                <span className="font-semibold text-text-primary">£{match.confirmedPitch.price}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>Unitr fee (5%)</span>
                <span className="font-semibold text-text-primary">£{(match.confirmedPitch.price * 0.05).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>{myTeamName} players</span>
                <span className="font-semibold text-text-primary">{myParticipants.length} played</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="font-semibold text-text-primary">Your share (inc. 5%)</span>
                <span className="font-bold text-accent text-sm">£{(teamShare * 1.05).toFixed(2)}</span>
              </div>
            </div>
            <p className="text-[10px] text-text-secondary">
              The pitch is already secured with team credit. When the squad is locked, each
              player who played is charged automatically to refill the credit.
            </p>
          </div>

          <div className="bg-surface-2 border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Payment Deadline</p>
              <span className={`text-sm font-bold tabular-nums ${countdown === "Expired" ? "text-red-400" : "text-accent"}`}>{countdown}</span>
            </div>
            <div className="w-full h-1.5 bg-background rounded-full mb-2">
              <div className="h-1.5 bg-accent rounded-full transition-all"
                style={{ width: `${Math.min(100, confirmations.length > 0 ? (confirmedCount / confirmations.length) * 100 : 0)}%` }} />
            </div>
            <p className="text-xs text-text-secondary">{confirmedCount} of {confirmations.length} players confirmed</p>
          </div>

          {/* ── Captain: lock squad & auto-charge saved cards ── */}
          {isCaptain ? (
            <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Settle {myTeamName}</p>
                {rosterLocked && (
                  <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">Squad locked</span>
                )}
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-text-secondary">
                  <span>Your team&apos;s share of pitch</span>
                  <span className="font-semibold text-text-primary">£{(teamPoolPence / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-text-secondary">
                  <span>Players being charged</span>
                  <span className="font-semibold text-text-primary">{chargedParticipants.length} of {myParticipants.length}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5">
                  <span className="font-semibold text-text-primary">Each pays (+5% fee)</span>
                  <span className="font-bold text-accent">£{teamShare.toFixed(2)}</span>
                </div>
              </div>

              {/* Captain picks who's charged — defaults to everyone who played */}
              {!rosterLocked && myParticipants.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-text-secondary">Tap to exclude a player from this charge (e.g. a guest or no-show who was still confirmed).</p>
                  {myParticipants.map((c) => {
                    const isIn = !excluded.has(c.player_id);
                    return (
                      <button key={c.player_id}
                        onClick={() => setExcluded((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.player_id)) next.delete(c.player_id); else next.add(c.player_id);
                          return next;
                        })}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${isIn ? "bg-background border-border" : "bg-surface border-border opacity-50"}`}>
                        <span className="truncate">{c.player_id === user?.id ? `${c.full_name} (You)` : c.full_name}</span>
                        <span className={`text-[10px] font-semibold flex-shrink-0 ${isIn ? "text-accent" : "text-text-secondary"}`}>
                          {isIn ? "Charging" : "Excluded"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Per-player results after settling */}
              {settleResults && (
                <div className="space-y-1.5">
                  {myParticipants.map((c) => {
                    const r = settleResults[c.player_id];
                    return (
                      <div key={c.player_id} className="flex items-center justify-between text-xs bg-background border border-border rounded-lg px-3 py-2">
                        <span className="truncate">{c.full_name}</span>
                        {r?.ok ? (
                          <span className="text-[10px] font-semibold text-accent flex-shrink-0">Charged ✓</span>
                        ) : r ? (
                          <span className="text-[10px] font-semibold text-red-400 flex-shrink-0">{r.reason ?? "Failed"}</span>
                        ) : (
                          <span className="text-[10px] font-semibold text-accent flex-shrink-0">Already settled</span>
                        )}
                      </div>
                    );
                  })}
                  {Object.values(settleResults).some((r) => !r.ok) && (
                    <p className="text-[10px] text-text-secondary">
                      Players whose card failed can still pay manually below — the pitch stays
                      secured by your team credit in the meantime.
                    </p>
                  )}
                </div>
              )}

              {settleError && <p className="text-xs text-red-400">{settleError}</p>}

              <button onClick={handleSettleSquad} disabled={settling}
                className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
                {settling ? "Charging cards…" : rosterLocked ? "Re-run for unsettled players" : "Lock squad & charge cards"}
              </button>
              <p className="text-[10px] text-text-secondary text-center">
                Charges each player&apos;s saved card automatically · refills team credit
              </p>
            </div>
          ) : (
            /* ── Player: shares are settled after the match in Team Credits → Dues ── */
            <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold">Your share</p>
              <p className="text-xs text-text-secondary">
                Once this match has been played, your share is added to your team&apos;s
                Dues. Settle it any time from Team Credits — you&apos;ll get a reminder too.
              </p>
              <a href="/my-team"
                className="block w-full py-3 rounded-xl bg-accent text-black font-bold text-sm text-center">
                Go to Team Credits
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── TACTICS ── */}
      {tab === "tactics" && (
        <div className="space-y-4">
          {tacticsLoaded && (
            <button onClick={loadFromTeamTactics}
              className="w-full py-2.5 rounded-xl bg-surface-2 border border-dashed border-border text-xs font-semibold text-text-secondary flex items-center justify-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>
              Load from My Team Tactics
            </button>
          )}

          <div className="flex gap-2 overflow-x-auto pb-1">
            {Object.keys(formations).map((f) => (
              <button key={f} onClick={() => { setFormation(f); setLineup({}); }}
                className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${formation === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{f}</button>
            ))}
          </div>
          <p className="text-[11px] text-text-secondary -mt-2">Tap a position to assign a player from your squad.</p>

          <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg, #1a5c1a 0%, #1e6b1e 25%, #1a5c1a 50%, #1e6b1e 75%, #1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
              <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="0.8" fill="rgba(255,255,255,0.6)"/>
              <rect x="22" y="5" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="34" y="5" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="22" y="105" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="34" y="115" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
            </svg>
            {players.map((p, i) => {
              const assignedPlayer = myTeamConfs.find((c) => c.player_id === lineup[i]);
              const label = assignedPlayer
                ? assignedPlayer.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
                : p.position;
              return (
                <button key={i} onClick={() => setPickerSlot(i)}
                  className="absolute flex flex-col items-center gap-0.5" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)" }}>
                  <div className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center shadow-lg ${assignedPlayer ? "bg-blue-500" : "bg-accent"}`}>
                    <span className="text-[9px] font-bold text-black leading-none">{label}</span>
                  </div>
                  {assignedPlayer && (
                    <span className="text-[8px] font-semibold text-white bg-black/50 rounded px-1 truncate max-w-[44px]">
                      {assignedPlayer.full_name.split(" ")[0]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Match Plan</p>
            <div className="flex gap-2 flex-wrap">
              {["Possession", "Counter-Attack", "High Press", "Direct Play", "Park the Bus"].map((s) => (
                <button key={s} onClick={() => setStyle(s === style ? null : s)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${style === s ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{s}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Match Notes</p>
            <textarea rows={3}
              placeholder={`Instructions vs ${opponentName} — weaknesses, set pieces, key threats…`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none"
            />
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Media</p>
            {[...matchMedia, ...teamMedia].length === 0 ? (
              <p className="text-xs text-text-secondary italic mb-3">No media added yet.</p>
            ) : (
              <div className="space-y-2 mb-3">
                {[...matchMedia, ...teamMedia].map((item) => (
                  <div key={item.id} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${item.type === "video" ? "bg-purple-500/15 border border-purple-500/30" : "bg-blue-500/15 border border-blue-500/30"}`}>
                      {item.type === "video"
                        ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      <p className="text-xs text-text-secondary capitalize">{item.type}</p>
                    </div>
                    <button onClick={() => saveTactics({ media: tactics.media.filter((m) => m.id !== item.id) })} className="text-xs text-red-400">Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => saveTactics({ media: [...tactics.media, { id: String(Date.now()), type: "image", label: "New image tactic", matchId: params.matchId }] })}
                className="flex flex-col items-center gap-2 bg-surface-2 border border-dashed border-border rounded-xl py-4 text-text-secondary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="text-xs font-semibold">Upload Image</span>
              </button>
              <button onClick={() => saveTactics({ media: [...tactics.media, { id: String(Date.now() + 1), type: "video", label: "New video tactic", matchId: params.matchId }] })}
                className="flex flex-col items-center gap-2 bg-surface-2 border border-dashed border-border rounded-xl py-4 text-text-secondary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span className="text-xs font-semibold">Upload Video</span>
              </button>
            </div>
          </div>

          <button onClick={handleSaveMatchTactics} disabled={savingTactics}
            className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
            {savingTactics ? "Saving…" : "Save & Share with Squad"}
          </button>
        </div>
      )}

      {/* Lineup slot player picker */}
      {pickerSlot !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-16" onClick={() => setPickerSlot(null)}>
          <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl p-5 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold mb-1">Assign {players[pickerSlot].position}</p>
            <p className="text-xs text-text-secondary mb-4">Pick a player from {myTeamName}.</p>
            <div className="space-y-2">
              {myTeamConfs.length === 0 && <p className="text-xs text-text-secondary py-4 text-center">No squad listed.</p>}
              {myTeamConfs.map((c) => {
                const initials = c.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                const assignedElsewhere = Object.entries(lineup).some(([slot, pid]) => Number(slot) !== pickerSlot && pid === c.player_id);
                return (
                  <button key={c.player_id}
                    onClick={() => { setLineup((prev) => ({ ...prev, [pickerSlot]: c.player_id })); setPickerSlot(null); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-2 text-left">
                    <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-accent">{initials}</span>
                    </div>
                    <p className="flex-1 text-sm font-medium truncate">{c.full_name}</p>
                    {assignedElsewhere && <span className="text-[10px] text-text-secondary flex-shrink-0">already placed</span>}
                  </button>
                );
              })}
            </div>
            {lineup[pickerSlot] !== undefined && (
              <button onClick={() => { setLineup((prev) => { const next = { ...prev }; delete next[pickerSlot]; return next; }); setPickerSlot(null); }}
                className="w-full mt-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                Clear Slot
              </button>
            )}
            <button onClick={() => setPickerSlot(null)} className="w-full mt-2 py-2.5 rounded-xl border border-border text-text-secondary text-xs font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
