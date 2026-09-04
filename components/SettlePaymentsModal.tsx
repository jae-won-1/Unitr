"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { isUpcomingDate, toDateKey } from "@/lib/match-dates";
import { fmtFee } from "@/lib/joining-fee";
import BottomSheet from "@/components/BottomSheet";

// Settle Payments — per-fixture payment collection for the captain.
//
// Lives here rather than on its page because it's opened two ways: as the
// `/my-team/history` route, and as a popup from the money row in
// TeamCreditsBar. The money row's other controls (team credits, Top Up,
// Payment Status) are all popups, so sending this one to a full page lost the
// captain their place on Home for what is the same kind of quick check.

// A history row is either a matched game (match_posts → matches) or a
// tournament this team entered (open_matches → open_match_teams). They settle
// the same way but hang off different tables, so `target` carries the identity
// and everything downstream keys off it rather than off a match id.
type CollectTarget =
  | { kind: "match"; matchId: string }
  | { kind: "tournament"; openMatchId: string };

type HistoryFixture = {
  key: string;                  // stable React key + settle-state key
  kind: "match" | "tournament";
  postId: string | null;        // matches only
  matchRowId: string | null;    // matches only
  openMatchId: string | null;   // tournaments only
  label: string;                // opponent name, or tournament title
  teamPoolPence: number;        // what THIS team owes in total
  settled: boolean;
  date: string;
  time: string;
  pitch: string;
  isUpcoming: boolean;
};

type MatchRow = {
  id: string;
  posting_team_id: string;
  challenging_team_id: string;
  confirmed_pitch: { price?: number } | null;
  fees_settled: boolean;
  result_submitted: boolean;
  result_verified: boolean;
};

type RosterPlayer = { player_id: string; name: string };
type CollectRow = { player_id: string; share_pence: number; received: boolean };

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// Availability date_options store a human string like "Tue, 30 JUN 2026".
// Parse it to an ISO date so we can match a poll option to a match_date.
function parseOptionDate(dateStr: string): string | null {
  const m = /(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/.exec((dateStr ?? "").toUpperCase());
  if (!m) return null;
  const [, day, mon, year] = m;
  const mm = MONTHS[mon];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

// ── Tournaments this team entered, as settleable history rows ─────────────
// The amount owed is what the team ACTUALLY paid, read off the credit debit
// written when they joined (tournaments/join/route.ts) — that already has any
// invite discount applied. price_per_team_pence is the list price and only
// serves as a fallback when no debit row exists (e.g. a free entry).
async function loadTournamentEntries(teamId: string): Promise<HistoryFixture[]> {
  const { data: entries } = await supabase.from("open_match_teams")
    .select("open_match_id, fees_settled").eq("team_id", teamId);
  const ids = (entries ?? []).map((e) => e.open_match_id).filter(Boolean) as string[];
  if (ids.length === 0) return [];

  const { data: oms } = await supabase.from("open_matches")
    .select("id, title, match_date, start_time, pitch_name, price_per_team_pence, status, booking_id, organiser_team_id")
    .in("id", ids).eq("match_type", "tournament").neq("status", "cancelled");

  // Two debit shapes, because the two ways to be in a tournament cost
  // different amounts: a team that JOINED paid the buy-in (recorded against
  // open_match_id by tournaments/join), while the team that HOSTED paid the
  // whole pitch block up front via /api/book/pay-credit (recorded against the
  // reservation's booking_id). Look up both.
  const bookingIds = (oms ?? []).map((t) => t.booking_id).filter(Boolean) as string[];
  const [{ data: buyIns }, { data: hostPayments }] = await Promise.all([
    supabase.from("team_credit_transactions")
      .select("open_match_id, amount_pence").eq("team_id", teamId).in("open_match_id", ids),
    bookingIds.length
      ? supabase.from("team_credit_transactions")
          .select("booking_id, amount_pence").eq("team_id", teamId).in("booking_id", bookingIds)
      : Promise.resolve({ data: [] as { booking_id: string; amount_pence: number }[] }),
  ]);

  const paidByOm = new Map<string, number>();
  for (const d of buyIns ?? []) {
    if (d.amount_pence >= 0) continue;   // credits/reimbursements, not a payment out
    paidByOm.set(d.open_match_id, (paidByOm.get(d.open_match_id) ?? 0) + Math.abs(d.amount_pence));
  }
  const paidByBooking = new Map<string, number>();
  for (const d of hostPayments ?? []) {
    if (d.amount_pence >= 0) continue;
    paidByBooking.set(d.booking_id, (paidByBooking.get(d.booking_id) ?? 0) + Math.abs(d.amount_pence));
  }
  const settledByOm = new Map((entries ?? []).map((e) => [e.open_match_id, Boolean(e.fees_settled)]));

  return (oms ?? []).map((t) => ({
    key: `tournament:${t.id}`,
    kind: "tournament" as const,
    postId: null,
    matchRowId: null,
    openMatchId: t.id,
    label: t.title || "Tournament",
    teamPoolPence: paidByOm.get(t.id)
      ?? (t.organiser_team_id === teamId && t.booking_id ? paidByBooking.get(t.booking_id) : undefined)
      ?? Math.round(t.price_per_team_pence ?? 0),
    settled: settledByOm.get(t.id) ?? false,
    date: toDateKey(t.match_date),
    time: t.start_time ?? "",
    pitch: t.pitch_name ?? "TBC",
    isUpcoming: isUpcomingDate(t.match_date),
  })).filter((t) => t.date !== "");
}

// ── Captain's per-fixture payment collection panel ────────────────────────
// Works for a matched game or a tournament entry: `target` decides which
// column the payment_collection_status rows key off and where the "everyone
// has paid" flag is stored.
function PaymentCollectionPanel({
  target, fixtureKey, teamId, teamPoolPence, label, date, settled, onSettledChange,
}: {
  target: CollectTarget; fixtureKey: string; teamId: string; teamPoolPence: number;
  label: string; date: string; settled: boolean;
  onSettledChange: (fixtureKey: string, settled: boolean) => void;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<CollectRow[]>([]);
  const [sending, setSending] = useState(false);
  const [busyPlayer, setBusyPlayer] = useState<string | null>(null);

  // Which column identifies this charge, and what value it holds.
  const targetCol = target.kind === "match" ? "match_id" : "open_match_id";
  const targetId = target.kind === "match" ? target.matchId : target.openMatchId;
  const isTournament = target.kind === "tournament";

  const totalWithFee = Math.round(teamPoolPence * 1.05);

  useEffect(() => {
    async function load() {
      // Note: teams.captain_id has no FK relationship registered with profiles
      // in the Supabase schema cache, so it can't be embedded in a select —
      // doing so makes the entire query fail (PGRST200). Fetch separately.
      const [{ data: members }, { data: team }, { data: confs }, { data: statusRows }, { data: polls }] = await Promise.all([
        supabase.from("team_members").select("player_id, profiles(full_name)").eq("team_id", teamId).eq("status", "approved"),
        supabase.from("teams").select("captain_id").eq("id", teamId).maybeSingle(),
        // Both kinds answer availability now — a tournament entry against
        // open_match_id (supabase_event_availability.sql). A database without
        // that migration fails this one query and falls back to the poll below.
        supabase.from("match_confirmations").select("player_id, status").eq(targetCol, targetId).eq("team_id", teamId),
        supabase.from("payment_collection_status").select("player_id, share_pence, received").eq(targetCol, targetId).eq("team_id", teamId),
        supabase.from("availability_requests").select("id, date_options").eq("team_id", teamId),
      ]);
      const { data: captainProfile } = team?.captain_id
        ? await supabase.from("profiles").select("full_name").eq("id", team.captain_id).maybeSingle()
        : { data: null };
      const rosterList: RosterPlayer[] = [
        ...(members ?? []).map((m) => ({ player_id: m.player_id as string, name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player" })),
        ...(team?.captain_id ? [{ player_id: team.captain_id as string, name: captainProfile?.full_name ?? "Captain" }] : []),
      ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);
      setRoster(rosterList);
      setRows((statusRows ?? []) as CollectRow[]);

      // Who "played" = who said they were available for THIS fixture. The
      // fixture's own answers come first: they start as the poll's answer for
      // this date (carried over at entry — lib/event-availability.ts) and then
      // track every change made after it, right up to kickoff.
      const participants = new Set<string>();
      for (const c of (confs ?? []).filter((c) => c.status === "confirmed")) participants.add(c.player_id);

      // Nobody answered the fixture itself — fall back to the poll.
      // Find the poll whose date_options include an entry matching match_date,
      // then collect the players who marked that option as available.
      type Opt = { id: string; date: string };
      if (participants.size === 0) {
        const pollList = (polls ?? []) as { id: string; date_options: Opt[] }[];
        let matchedPoll: { id: string; optionIds: string[] } | null = null;
        for (const poll of pollList) {
          const optionIds = (poll.date_options ?? [])
            .filter((o) => parseOptionDate(o.date) === date)
            .map((o) => o.id);
          if (optionIds.length > 0) { matchedPoll = { id: poll.id, optionIds }; break; }
        }
        if (matchedPoll) {
          const { data: resps } = await supabase.from("availability_responses")
            .select("player_id, available_date_ids").eq("request_id", matchedPoll.id);
          for (const r of resps ?? []) {
            if ((r.available_date_ids ?? []).some((id: string) => matchedPoll!.optionIds.includes(id))) {
              participants.add(r.player_id as string);
            }
          }
        }
      }
      // A tournament entry is bought by the team as a whole rather than by a
      // confirmed line-up, so with nothing else to go on the whole squad
      // shares it — the captain can still untick anyone who didn't travel.
      if (participants.size === 0 && isTournament) {
        for (const p of rosterList) participants.add(p.player_id);
      }
      const participantsInRoster = new Set(rosterList.filter((p) => participants.has(p.player_id)).map((p) => p.player_id));
      setParticipantIds(participantsInRoster);
      if (!statusRows || statusRows.length === 0) {
        setChecked(new Set(participantsInRoster));
      }
      setLoading(false);
    }
    load();
  }, [targetCol, targetId, teamId]);

  const requestSent = rows.length > 0;

  const handleSend = async () => {
    if (!user || checked.size === 0) return;
    setSending(true);
    const playerIds = Array.from(checked);
    const n = playerIds.length;
    const base = Math.floor(totalWithFee / n);
    const remainder = totalWithFee - base * n;

    const newRows: CollectRow[] = playerIds.map((id, i) => ({
      player_id: id,
      share_pence: base + (i < remainder ? 1 : 0),
      received: false,
    }));

    await supabase.from("payment_collection_status").insert(
      newRows.map((r) => ({ [targetCol]: targetId, team_id: teamId, player_id: r.player_id, included: true, share_pence: r.share_pence, received: false }))
    );

    const what = isTournament ? `entering ${label}` : `the match vs ${label}`;
    await supabase.from("messages").insert(
      newRows.map((r) => ({
        sender_id: user.id,
        receiver_id: r.player_id,
        type: "payment_reminder",
        [targetCol]: targetId,
        body: `You owe £${(r.share_pence / 100).toFixed(2)} for ${what} (${fmtDate(date)}). Please pay your captain.`,
      }))
    );

    setRows(newRows);
    setSending(false);
  };

  // "Everyone has paid" lives on matches.fees_settled for a game, and per
  // entered team on open_match_teams.fees_settled for a tournament.
  const writeSettled = async (value: boolean) => {
    if (target.kind === "match") {
      await supabase.from("matches").update({ fees_settled: value }).eq("id", target.matchId);
    } else {
      await supabase.from("open_match_teams").update({ fees_settled: value })
        .eq("open_match_id", target.openMatchId).eq("team_id", teamId);
    }
  };

  const toggleReceived = async (playerId: string) => {
    const row = rows.find((r) => r.player_id === playerId);
    if (!row) return;
    setBusyPlayer(playerId);
    const next = !row.received;
    const updatedRows = rows.map((r) => r.player_id === playerId ? { ...r, received: next } : r);
    setRows(updatedRows);
    // Keep credited_pence in step with a manual toggle, so the player's own
    // "amount owed" total (derived from credited_pence) stays accurate.
    await supabase.from("payment_collection_status")
      .update({ received: next, credited_pence: next ? row.share_pence : 0, updated_at: new Date().toISOString() })
      .eq(targetCol, targetId).eq("player_id", playerId);

    const allReceived = updatedRows.every((r) => r.received);
    if (allReceived !== settled) {
      await writeSettled(allReceived);
      onSettledChange(fixtureKey, allReceived);
    }
    setBusyPlayer(null);
  };

  const handleRemove = async (playerId: string) => {
    setBusyPlayer(playerId);
    await supabase.from("payment_collection_status").delete().eq(targetCol, targetId).eq("player_id", playerId);
    const updatedRows = rows.filter((r) => r.player_id !== playerId);
    setRows(updatedRows);
    setChecked((prev) => { const next = new Set(prev); next.delete(playerId); return next; });

    const allReceived = updatedRows.length > 0 && updatedRows.every((r) => r.received);
    if (allReceived !== settled) {
      await writeSettled(allReceived);
      onSettledChange(fixtureKey, allReceived);
    }
    setBusyPlayer(null);
  };

  return (
    <div className="mt-3 bg-background border border-border rounded-xl p-3">
      <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Collect Payment</p>
        </div>
        {!requestSent ? (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-2 py-0.5 rounded-full">Collect Payment</span>
        ) : settled ? (
          <span className="text-[10px] font-semibold bg-green-500/10 text-green-600 border border-green-500/30 px-2 py-0.5 rounded-full">Paid ✓</span>
        ) : (
          <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-600 border border-yellow-500/30 px-2 py-0.5 rounded-full">
            {rows.filter((r) => r.received).length}/{rows.length} paid
          </span>
        )}
      </button>

      {expanded && (
        loading ? (
          <div className="py-3 text-center"><div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : !requestSent ? (
          <div className="mt-3">
            <p className="text-[11px] text-text-secondary mb-3">
              Total owed ({isTournament ? "entry fee" : "booking"} + 5% fee): <span className="text-text-primary font-semibold">£{(totalWithFee / 100).toFixed(2)}</span>
              {checked.size > 0 && <> · £{(totalWithFee / checked.size / 100).toFixed(2)}/player</>}
            </p>
            {(() => {
              const played = roster.filter((p) => participantIds.has(p.player_id));
              const others = roster.filter((p) => !participantIds.has(p.player_id));
              const renderRow = (p: RosterPlayer) => {
                const isChecked = checked.has(p.player_id);
                return (
                  <button key={p.player_id} type="button"
                    onClick={() => setChecked((prev) => { const next = new Set(prev); next.has(p.player_id) ? next.delete(p.player_id) : next.add(p.player_id); return next; })}
                    className="w-full flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2 text-left">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isChecked ? "border-accent bg-accent" : "border-border"}`}>
                      {isChecked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <p className="flex-1 text-xs font-medium truncate">{p.player_id === user?.id ? "You" : p.name}</p>
                  </button>
                );
              };
              return (
                <>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <p className="text-[10px] font-bold text-accent-ink uppercase tracking-wider">Played</p>
                    <span className="text-[10px] text-text-secondary">submitted availability</span>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {played.length > 0
                      ? played.map(renderRow)
                      : <p className="text-[11px] text-text-secondary px-1 py-1">No availability submitted for this date — add players below.</p>}
                  </div>
                  {others.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1.5">Add from squad</p>
                      <div className="space-y-1.5 mb-3">{others.map(renderRow)}</div>
                    </>
                  )}
                </>
              );
            })()}
            <button onClick={handleSend} disabled={checked.size === 0 || sending}
              className="w-full py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed">
              {sending ? "Sending…" : `Send Payment Request (${checked.size})`}
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] text-text-secondary mb-1">Full squad</p>
            {roster.map((p) => {
              const row = rows.find((r) => r.player_id === p.player_id);
              const name = p.player_id === user?.id ? "You" : p.name;
              return (
                <div key={p.player_id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2">
                  <p className="flex-1 min-w-0 text-xs font-medium truncate">{name}</p>
                  {row ? (
                    <>
                      <span className="text-xs font-semibold text-text-secondary flex-shrink-0">£{(row.share_pence / 100).toFixed(2)}</span>
                      <button onClick={() => toggleReceived(p.player_id)} disabled={busyPlayer === p.player_id}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 disabled:opacity-50 ${row.received ? "bg-accent/10 text-accent-ink border border-accent/20" : "bg-red-500/10 text-red-600 border border-red-500/20"}`}>
                        {row.received ? "Paid ✓" : "Unpaid"}
                      </button>
                      {!row.received && (
                        <button onClick={() => handleRemove(p.player_id)} disabled={busyPlayer === p.player_id}
                          title="Remove from payment request"
                          className="text-text-secondary hover:text-red-600 flex-shrink-0 disabled:opacity-50">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-[10px] font-semibold text-text-secondary bg-surface border border-border px-2 py-0.5 rounded-full flex-shrink-0">Not charged</span>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

// ── Joining fees (captain only) ──────────────────────────────────────────
// Who has covered their one-off joining fee. The paid amounts are advanced
// only by the server when a verified payment lands (supabase_joining_fees.sql)
// — the captain reads them here and can nudge, not tick. Cash handed over in
// person goes through Record Cash / record_cash_credit like any other credit.
type FeeRow = {
  playerId: string;
  name: string;
  duePence: number;
  paidPence: number;
};

function JoiningFeesPanel({ teamId, captainId }: { teamId: string; captainId: string }) {
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("team_members")
        .select("player_id, joining_fee_due_pence, joining_fee_paid_pence, profiles(full_name)")
        .eq("team_id", teamId)
        .eq("status", "approved");
      if (error) return;   // joining-fees migration not run — panel stays hidden
      setRows(
        (data ?? [])
          .filter((m) => (m.joining_fee_due_pence ?? 0) > 0)
          .map((m) => ({
            playerId: m.player_id as string,
            name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? "Unknown player",
            duePence: (m.joining_fee_due_pence as number) ?? 0,
            paidPence: (m.joining_fee_paid_pence as number) ?? 0,
          }))
          .sort((a, b) => {
            const aOwes = a.paidPence < a.duePence ? 0 : 1;
            const bOwes = b.paidPence < b.duePence ? 0 : 1;
            return aOwes - bOwes || a.name.localeCompare(b.name);
          })
      );
    }
    load();
  }, [teamId]);

  if (rows.length === 0) return null;

  const remind = async (row: FeeRow) => {
    setBusyId(row.playerId);
    await supabase.from("messages").insert({
      sender_id: captainId,
      receiver_id: row.playerId,
      type: "payment_reminder",
      body: `Reminder: your ${fmtFee(row.duePence - row.paidPence)} joining fee is still due. Pay it via the Top Up button on Home — it goes into the team's credits for pitch and tournament fees. Until then you can't join or vote available for games.`,
    });
    setRemindedIds((prev) => new Set(prev).add(row.playerId));
    setBusyId(null);
  };

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4 mb-3">
      <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Joining fees</p>
      <div className="space-y-2">
        {rows.map((row) => {
          const paid = row.paidPence >= row.duePence;
          return (
            <div key={row.playerId} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{row.name}</p>
                <p className="text-[11px] text-text-secondary">
                  {paid
                    ? `${fmtFee(row.duePence)} paid`
                    : row.paidPence > 0
                    ? `${fmtFee(row.paidPence)} of ${fmtFee(row.duePence)} paid`
                    : `${fmtFee(row.duePence)} due`}
                </p>
              </div>
              {paid ? (
                <span className="text-[10px] font-semibold text-accent-ink bg-accent/10 border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">Paid ✓</span>
              ) : (
                <button
                  onClick={() => remind(row)}
                  disabled={busyId === row.playerId || remindedIds.has(row.playerId)}
                  className="text-[11px] font-bold text-red-600 bg-red-500/10 border border-red-500/30 px-2.5 py-1 rounded-lg flex-shrink-0 disabled:opacity-50">
                  {remindedIds.has(row.playerId) ? "Reminded ✓" : busyId === row.playerId ? "Sending…" : "Remind"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The fixture list itself ───────────────────────────────────────────────
// Chrome-free so it can sit in a page or in the modal below.
export function SettlePaymentsList() {
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState<HistoryFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCaptainViewer, setIsCaptainViewer] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [matchRows, setMatchRows] = useState<Record<string, MatchRow>>({});
  const [matchResults, setMatchResults] = useState<Record<string, { teamScore: number; opponentScore: number }>>({});

  useEffect(() => {
    if (!user) return;
    async function load() {
      // Resolve the captain id this player's history is tied to (their own
      // id if they captain a team, otherwise their team's captain).
      let captainId: string | undefined = user!.id;
      const { data: ownTeam } = await supabase.from("teams").select("id").eq("captain_id", user!.id).maybeSingle();
      let tid: string | undefined = ownTeam?.id;
      if (!ownTeam) {
        const { data: membership } = await supabase.from("team_members")
          .select("team_id").eq("player_id", user!.id).eq("status", "approved").maybeSingle();
        if (!membership?.team_id) { setLoading(false); return; }
        tid = membership.team_id;
        const { data: team } = await supabase.from("teams").select("captain_id").eq("id", membership.team_id).maybeSingle();
        captainId = team?.captain_id;
      }
      if (!captainId || !tid) { setLoading(false); return; }
      setTeamId(tid);
      setIsCaptainViewer(user!.id === captainId);

      // Matches where this team posted and was challenged
      const { data: myPosts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched");

      const posterFixtures = await Promise.all(
        (myPosts ?? []).map(async (post) => {
          const { data: ch } = await supabase.from("challenges")
            .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
          return {
            postId: post.id,
            opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
            date: post.match_date,
            time: post.match_time,
            pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
          };
        })
      );

      // Matches where this team challenged another team's post
      const { data: myChallenges } = await supabase.from("challenges")
        .select("post_id, selected_pitch").eq("challenger_captain_id", captainId).eq("status", "accepted");

      const challengerFixtures = await Promise.all(
        (myChallenges ?? []).map(async (c) => {
          const { data: post } = await supabase.from("match_posts")
            .select("id, team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
          return {
            postId: c.post_id,
            opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
            date: (post as { match_date: string } | null)?.match_date ?? "",
            time: (post as { match_time: string } | null)?.match_time ?? "",
            pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
          };
        })
      );

      // Settle Payments shows both past fixtures and upcoming ones (marked
      // "Upcoming" so a captain can still issue payment requests ahead of the
      // game, just not submit a result before it's played).
      // Normalise the date rather than requiring ISO: legacy rows store
      // "Wed, 03 JUN 2026", and dropping them hid played fixtures from history
      // entirely while the same string kept them pinned in Upcoming elsewhere.
      const all = [...posterFixtures, ...challengerFixtures]
        .map((f) => ({ ...f, date: toDateKey(f.date), isUpcoming: isUpcomingDate(f.date) }))
        .filter((f) => f.date !== "");

      const { data: rows } = all.length > 0
        ? await supabase.from("matches").select("id, post_id, posting_team_id, challenging_team_id, confirmed_pitch, fees_settled, result_submitted, result_verified").in("post_id", all.map((f) => f.postId))
        : { data: [] };
      const byPostId = new Map((rows ?? []).map((r) => [r.post_id, r.id]));
      setMatchRows(Object.fromEntries((rows ?? []).map((r) => [r.id, r as unknown as MatchRow])));

      // Fetch all match_results for these matches, then filter client-side to the
      // current team only. Consistent with match detail page which uses the same
      // pattern — server-side eq("team_id") can return opponent rows unexpectedly.
      const allMatchIds = (rows ?? []).map((r) => r.id);
      if (allMatchIds.length > 0 && tid) {
        const { data: results } = await supabase.from("match_results")
          .select("match_id, team_id, team_score, opponent_score").in("match_id", allMatchIds);
        const myResults = (results ?? []).filter((r) => r.team_id === tid);
        setMatchResults(Object.fromEntries(myResults.map((r) => [r.match_id, { teamScore: r.team_score, opponentScore: r.opponent_score }])));
      }

      const matchById = new Map((rows ?? []).map((r) => [r.id, r]));
      const matchFixtures: HistoryFixture[] = all.map((f) => {
        const matchRowId = byPostId.get(f.postId) ?? null;
        const m = matchRowId ? matchById.get(matchRowId) : undefined;
        // Each team covers 50% of the pitch fee; the poster carries the odd penny.
        const feePence = Math.round(((m?.confirmed_pitch as { price?: number } | null)?.price ?? 0) * 100);
        const half = Math.floor(feePence / 2);
        return {
          ...f,
          key: `match:${f.postId}`,
          kind: "match" as const,
          matchRowId,
          openMatchId: null,
          label: f.opponent,
          teamPoolPence: m?.posting_team_id === tid ? feePence - half : half,
          settled: Boolean(m?.fees_settled),
        };
      });

      const tournamentFixtures = await loadTournamentEntries(tid!);

      const withRows = [...matchFixtures, ...tournamentFixtures]
        // Soonest upcoming first, then most recent past first.
        .sort((a, b) => {
          if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1;
          return a.isUpcoming ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
        });

      setFixtures(withRows);
      setLoading(false);
    }
    load();
  }, [user]);

  const handleSettledChange = (fixtureKey: string, settled: boolean) => {
    setFixtures((prev) => prev.map((f) => f.key === fixtureKey ? { ...f, settled } : f));
  };

  if (loading) {
    return <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>;
  }

  if (fixtures.length === 0) {
    return (
      <>
      {isCaptainViewer && teamId && user && <JoiningFeesPanel teamId={teamId} captainId={user.id} />}
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <p className="font-semibold">No match history yet</p>
        <p className="text-sm text-text-secondary max-w-[240px]">Confirmed fixtures — upcoming and played — will show up here.</p>
      </div>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {isCaptainViewer && teamId && user && <JoiningFeesPanel teamId={teamId} captainId={user.id} />}
      {fixtures.map((f) => {
        const m = f.matchRowId ? matchRows[f.matchRowId] : undefined;
        return (
          <div key={f.key} className="bg-surface border border-border shadow-card rounded-card p-4">
            <div className="flex items-start justify-between mb-2 gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm truncate">{f.kind === "tournament" ? f.label : `vs ${f.label}`}</p>
                  {f.kind === "tournament" && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-surface border border-border text-text-secondary px-1.5 py-0.5 rounded flex-shrink-0">Tournament</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                  {fmtDate(f.date)} · {f.time}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  {f.pitch}
                </div>
              </div>
              {f.isUpcoming ? (
                <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">Upcoming</span>
              ) : f.matchRowId && m?.result_verified && matchResults[f.matchRowId] && (() => {
                const r = matchResults[f.matchRowId];
                const outcome = r.teamScore > r.opponentScore ? "won" : r.teamScore < r.opponentScore ? "lost" : "drew";
                const colorClass = outcome === "won" ? "text-accent-ink" : outcome === "lost" ? "text-red-500" : "text-text-secondary";
                return (
                  <p className={`text-3xl font-extrabold flex-shrink-0 ${colorClass}`}>{r.teamScore} – {r.opponentScore}</p>
                );
              })()}
            </div>

            {!f.isUpcoming && isCaptainViewer && f.matchRowId && (!m?.result_verified || !matchResults[f.matchRowId]) ? (
              <a href={`/my-team/match/${f.matchRowId}/result`} className="block w-full mt-3 py-2 rounded-xl bg-red-500 text-white text-xs font-bold text-center">
                Submit Result
              </a>
            ) : f.matchRowId ? (
              <a href={`/my-team/match/${f.matchRowId}`} className="block w-full mt-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary text-center">
                View Details
              </a>
            ) : f.openMatchId && (
              <a href={`/play/tournament/${f.openMatchId}`} className="block w-full mt-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary text-center">
                View Tournament
              </a>
            )}

            {isCaptainViewer && teamId && f.teamPoolPence > 0 && !f.settled
              && (f.kind === "match" ? f.matchRowId : f.openMatchId) && (
              <PaymentCollectionPanel
                target={f.kind === "match"
                  ? { kind: "match", matchId: f.matchRowId! }
                  : { kind: "tournament", openMatchId: f.openMatchId! }}
                fixtureKey={f.key}
                teamId={teamId}
                teamPoolPence={f.teamPoolPence}
                label={f.label}
                date={f.date}
                settled={f.settled}
                onSettledChange={handleSettledChange}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Popup form ────────────────────────────────────────────────────────────
// Same shell as the Team Credits / Collect Payment popups it sits beside.
export default function SettlePaymentsModal({ onClose }: { onClose: () => void }) {
  return (
    <BottomSheet title="Settle Payments" subtitle="Upcoming and past fixtures for your team" onClose={onClose}>
      <SettlePaymentsList />
    </BottomSheet>
  );
}
