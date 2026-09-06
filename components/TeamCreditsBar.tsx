"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DuesTopUpModal, { useMyDues } from "@/components/DuesTopUpModal";
import SettlePaymentsModal from "@/components/SettlePaymentsModal";
import BottomSheet from "@/components/BottomSheet";
import CashOutModal from "@/components/CashOutModal";
import { loadLeadership } from "@/lib/team-leadership";
import { fmtFee, useJoiningFee } from "@/lib/joining-fee";

// The team's money bar: credit balance and transaction log, the player's own
// top-up / settle-up popup, and — for captains — the payment status of every
// match fee they've requested, with per-player reminders.
//
// Rendered under the My Team header and again on the captain's home screen, so
// both surfaces read from one implementation.

type DuePlayer = { player_id: string; name: string; status: string; sharePence: number };
type DueGroup = { matchId: string; bookingId: string | null; opponent: string; date: string; teamPoolPence: number; players: DuePlayer[] };

// Captain's Collect Payment view — grouped by match. Each recent match with
// an outstanding fee lists its charged players + individual pay status, and
// the captain can remind any unpaid player.
type CollectPlayer = { player_id: string; name: string; sharePence: number; remainingPence: number; received: boolean };
// `matchId` holds whichever id the charge targets — a matches row for a game,
// an open_matches row for a tournament entry. `kind` says which, so writes go
// to the right column.
type CollectMatch = { matchId: string; kind: "match" | "tournament"; opponent: string; date: string; players: CollectPlayer[]; totalDuePence: number; paidCount: number };

type CreditTransaction = {
  id: string;
  player_id: string;
  amount_pence: number;
  created_at: string;
  player_name: string;
};

// ── Team Credits Bar ──────────────────────────────────────────
export default function TeamCreditsBar({ userId, role }: { userId: string; role: "captain" | "player" }) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [reserved, setReserved] = useState(0);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showCashOut, setShowCashOut] = useState(false);
  const [logTab, setLogTab] = useState<"deposits" | "bookings" | "reimbursed">("deposits");
  const [depositsExpanded, setDepositsExpanded] = useState(false);
  const [bookingsExpanded, setBookingsExpanded] = useState(false);
  const [reimbursedExpanded, setReimbursedExpanded] = useState(false);
  const [owedByPlayer, setOwedByPlayer] = useState<Record<string, number>>({});
  const [bookingTx, setBookingTx] = useState<{ id: string; label: string; detail: string; amount_pence: number; created_at: string }[]>([]);
  const [reimbursedTx, setReimbursedTx] = useState<{ id: string; label: string; amount_pence: number; created_at: string }[]>([]);
  const [dues, setDues] = useState<DueGroup[]>([]);
  const [duesBusy, setDuesBusy] = useState<Set<string>>(new Set());
  const [showCollect, setShowCollect] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [collectMatches, setCollectMatches] = useState<CollectMatch[]>([]);
  const [selectedCollectMatch, setSelectedCollectMatch] = useState<string | null>(null);
  const [collectLoading, setCollectLoading] = useState(true);
  const [remindingPlayer, setRemindingPlayer] = useState<string | null>(null);
  const [remindedPlayers, setRemindedPlayers] = useState<Set<string>>(new Set());
  const [removingPlayer, setRemovingPlayer] = useState<string | null>(null);
  const [historyAlertCount, setHistoryAlertCount] = useState(0);
  // Dues drive the bar's badge and warning strip; the modal owns paying them.
  const { dues: myDues, owedPence: myOwedPence, reload: reloadMyDues } = useMyDues(teamId, userId);
  // The viewer's own joining fee. A captain owes one too — the fee they set
  // buys the credit that pays for the pitches they play on
  // (supabase_captain_joining_fee.sql) — and until it's in they can't vote
  // available for a game, so it outranks match dues in this bar.
  const { owedPence: feeOwedPence, reload: reloadFee } = useJoiningFee(teamId, userId);

  // Effect 1: resolve team ID
  useEffect(() => {
    async function loadTeam() {
      // One resolver for both roles — a co-captain arrives here with
      // role="captain" and no team of their own to be found by captain_id.
      setTeamId((await loadLeadership(userId))?.teamId ?? null);
    }
    loadTeam();
  }, [userId, role]);

  // Keep the outstanding-payments count fresh for the Collect Payment badge,
  // without requiring the popup to have been opened yet.
  useEffect(() => {
    if (role === "captain" && teamId) loadCollectMatches(teamId);
  }, [role, teamId]);

  // Count past matches still needing attention — no result submitted yet,
  // and/or no "Collect Payment" request sent — for the Match History badge.
  useEffect(() => {
    if (role !== "captain" || !teamId) { setHistoryAlertCount(0); return; }
    async function loadHistoryAlerts() {
      const today = new Date().toISOString().split("T")[0];
      const { data: ms } = await supabase.from("matches")
        .select("id, result_submitted")
        .or(`posting_team_id.eq.${teamId},challenging_team_id.eq.${teamId}`)
        .lt("match_date", today);
      if (!ms || ms.length === 0) { setHistoryAlertCount(0); return; }

      const matchIds = ms.map((m) => m.id);
      const { data: collectionRows } = await supabase.from("payment_collection_status")
        .select("match_id").eq("team_id", teamId).in("match_id", matchIds);
      const requestSentIds = new Set((collectionRows ?? []).map((r) => r.match_id as string));

      const count = ms.filter((m) => !m.result_submitted || !requestSentIds.has(m.id)).length;
      setHistoryAlertCount(count);
    }
    loadHistoryAlerts();
  }, [role, teamId]);

  // Re-pull dues when a captain's new payment request lands, so the badge
  // lights up without the player having to refresh.
  useEffect(() => {
    if (!teamId) return;
    const suffix = Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`my_dues_${userId}_${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_collection_status", filter: `player_id=eq.${userId}` },
        () => reloadMyDues())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [teamId, userId, reloadMyDues]);

  const loadDeposits = useCallback(async () => {
    if (!teamId) return;
    const { data } = await supabase
      .from("team_credit_transactions")
      .select("id, player_id, amount_pence, created_at")
      .eq("team_id", teamId)
      .eq("type", "deposit")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!data || data.length === 0) { setTransactions([]); return; }
    // Separate profiles lookup — avoids FK traversal issue with auth.users ref
    const pids = [...new Set(data.map((t) => t.player_id).filter(Boolean))];
    const { data: profs } = pids.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", pids)
      : { data: [] as { id: string; full_name: string }[] };
    const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name as string]));
    setTransactions(
      data.map((t) => ({
        id: t.id,
        player_id: t.player_id,
        amount_pence: t.amount_pence,
        created_at: t.created_at,
        player_name: nameById.get(t.player_id) ?? "Unknown",
      }))
    );
  }, [teamId]);

  // Effect 2: load balance + transactions, subscribe to both
  useEffect(() => {
    if (!teamId) return;

    // Load initial balance + reserved earmark
    supabase.from("team_credits").select("balance_pence, reserved_pence").eq("team_id", teamId).maybeSingle()
      .then(({ data }) => {
        setCredits((data?.balance_pence ?? 0) / 100);
        setReserved((data?.reserved_pence ?? 0) / 100);
      });

    loadDeposits();

    const suffix = Math.random().toString(36).slice(2);

    // Realtime: balance + reserved updates
    const balanceChannel = supabase
      .channel(`team_credits_${teamId}_${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_credits", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const row = payload.new as { balance_pence: number; reserved_pence: number } | null;
          if (row) { setCredits(row.balance_pence / 100); setReserved((row.reserved_pence ?? 0) / 100); }
        })
      .subscribe();

    // Realtime: new deposits
    const txChannel = supabase
      .channel(`team_credit_tx_${teamId}_${suffix}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_credit_transactions", filter: `team_id=eq.${teamId}` },
        async (payload) => {
          const row = payload.new as { id: string; player_id: string; amount_pence: number; created_at: string; type: string };
          if (row.type !== "deposit") return;
          const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", row.player_id).maybeSingle();
          setTransactions((prev) => [{
            id: row.id,
            player_id: row.player_id,
            amount_pence: row.amount_pence,
            created_at: row.created_at,
            player_name: (profile as { full_name: string } | null)?.full_name ?? "Unknown",
          }, ...prev].slice(0, 20));
        })
      .subscribe();

    return () => {
      supabase.removeChannel(balanceChannel);
      supabase.removeChannel(txChannel);
    };
  }, [teamId, loadDeposits]);



  // Per-match dues: for every match this team played, the share each
  // participant owes toward the team's half of the pitch, plus whether it's
  // been paid (auto-charged at settlement, or a manual top-up here).
  const loadDues = async (tid: string) => {
    const { data: ms } = await supabase.from("matches")
      .select("id, post_id, posting_team_id, challenging_team_id, confirmed_pitch, match_date")
      .or(`posting_team_id.eq.${tid},challenging_team_id.eq.${tid}`)
      .order("match_date", { ascending: false }).limit(20);
    if (!ms || ms.length === 0) { setDues([]); return; }

    const matchIds = ms.map((m) => m.id);
    const postIds = ms.map((m) => m.post_id).filter(Boolean);
    const oppIds = [...new Set(ms.map((m) => (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id)))];

    const [{ data: teamsData }, { data: bks }, { data: confs }] = await Promise.all([
      supabase.from("teams").select("id, name").in("id", oppIds),
      supabase.from("pitch_bookings").select("id, post_id").in("post_id", postIds),
      supabase.from("match_confirmations")
        .select("match_id, player_id, status, profiles(full_name)")
        .in("match_id", matchIds).eq("team_id", tid),
    ]);
    const teamName = new Map((teamsData ?? []).map((t) => [t.id, t.name as string]));
    const bookingByPost = new Map((bks ?? []).map((b) => [b.post_id, b.id as string]));
    const bookingIds = (bks ?? []).map((b) => b.id);

    const { data: pays } = bookingIds.length
      ? await supabase.from("player_payments")
          .select("booking_id, player_id, status")
          .in("booking_id", bookingIds).eq("team_id", tid).eq("purpose", "replenish")
      : { data: [] as { booking_id: string; player_id: string; status: string }[] };
    const payByKey = new Map((pays ?? []).map((p) => [`${p.booking_id}:${p.player_id}`, p.status]));

    const groups: DueGroup[] = ms.map((m) => {
      const oppId = m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id;
      const bookingId = bookingByPost.get(m.post_id) ?? null;
      const isPoster = m.posting_team_id === tid;
      const feePence = Math.round(((m.confirmed_pitch as { price?: number } | null)?.price ?? 0) * 100);
      const half = Math.floor(feePence / 2);
      const teamPool = isPoster ? feePence - half : half;
      const participants = (confs ?? []).filter((c) => c.match_id === m.id && c.status === "confirmed");
      const sharePence = participants.length ? Math.round(teamPool / participants.length) : 0;
      const players: DuePlayer[] = participants.map((c) => ({
        player_id: c.player_id,
        name: (c.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player",
        status: (bookingId && payByKey.get(`${bookingId}:${c.player_id}`)) || "unpaid",
        sharePence,
      }));
      return { matchId: m.id, bookingId, opponent: teamName.get(oppId) ?? "Opponent", date: m.match_date, teamPoolPence: teamPool, players };
    }).filter((g) => g.players.length > 0);
    setDues(groups);
  };

  // Issue an individual top-up: credit the player's share back to the team and
  // mark their due paid (used when a player settles in cash / outside auto-charge).
  //
  // There's no Stripe payment behind this one, so it can't go through the
  // webhook — record_cash_credit is the deliberate manual path, and it checks
  // server-side that the caller actually captains this team.
  const markDuePaid = async (group: DueGroup, player: DuePlayer) => {
    if (!teamId || player.status === "paid") return;
    const key = `${group.matchId}:${player.player_id}`;
    setDuesBusy((prev) => new Set(prev).add(key));
    const { error: creditErr } = await supabase.rpc("record_cash_credit", {
      p_team_id: teamId, p_amount_pence: player.sharePence, p_player_id: player.player_id,
    });
    if (creditErr) {
      console.error("markDuePaid: could not record cash payment:", creditErr.message);
      setDuesBusy((prev) => { const n = new Set(prev); n.delete(key); return n; });
      return;
    }
    if (group.bookingId) {
      await supabase.from("player_payments").upsert({
        booking_id: group.bookingId,
        player_id: player.player_id,
        team_id: teamId,
        amount_pence: player.sharePence,
        unitr_fee_pence: 0,
        total_pence: player.sharePence,
        purpose: "replenish",
        status: "paid",
        applied: true,
        paid_at: new Date().toISOString(),
      }, { onConflict: "booking_id,player_id" });
    }
    setDues((prev) => prev.map((g) => g.matchId === group.matchId
      ? { ...g, players: g.players.map((p) => p.player_id === player.player_id ? { ...p, status: "paid" } : p) }
      : g));
    setDuesBusy((prev) => { const next = new Set(prev); next.delete(key); return next; });
  };

  // Group the captain's collection requests by MATCH: each recent match with an
  // outstanding fee, its charged players, and each player's pay status. Matches
  // with everyone paid are dropped from the list.
  const loadCollectMatches = async (tid: string) => {
    setCollectLoading(true);
    // Note: payment_collection_status.player_id has no FK relationship
    // registered with profiles in the Supabase schema cache, so embedding it
    // in the select makes the entire query fail (PGRST200). Fetch names separately.
    const { data: rows } = await supabase
      .from("payment_collection_status")
      .select("match_id, open_match_id, player_id, share_pence, credited_pence, received")
      .eq("team_id", tid).eq("included", true);

    if (!rows || rows.length === 0) { setCollectMatches([]); setCollectLoading(false); return; }

    // A row targets a match OR a tournament entry; group by whichever it is.
    const targetIdOf = (r: { match_id: string | null; open_match_id: string | null }) =>
      (r.open_match_id ?? r.match_id) as string;

    const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))] as string[];
    const omIds = [...new Set(rows.map((r) => r.open_match_id).filter(Boolean))] as string[];
    const playerIds = [...new Set(rows.map((r) => r.player_id))];
    const [{ data: ms }, { data: oms }, { data: profilesData }] = await Promise.all([
      matchIds.length
        ? supabase.from("matches").select("id, posting_team_id, challenging_team_id, match_date").in("id", matchIds)
        : Promise.resolve({ data: [] as { id: string; posting_team_id: string; challenging_team_id: string; match_date: string }[] }),
      omIds.length
        ? supabase.from("open_matches").select("id, title, match_date").in("id", omIds)
        : Promise.resolve({ data: [] as { id: string; title: string; match_date: string }[] }),
      supabase.from("profiles").select("id, full_name").in("id", playerIds),
    ]);
    const oppIds = [...new Set((ms ?? []).map((m) => (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id)))];
    const { data: teamsData } = oppIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppIds)
      : { data: [] as { id: string; name: string }[] };
    const teamName = new Map((teamsData ?? []).map((t) => [t.id, t.name as string]));
    const matchById = new Map((ms ?? []).map((m) => [m.id, m]));
    const omById = new Map((oms ?? []).map((o) => [o.id, o]));
    const profileName = new Map((profilesData ?? []).map((p) => [p.id, p.full_name as string]));

    const byMatch = new Map<string, CollectMatch>();
    for (const r of rows) {
      const targetId = targetIdOf(r);
      if (!targetId) continue;
      const isTournament = Boolean(r.open_match_id);
      const remainingPence = Math.max(0, r.share_pence - (r.credited_pence ?? 0));
      const paid = r.received || remainingPence === 0;
      const m = r.match_id ? matchById.get(r.match_id) : undefined;
      const t = r.open_match_id ? omById.get(r.open_match_id) : undefined;
      const oppId = m ? (m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id) : null;
      const label = isTournament
        ? (t?.title || "Tournament")
        : (oppId ? (teamName.get(oppId) ?? "Opponent") : "Opponent");
      const player: CollectPlayer = {
        player_id: r.player_id,
        name: profileName.get(r.player_id) ?? "Player",
        sharePence: r.share_pence,
        remainingPence,
        received: paid,
      };
      const existing = byMatch.get(targetId);
      if (existing) {
        existing.players.push(player);
        existing.totalDuePence += remainingPence;
        if (paid) existing.paidCount += 1;
      } else {
        byMatch.set(targetId, {
          matchId: targetId,
          kind: isTournament ? "tournament" : "match",
          opponent: label,
          date: (isTournament ? t?.match_date : m?.match_date) ?? "",
          players: [player],
          totalDuePence: remainingPence,
          paidCount: paid ? 1 : 0,
        });
      }
    }
    const groups = Array.from(byMatch.values())
      .filter((g) => g.totalDuePence > 0)                       // only matches still owed
      .map((g) => ({ ...g, players: g.players.sort((a, b) => Number(a.received) - Number(b.received)) }))
      .sort((a, b) => b.date.localeCompare(a.date));             // most recent first
    setCollectMatches(groups);
    setCollectLoading(false);
  };

  // Remind one player about one match's fee via a direct message.
  const remindPlayer = async (match: CollectMatch, player: CollectPlayer) => {
    const key = `${match.matchId}:${player.player_id}`;
    setRemindingPlayer(key);
    const targetCol = match.kind === "tournament" ? "open_match_id" : "match_id";
    const what = match.kind === "tournament" ? `entering ${match.opponent}` : `the match vs ${match.opponent}`;
    await supabase.from("messages").insert({
      sender_id: userId,
      receiver_id: player.player_id,
      type: "payment_reminder",
      [targetCol]: match.matchId,
      body: `Reminder: you owe £${(player.remainingPence / 100).toFixed(2)} for ${what} (${match.date}). Please pay from the Top Up tab.`,
    });
    setRemindingPlayer(null);
    setRemindedPlayers((prev) => new Set(prev).add(key));
  };

  // Drop a player from a match's payment request — e.g. they were added by
  // mistake. Deletes their payment_collection_status row entirely, so they no
  // longer owe anything for this match and won't be reminded.
  const removePlayerFromCollection = async (match: CollectMatch, player: CollectPlayer) => {
    const key = `${match.matchId}:${player.player_id}`;
    setRemovingPlayer(key);
    await supabase.from("payment_collection_status")
      .delete()
      .eq(match.kind === "tournament" ? "open_match_id" : "match_id", match.matchId)
      .eq("player_id", player.player_id);
    setCollectMatches((prev) => prev
      .map((g) => g.matchId !== match.matchId ? g : {
        ...g,
        players: g.players.filter((p) => p.player_id !== player.player_id),
        totalDuePence: g.totalDuePence - player.remainingPence,
      })
      .filter((g) => g.players.length > 0));
    setRemovingPlayer(null);
  };

  const openLog = async (startTab: "deposits" | "bookings" | "reimbursed" = "deposits") => {
    setLogTab(startTab);
    setShowLog(true);
    if (!teamId) return;
    // Always reload deposits so the popup is fresh on every open
    loadDeposits();
    loadDues(teamId);
    // Load per-player outstanding balances from payment_collection_status
    const { data: pcs } = await supabase
      .from("payment_collection_status")
      .select("player_id, share_pence, credited_pence")
      .eq("team_id", teamId)
      .eq("included", true)
      .eq("received", false);
    const owedMap: Record<string, number> = {};
    (pcs ?? []).forEach((r) => {
      const remaining = (r.share_pence ?? 0) - (r.credited_pence ?? 0);
      if (remaining > 0) owedMap[r.player_id] = (owedMap[r.player_id] ?? 0) + remaining;
    });
    setOwedByPlayer(owedMap);
    // Load outgoing credit transactions (pitch bookings, match captures, etc.)
    // and resolve each to what it actually paid for — a direct pitch booking,
    // a tournament buy-in, or a matched game against a specific opponent —
    // instead of a generic "Pitch booking" label.
    const { data: outgoing } = await supabase
      .from("team_credit_transactions")
      .select("id, amount_pence, created_at, type, match_id, related_team_id, booking_id, open_match_id")
      .eq("team_id", teamId)
      .lt("amount_pence", 0)
      .order("created_at", { ascending: false });
    const rows = outgoing ?? [];

    const oppTeamIds = [...new Set(rows.map((r) => r.related_team_id).filter(Boolean))];
    const bookingIds = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))];
    const openMatchIds = [...new Set(rows.map((r) => r.open_match_id).filter(Boolean))];

    const { data: bookingOppTeams } = oppTeamIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppTeamIds)
      : { data: [] as { id: string; name: string }[] };
    const { data: bookings } = bookingIds.length
      ? await supabase.from("pitch_bookings").select("id, pitch_id, match_date, start_time").in("id", bookingIds)
      : { data: [] as { id: string; pitch_id: string; match_date: string; start_time: string }[] };
    const { data: tournaments } = openMatchIds.length
      ? await supabase.from("open_matches").select("id, title, pitch_name").in("id", openMatchIds)
      : { data: [] as { id: string; title: string; pitch_name: string }[] };
    const bookingOppName = new Map((bookingOppTeams ?? []).map((t) => [t.id, t.name as string]));
    const pitchIds = [...new Set((bookings ?? []).map((b) => b.pitch_id).filter(Boolean))];
    const { data: pitches } = pitchIds.length
      ? await supabase.from("pitches").select("id, name").in("id", pitchIds)
      : { data: [] as { id: string; name: string }[] };
    const pitchName = new Map((pitches ?? []).map((p) => [p.id, p.name as string]));
    const bookingById = new Map((bookings ?? []).map((b) => [b.id, b]));
    const tournamentById = new Map((tournaments ?? []).map((t) => [t.id, t]));

    setBookingTx(rows.map((t) => {
      if (t.open_match_id && tournamentById.has(t.open_match_id)) {
        const tour = tournamentById.get(t.open_match_id)!;
        return { id: t.id, label: `Tournament entry — ${tour.title}`, detail: tour.pitch_name, amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
      }
      if (t.booking_id && bookingById.has(t.booking_id)) {
        const b = bookingById.get(t.booking_id)!;
        return { id: t.id, label: "Pitch booking", detail: `${pitchName.get(b.pitch_id) ?? "Pitch"} · ${b.match_date}`, amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
      }
      if (t.match_id) {
        const opponent = t.related_team_id ? (bookingOppName.get(t.related_team_id) ?? "Opponent") : "Opponent";
        return { id: t.id, label: "Pitch booking — matched game", detail: `vs ${opponent}`, amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
      }
      return { id: t.id, label: t.type === "booking_capture" ? "Pitch booking" : "Match payment", detail: "", amount_pence: Math.abs(t.amount_pence), created_at: t.created_at };
    }));
    // Money that came back into the pot rather than being paid into it. Two
    // things do that: an opponent settling their half of a secured post
    // (reimburse_secured_pitch → 'opponent_settlement'), and an event Unitr
    // cancelled handing the buy-in back (refund_event_buyin → 'buyin_refund').
    // Without the second, the balance would just go up with nothing in the log
    // to explain it.
    const { data: reimbursed } = await supabase
      .from("team_credit_transactions")
      .select("id, amount_pence, created_at, related_team_id, type, open_match_id")
      .eq("team_id", teamId)
      .in("type", ["opponent_settlement", "buyin_refund"])
      .gt("amount_pence", 0)
      .order("created_at", { ascending: false });
    const refundEventIds = [...new Set((reimbursed ?? []).map((t) => t.open_match_id).filter(Boolean))];
    const { data: refundEvents } = refundEventIds.length
      ? await supabase.from("open_matches").select("id, title").in("id", refundEventIds)
      : { data: [] as { id: string; title: string }[] };
    const refundEventTitle = new Map((refundEvents ?? []).map((e) => [e.id, e.title as string]));
    const oppIds = [...new Set((reimbursed ?? []).map((t) => t.related_team_id).filter(Boolean))];
    const { data: oppTeams } = oppIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppIds)
      : { data: [] as { id: string; name: string }[] };
    const oppName = new Map((oppTeams ?? []).map((t) => [t.id, t.name as string]));
    setReimbursedTx((reimbursed ?? []).map((t) => ({
      id: t.id,
      label: t.type === "buyin_refund"
        ? `Buy-in refunded — ${(t.open_match_id && refundEventTitle.get(t.open_match_id)) || "cancelled event"}`
        : `Reimbursed by ${t.related_team_id ? (oppName.get(t.related_team_id) ?? "Opponent") : "Opponent"}`,
      amount_pence: t.amount_pence,
      created_at: t.created_at,
    })));
  };


  if (credits === null) return null;

  return (
    <>
      {/* The rebrand makes this a wrapping row of equal-weight pills rather than
          three buttons plus a right-aligned text link. Counts sit *inside* the
          pill as a red chip — as absolute corner badges they were clipped once
          the row was allowed to wrap. */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button onClick={() => openLog("deposits")}
          className="flex items-center gap-1.5 bg-surface border border-border rounded-full px-3.5 py-2.5 hover:border-accent transition-colors whitespace-nowrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
          </svg>
          <span className="text-[13px] font-bold text-text-primary">£{credits.toFixed(2)}</span>
          <span className="text-xs font-medium text-text-secondary">team credits</span>
          <span className="text-text-secondary text-xs">›</span>
        </button>
        <button onClick={() => setShowTopUp(true)}
          className={`flex items-center gap-1.5 text-[13px] font-bold px-3.5 py-2.5 rounded-full border whitespace-nowrap ${myOwedPence + feeOwedPence > 0 ? "text-white bg-danger border-danger" : "text-white bg-accent border-accent"}`}>
          + Top Up
          {myDues.length > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-white text-danger text-[10px] font-bold flex items-center justify-center">
              {myDues.length}
            </span>
          )}
        </button>
        {/* Payment Status and Settle Payments are one pair, so for the captain
            they get their own full-width sub-row and split it evenly — left to
            the outer wrap they were too wide to share a line and the second
            always dropped below the first. A player sees only Settle Payments,
            which keeps its natural width in the main row. */}
        <div className={`flex items-center gap-2 ${role === "captain" ? "w-full" : ""}`}>
          {role === "captain" && (
            <button onClick={() => { setRemindedPlayers(new Set()); setSelectedCollectMatch(null); setShowCollect(true); if (teamId) loadCollectMatches(teamId); }}
              className="flex-1 flex items-center justify-center gap-1.5 text-[13px] font-bold text-text-primary border border-border bg-surface px-3.5 py-2.5 rounded-full whitespace-nowrap">
              Payment Status
              {collectMatches.length > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
                  {collectMatches.length}
                </span>
              )}
            </button>
          )}
          {/* Opens in place rather than navigating: its neighbours in this row are
              all popups, and sending the captain to a full page for the same kind
              of quick check lost them their position on Home. */}
          <button onClick={() => setShowSettle(true)}
            className={`flex items-center justify-center gap-1.5 text-[13px] font-bold text-text-primary border border-border bg-surface px-3.5 py-2.5 rounded-full whitespace-nowrap ${role === "captain" ? "flex-1" : ""}`}>
            Settle Payments
            {historyAlertCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
                {historyAlertCount}
              </span>
            )}
          </button>
        </div>
      </div>
      {reserved > 0 && (
        <p className="text-[11px] text-text-secondary mt-1">
          £{reserved.toFixed(2)} reserved for a pending match · £{(credits - reserved).toFixed(2)} available
        </p>
      )}
      {feeOwedPence > 0 && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 mt-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <p className="text-[11px] text-red-600">
            <span className="font-semibold">{fmtFee(feeOwedPence)} joining fee due.</span>{" "}
            {role === "captain"
              ? "The fee you set applies to you too — top up that much to put it into the team's credit."
              : "Top up that much to pay it into the team's credit."}{" "}
            Until it&apos;s paid you can&apos;t vote available for games.
          </p>
        </div>
      )}
      {myOwedPence > 0 && (
        <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 mt-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <p className="text-[11px] text-yellow-600">
            Your previous matches haven&apos;t been paid off. Top up your required amount above.
          </p>
        </div>
      )}

      {/* Transaction log modal — captain only */}
      {showLog && (
        <BottomSheet title="Team Credits" subtitle={`Balance: £${credits.toFixed(2)}`} onClose={() => setShowLog(false)}>
          <>
            {/* Tabs */}
            <div className="flex bg-surface border border-border rounded-btn p-[3px] gap-[3px] flex-shrink-0">
              {(["deposits", "bookings", "reimbursed"] as const).map((t) => (
                <button key={t} onClick={() => setLogTab(t)}
                  className={`flex-1 py-2 rounded-[9px] text-xs capitalize transition-colors ${logTab === t ? "bg-accent text-white font-bold" : "text-text-secondary font-semibold"}`}>
                  {t}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1">
              {logTab === "deposits" && (() => {
                const playerMap = new Map<string, { player_id: string; player_name: string; totalDeposited: number }>();
                transactions.forEach((tx) => {
                  const existing = playerMap.get(tx.player_id);
                  if (existing) { existing.totalDeposited += tx.amount_pence; }
                  else { playerMap.set(tx.player_id, { player_id: tx.player_id, player_name: tx.player_name, totalDeposited: tx.amount_pence }); }
                });
                const sorted = [...playerMap.values()].sort((a, b) => b.totalDeposited - a.totalDeposited);
                const displayed = depositsExpanded ? sorted : sorted.slice(0, 5);
                if (sorted.length === 0) return <p className="text-[11px] text-text-secondary text-center py-8">No deposits yet.</p>;
                return (
                  <div className="space-y-1.5">
                    {displayed.map((p) => {
                      const owed = owedByPlayer[p.player_id] ?? 0;
                      const initials = p.player_name.split(" ").filter(Boolean).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <div key={p.player_id} className="flex items-center gap-2.5 bg-panel border border-border rounded-btn px-3 py-2.5">
                          <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-accent-ink">{initials}</span>
                          </div>
                          <p className="flex-1 min-w-0 text-xs font-medium truncate">{p.player_id === userId ? "You" : p.player_name}</p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="text-xs font-bold text-green-600">+£{(p.totalDeposited / 100).toFixed(2)}</span>
                            {owed > 0 && <span className="text-xs font-semibold text-red-600">(£{(owed / 100).toFixed(2)})</span>}
                          </div>
                        </div>
                      );
                    })}
                    {sorted.length > 5 && (
                      <div className="flex justify-end pt-1">
                        <button onClick={() => setDepositsExpanded(!depositsExpanded)}
                          className="text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
                          {depositsExpanded ? "Show less" : "View More"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {logTab === "bookings" && (() => {
                const displayed = bookingsExpanded ? bookingTx : bookingTx.slice(0, 5);
                if (bookingTx.length === 0) return <p className="text-[11px] text-text-secondary text-center py-8">No booking payments yet.</p>;
                return (
                  <div className="space-y-1.5">
                    {displayed.map((p) => {
                      const initials = p.label.split(" ").filter(Boolean).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                      const diffMins = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000);
                      const timeAgo = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins}m ago` : diffMins < 1440 ? `${Math.floor(diffMins / 60)}h ago` : `${Math.floor(diffMins / 1440)}d ago`;
                      return (
                        <div key={p.id} className="flex items-center gap-2.5 bg-panel border border-border rounded-btn px-3 py-2.5">
                          <div className="w-7 h-7 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-text-secondary">{initials}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{p.label}</p>
                            <p className="text-[10px] text-text-secondary truncate">{p.detail ? `${p.detail} · ` : ""}{timeAgo}</p>
                          </div>
                          <span className="text-xs font-bold text-red-600 flex-shrink-0">-£{(p.amount_pence / 100).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    {bookingTx.length > 5 && (
                      <div className="flex justify-end pt-1">
                        <button onClick={() => setBookingsExpanded(!bookingsExpanded)}
                          className="text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
                          {bookingsExpanded ? "Show less" : "View More"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {logTab === "reimbursed" && (() => {
                const displayed = reimbursedExpanded ? reimbursedTx : reimbursedTx.slice(0, 5);
                if (reimbursedTx.length === 0) return <p className="text-[11px] text-text-secondary text-center py-8">No reimbursements yet.</p>;
                return (
                  <div className="space-y-1.5">
                    {displayed.map((p) => {
                      const diffMins = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000);
                      const timeAgo = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins}m ago` : diffMins < 1440 ? `${Math.floor(diffMins / 60)}h ago` : `${Math.floor(diffMins / 1440)}d ago`;
                      return (
                        <div key={p.id} className="flex items-center gap-2.5 bg-panel border border-border rounded-btn px-3 py-2.5">
                          <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{p.label}</p>
                            <p className="text-[10px] text-text-secondary">{timeAgo}</p>
                          </div>
                          <span className="text-xs font-bold text-green-600">+£{(p.amount_pence / 100).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    {reimbursedTx.length > 5 && (
                      <div className="flex justify-end pt-1">
                        <button onClick={() => setReimbursedExpanded(!reimbursedExpanded)}
                          className="text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
                          {reimbursedExpanded ? "Show less" : "View More"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Money back out. Sits under the log rather than in the action
                row on Home: refunding is rare and deliberate, and a captain
                should have to open the ledger and look at it first. */}
            {role === "captain" && credits > 0 && (
              <div className="pt-2 border-t border-border flex-shrink-0">
                <button onClick={() => { setShowLog(false); setShowCashOut(true); }}
                  className="w-full py-2.5 rounded-xl border border-border text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
                  Refund leftover credit to players&rsquo; cards
                </button>
              </div>
            )}
          </>
        </BottomSheet>
      )}

      {showCashOut && teamId && (
        <CashOutModal
          teamId={teamId}
          onClose={() => setShowCashOut(false)}
          onDone={(balancePence) => setCredits(balancePence / 100)}
        />
      )}

      {/* Collect Payment modal — captain only. Drill-down: recent matches with
          payments due → a match's players + pay status → remind unpaid players. */}
      {showCollect && (() => {
        const selected = selectedCollectMatch ? collectMatches.find((m) => m.matchId === selectedCollectMatch) ?? null : null;
        return (
        <BottomSheet
          title={selected ? (selected.kind === "tournament" ? selected.opponent : `vs ${selected.opponent}`) : "Collect Payment"}
          subtitle={selected ? `${selected.date} · tap Remind to notify a player` : "Recent matches with payments due"}
          onClose={() => setShowCollect(false)}
        >
          <>
            {/* Drill-down back link. The sheet header owns the title, so going
                up a level is its own control rather than a chevron beside it. */}
            {selected && (
              <button onClick={() => setSelectedCollectMatch(null)}
                className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary self-start">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                All matches
              </button>
            )}

            <div className="space-y-2">
              {collectLoading ? (
                <div className="py-8 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
              ) : selected ? (
                /* ── Players in the selected match ── */
                selected.players.map((p) => {
                  const key = `${selected.matchId}:${p.player_id}`;
                  const busy = remindingPlayer === key;
                  const removing = removingPlayer === key;
                  const reminded = remindedPlayers.has(key);
                  return (
                    <div key={p.player_id} className="flex items-center gap-2 bg-panel border border-border rounded-btn px-3.5 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{p.player_id === userId ? "You" : p.name}</p>
                        <p className="text-[10px] text-text-secondary">£{(p.sharePence / 100).toFixed(2)} share</p>
                      </div>
                      {p.received ? (
                        <span className="text-[11px] font-bold bg-success-bg text-accent-ink px-3 py-1 rounded-full flex-shrink-0">Paid</span>
                      ) : (
                        <>
                          <button onClick={() => remindPlayer(selected, p)} disabled={busy || reminded || removing}
                            className="text-[11px] font-bold bg-[#FDECEC] text-danger px-3 py-1 rounded-full flex-shrink-0 disabled:opacity-60">
                            {busy ? "Sending…" : reminded ? "Reminded ✓" : "Remind"}
                          </button>
                          <button onClick={() => removePlayerFromCollection(selected, p)} disabled={removing || busy}
                            title="Remove from payment request — added by mistake"
                            className="text-text-secondary hover:text-red-600 flex-shrink-0 disabled:opacity-50">
                            {removing
                              ? <div className="w-3.5 h-3.5 rounded-full border-2 border-text-secondary border-t-transparent animate-spin" />
                              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })
              ) : collectMatches.length === 0 ? (
                <p className="text-xs text-text-secondary text-center py-8">Everyone&apos;s paid up — no missing payments.</p>
              ) : (
                /* ── Recent matches with payments due ── */
                collectMatches.map((g) => {
                  const unpaid = g.players.length - g.paidCount;
                  return (
                    <button key={g.matchId} onClick={() => { setSelectedCollectMatch(g.matchId); }}
                      className="w-full bg-panel border border-border rounded-[14px] p-3.5 text-left">
                      <div className="flex items-center gap-2">
                        <p className="flex-1 min-w-0 text-sm font-semibold truncate">{g.kind === "tournament" ? g.opponent : `vs ${g.opponent}`}</p>
                        <span className="text-sm font-bold text-red-600 flex-shrink-0">£{(g.totalDuePence / 100).toFixed(2)}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                      <p className="text-[10px] text-text-secondary mt-1">
                        {g.date} · {unpaid} player{unpaid !== 1 ? "s" : ""} still to pay · {g.paidCount}/{g.players.length} paid
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </>
        </BottomSheet>
        );
      })()}

      {showTopUp && teamId && (
        <DuesTopUpModal
          teamId={teamId}
          userId={userId}
          onBalanceChange={(pence) => setCredits(pence / 100)}
          onClose={() => { setShowTopUp(false); reloadMyDues(); reloadFee(); }}
        />
      )}

      {showSettle && <SettlePaymentsModal onClose={() => setShowSettle(false)} />}
    </>
  );
}
