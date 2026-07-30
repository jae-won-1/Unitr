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
  // A paid guest player. In the squad and the lineup, but never in the charge —
  // they've already paid Unitr their flat ringer fee (supabase_ringers.sql).
  is_ringer: boolean;
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

// ── Ringer request (captain) ──────────────────────────────────
// Short of bodies for this match? Post the positions you need and the spots
// show up in every player's Fill In feed. Guests pay Unitr a flat fee to join
// — nothing about the team's own pitch split changes.
const RINGER_POSITIONS = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"];
const RINGER_FEE_PENCE = 500;

type RingerRequestRow = { id: string; positions: string[]; spots: number; notes: string | null; status: string };
type RingerSignup = { player_id: string; name: string; position: string | null };

function RingerRequestPanel({ matchId, teamId, userId }: { matchId: string; teamId: string; userId: string }) {
  const [request, setRequest] = useState<RingerRequestRow | null | undefined>(undefined);
  const [signups, setSignups] = useState<RingerSignup[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [spots, setSpots] = useState(1);
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: reqErr } = await supabase.from("ringer_requests")
        .select("id, positions, spots, notes, status")
        .eq("match_id", matchId).eq("team_id", teamId).maybeSingle();
      if (reqErr) {
        // Table missing — the migration hasn't been run on this database.
        setError("Ringer requests aren't set up yet — run supabase_ringers.sql.");
        setRequest(null);
        return;
      }
      setRequest(data ?? null);
      if (data) {
        setPositions(data.positions ?? []);
        setSpots(data.spots ?? 1);
        setNotes(data.notes ?? "");
        const { data: su } = await supabase.from("ringer_signups")
          .select("player_id, position").eq("request_id", data.id);
        const ids = (su ?? []).map((s) => s.player_id);
        const { data: profs } = ids.length
          ? await supabase.from("profiles").select("id, full_name").in("id", ids)
          : { data: [] as { id: string; full_name: string }[] };
        const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name as string]));
        setSignups((su ?? []).map((s) => ({
          player_id: s.player_id,
          name: nameById.get(s.player_id) ?? "Player",
          position: s.position,
        })));
      }
    }
    load();
  }, [matchId, teamId]);

  const togglePosition = (p: string) =>
    setPositions((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    const { data, error: saveErr } = await supabase.from("ringer_requests").upsert({
      match_id: matchId,
      team_id: teamId,
      posted_by: userId,
      positions,
      spots,
      notes: notes.trim() || null,
      price_pence: RINGER_FEE_PENCE,
      status: "open",
    }, { onConflict: "match_id,team_id" }).select("id, positions, spots, notes, status").maybeSingle();
    if (saveErr || !data) setError(saveErr?.message ?? "Couldn't post the request.");
    else { setRequest(data); setExpanded(false); }
    setBusy(false);
  };

  const handleClose = async () => {
    if (!request) return;
    setBusy(true);
    await supabase.from("ringer_requests").update({ status: "cancelled" }).eq("id", request.id);
    setRequest({ ...request, status: "cancelled" });
    setBusy(false);
  };

  const isLive = request?.status === "open";
  const spotsLeft = request ? Math.max(0, request.spots - signups.length) : 0;

  return (
    <div className="mt-4 bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold">Need a ringer?</p>
        {isLive && (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">
            {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
          </span>
        )}
      </div>
      <p className="text-xs text-text-secondary mb-3">
        Post the positions you&apos;re short and players can buy in for £{(RINGER_FEE_PENCE / 100).toFixed(2)}.
        Ringers join your squad but aren&apos;t part of your team&apos;s payment split.
      </p>

      {signups.length > 0 && (
        <div className="bg-background border border-border rounded-xl p-3 mb-3 space-y-2">
          <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Joined</p>
          {signups.map((s) => (
            <div key={s.player_id} className="flex items-center gap-2">
              <p className="flex-1 text-sm truncate">{s.name}</p>
              <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">Paid</span>
            </div>
          ))}
        </div>
      )}

      {request === undefined ? (
        <div className="py-2 text-center"><div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
      ) : expanded || !request || request.status !== "open" ? (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Positions needed</p>
            <div className="flex flex-wrap gap-1.5">
              {RINGER_POSITIONS.map((p) => (
                <button key={p} type="button" onClick={() => togglePosition(p)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${positions.includes(p) ? "bg-accent text-black border-accent" : "bg-background text-text-secondary border-border"}`}>
                  {p}
                </button>
              ))}
            </div>
            {positions.length === 0 && <p className="text-[10px] text-text-secondary mt-1.5">None selected — the post will say &quot;any position&quot;.</p>}
          </div>

          <div className="flex items-center gap-3">
            <p className="text-xs text-text-secondary flex-1">Players needed</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSpots((s) => Math.max(1, s - 1))}
                className="w-8 h-8 rounded-lg border border-border text-text-secondary font-bold">−</button>
              <span className="w-6 text-center text-sm font-bold">{spots}</span>
              <button type="button" onClick={() => setSpots((s) => Math.min(11, s + 1))}
                className="w-8 h-8 rounded-lg border border-border text-text-secondary font-bold">+</button>
            </div>
          </div>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Anything they should know? (e.g. bring dark shirt)"
            className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm placeholder:text-text-secondary" />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            {request?.status === "open" && (
              <button type="button" onClick={() => setExpanded(false)} disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary disabled:opacity-50">
                Cancel
              </button>
            )}
            <button type="button" onClick={handleSave} disabled={busy || !!error}
              className="flex-[2] py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-50">
              {busy ? "Posting…" : request ? "Update Request" : "Post Ringer Request"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            Live · {request.positions.length === 0 ? "Any position" : request.positions.join(", ")} · {request.spots} needed
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setExpanded(true)}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">Edit</button>
            <button type="button" onClick={handleClose} disabled={busy}
              className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-sm font-semibold text-red-400 disabled:opacity-50">
              {busy ? "…" : "Close Request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
    const currentUser = user;
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

      const { data: captainTeam } = await supabase.from("teams").select("id").eq("captain_id", currentUser.id).maybeSingle();
      let tid = captainTeam?.id ?? null;
      if (!tid) {
        const { data: mem } = await supabase.from("team_members").select("team_id")
          .eq("player_id", currentUser.id).eq("status", "approved").maybeSingle();
        tid = mem?.team_id ?? null;
      }
      setMyTeamId(tid);
      setIsCaptain(!!captainTeam && captainTeam.id === tid);
      setRosterLocked(!!m.roster_locked_at);

      // Booking row backs the replenishment player_payments for this match.
      const { data: bk } = await supabase.from("pitch_bookings").select("id").eq("post_id", m.post_id).maybeSingle();
      setBookingId(bk?.id ?? null);

      // is_ringer arrives with supabase_ringers.sql. Before that migration the
      // column doesn't exist and selecting it fails the whole query, taking the
      // squad list with it — so fall back to the pre-ringer shape.
      type ConfRow = { player_id: string; team_id: string; status: string; is_ringer?: boolean; profiles: { full_name: string } | null };
      const withRinger = await supabase
        .from("match_confirmations")
        .select("player_id, team_id, status, is_ringer, profiles(full_name)")
        .eq("match_id", m.id);
      const confs = (withRinger.data ?? (await supabase
        .from("match_confirmations")
        .select("player_id, team_id, status, profiles(full_name)")
        .eq("match_id", m.id)).data) as ConfRow[] | null;

      const mapped = (confs ?? []).map((c) => ({
        player_id: c.player_id,
        team_id: c.team_id,
        status: c.status,
        full_name: (c.profiles as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
        is_ringer: Boolean((c as { is_ringer?: boolean }).is_ringer),
      }));
      setConfirmations(mapped);
      setMyConfirmStatus(mapped.find((c) => c.player_id === currentUser.id)?.status ?? null);
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
    // slot, minus anyone the captain explicitly excluded from this charge, minus
    // ringers — a guest paid Unitr a flat fee and owes the team nothing.
    const participants = confirmations.filter(
      (c) => c.team_id === myTeamId && effectiveStatus(c.status, timeChanged) === "confirmed"
        && !c.is_ringer && !excluded.has(c.player_id)
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
  // Payers only — a ringer plays but takes no share of the pitch fee.
  const confirmedCount = confirmations.filter(
    (c) => effectiveStatus(c.status, timeChanged) === "confirmed" && !c.is_ringer
  ).length;
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
  // Ringers play but don't pay — the team's pitch fee is split between its own
  // players only, so the per-player share must not count guests.
  const chargedParticipants = myParticipants.filter((c) => !c.is_ringer && !excluded.has(c.player_id));
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

      {/* ── Pre-match starting lineup board ──────────────────────
          Captain assigns confirmed players to positions; everyone else
          sees the captain's picks read-only. Hidden once a result exists
          (the result view below takes over). */}
      {!hasResult && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{myTeamName} · Starting Lineup</p>
            <span className="text-[10px] text-text-secondary">{isCaptain ? "Tap a position to assign" : "Set by captain"}</span>
          </div>

          {isCaptain && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {Object.keys(formations).map((f) => (
                <button key={f} type="button" onClick={() => setFormation(f)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${formation === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {f}
                </button>
              ))}
            </div>
          )}

          <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg,#1a5c1a 0%,#1e6b1e 25%,#1a5c1a 50%,#1e6b1e 75%,#1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
              <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="5" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="107" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
            </svg>
            {players.map((pos, i) => {
              const pid = lineup[i];
              const nm = pid ? (playerNameMap.get(pid) ?? "") : "";
              const initials = nm ? nm.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "";
              const firstName = nm ? nm.split(" ")[0] : "";
              return (
                <button key={i} type="button" disabled={!isCaptain}
                  onClick={() => { if (isCaptain) setPickerSlot(i); }}
                  className="absolute flex flex-col items-center gap-0.5"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg border-2 ${pid ? "bg-white border-white/80" : "bg-black/30 border-dashed border-white/50"}`}>
                    <span className={`text-[10px] font-bold leading-none ${pid ? "text-black" : "text-white/80"}`}>{pid ? initials : pos.position}</span>
                  </div>
                  <span className="text-[9px] font-semibold text-white drop-shadow-md bg-black/40 rounded px-1 truncate max-w-[48px] text-center">{pid ? firstName : pos.position}</span>
                </button>
              );
            })}
          </div>

          {/* Players in the matchday squad + who's starting */}
          <div className="mt-3 bg-surface-2 border border-border rounded-xl p-3">
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Players ({myParticipants.length})</p>
            {myParticipants.length === 0 ? (
              <p className="text-xs text-text-secondary">No players confirmed for this match yet.</p>
            ) : (
              <div className="space-y-2">
                {myParticipants.map((p) => {
                  const inLineup = Object.values(lineup).includes(p.player_id);
                  const init = p.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key={p.player_id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                      </div>
                      <p className="flex-1 text-sm truncate">{p.full_name}</p>
                      {p.is_ringer && (
                        <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">Ringer</span>
                      )}
                      {inLineup
                        ? <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full">Starting</span>
                        : <span className="text-[10px] font-semibold text-text-secondary">Bench</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {isCaptain ? (
            <button type="button" onClick={handleSaveMatchTactics} disabled={savingTactics}
              className="w-full mt-3 py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-50">
              {savingTactics ? "Saving…" : "Save Lineup"}
            </button>
          ) : Object.keys(lineup).length === 0 ? (
            <p className="text-xs text-text-secondary text-center mt-3">The captain hasn&apos;t set the lineup yet.</p>
          ) : null}

          {isCaptain && myTeamId && user && (
            <RingerRequestPanel matchId={params.matchId} teamId={myTeamId} userId={user.id} />
          )}
        </div>
      )}

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

      {/* Lineup player picker (captain) */}
      {pickerSlot !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setPickerSlot(null)}>
          <div className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl p-5 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <p className="font-bold text-base">Assign {players[pickerSlot]?.position}</p>
              <button type="button" onClick={() => setPickerSlot(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto">
              {lineup[pickerSlot] && (
                <button type="button"
                  onClick={() => { setLineup((prev) => { const n = { ...prev }; delete n[pickerSlot]; return n; }); setPickerSlot(null); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-semibold">
                  Clear this position
                </button>
              )}
              {myParticipants.length === 0 && <p className="text-sm text-text-secondary py-2">No confirmed players to assign.</p>}
              {myParticipants.map((p) => {
                const assignedEntry = Object.entries(lineup).find(([, pid]) => pid === p.player_id);
                const here = assignedEntry !== undefined && Number(assignedEntry[0]) === pickerSlot;
                const init = p.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <button key={p.player_id} type="button"
                    onClick={() => {
                      setLineup((prev) => {
                        const n = { ...prev };
                        // One slot per player — drop any prior slot they held.
                        for (const k of Object.keys(n)) if (n[Number(k)] === p.player_id) delete n[Number(k)];
                        n[pickerSlot] = p.player_id;
                        return n;
                      });
                      setPickerSlot(null);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left ${here ? "bg-accent/10 border-accent" : "bg-surface-2 border-border"}`}>
                    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                    </div>
                    <p className="flex-1 text-sm truncate">{p.full_name}</p>
                    {assignedEntry !== undefined && (
                      <span className="text-[10px] text-text-secondary">{here ? "Here" : players[Number(assignedEntry[0])]?.position}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
