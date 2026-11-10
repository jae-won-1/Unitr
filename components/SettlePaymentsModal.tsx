"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  fmtDate, loadMatchFixtures, loadTournamentEntries, parseOptionDate, sortSettleFixtures,
  type HistoryFixture, type SettleMatchRow,
} from "@/lib/settle-payments";
import { outcomeOf, OUTCOME_TEXT } from "@/lib/match-results";
import { JoiningFeeAmountPanel } from "@/components/JoiningFeePanels";
import BottomSheet from "@/components/BottomSheet";
import { loadLeadership } from "@/lib/team-leadership";
import { withFee, UNITER_FEE_ENABLED, UNITER_FEE_LABEL } from "@/lib/uniter-fee";

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


type MatchRow = SettleMatchRow;

type RosterPlayer = { player_id: string; name: string };
type CollectRow = { player_id: string; share_pence: number; received: boolean };

// ── Captain's per-fixture payment collection panel ────────────────────────
// Works for a matched game or a tournament entry: `target` decides which
// column the payment_collection_status rows key off and where the "everyone
// has paid" flag is stored.
function PaymentCollectionPanel({
  target, teamId, teamPoolPence, label, date, settled,
}: {
  target: CollectTarget; teamId: string; teamPoolPence: number;
  label: string; date: string; settled: boolean;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<CollectRow[]>([]);
  const [sending, setSending] = useState(false);

  // Which column identifies this charge, and what value it holds.
  const targetCol = target.kind === "match" ? "match_id" : "open_match_id";
  const targetId = target.kind === "match" ? target.matchId : target.openMatchId;
  const isTournament = target.kind === "tournament";

  const totalWithFee = withFee(teamPoolPence);

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


  return (
    <div className="mt-3 bg-background border border-border rounded-xl p-3">
      <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Payment request</p>
        </div>
        {!requestSent ? (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-2 py-0.5 rounded-full">Not issued yet</span>
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
              Total owed ({isTournament ? "entry fee" : "booking"}{UNITER_FEE_ENABLED ? ` + ${UNITER_FEE_LABEL} fee` : ""}): <span className="text-text-primary font-semibold">£{(totalWithFee / 100).toFixed(2)}</span>
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
          /* Already issued — this is the receipt for what was charged, not a
             place to chase it. Marking payments off, reminding and removing a
             player all live in Payment Status now, so a captain has one answer
             to "who still owes me?" across every fixture rather than one per
             card here. */
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] text-text-secondary mb-1">
              Requested from {rows.length} player{rows.length !== 1 ? "s" : ""} · £{(rows.reduce((sum, r) => sum + r.share_pence, 0) / 100).toFixed(2)} total
            </p>
            {roster.map((p) => {
              const row = rows.find((r) => r.player_id === p.player_id);
              const name = p.player_id === user?.id ? "You" : p.name;
              return (
                <div key={p.player_id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2">
                  <p className="flex-1 min-w-0 text-xs font-medium truncate">{name}</p>
                  {row ? (
                    <>
                      <span className="text-xs font-semibold text-text-secondary flex-shrink-0">£{(row.share_pence / 100).toFixed(2)}</span>
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${row.received ? "bg-accent/10 text-accent-ink border border-accent/20" : "bg-red-500/10 text-red-600 border border-red-500/20"}`}>
                        {row.received ? "Paid ✓" : "Unpaid"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] font-semibold text-text-secondary bg-surface border border-border px-2 py-0.5 rounded-full flex-shrink-0">Not charged</span>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-text-secondary pt-1">
              Mark payments off, remind or drop a player in <span className="font-semibold text-text-primary">Payment Status</span>.
            </p>
          </div>
        )
      )}
    </div>
  );
}

// ── The fixture list itself ───────────────────────────────────────────────
// Chrome-free so it can sit in a page or in the modal below.
//
// Two tabs, because a captain issues two kinds of charge: a share of a
// fixture's cost, and the one-off joining fee. Both are *issuing* — deciding
// who is charged what. Who has actually paid is Payment Status' job, next door
// in the money row.
export function SettlePaymentsList() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"fixtures" | "fee">("fixtures");
  const [fixtures, setFixtures] = useState<HistoryFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCaptainViewer, setIsCaptainViewer] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [matchRows, setMatchRows] = useState<Record<string, MatchRow>>({});
  const [matchResults, setMatchResults] = useState<Record<string, { teamScore: number; opponentScore: number }>>({});

  useEffect(() => {
    if (!user) return;
    async function load() {
      // The team's history hangs off its captain's id whoever set the games
      // up, so that's what this reads — and a co-captain gets the captain's
      // view of it, collection controls included.
      const led = await loadLeadership(user!.id);
      const captainId = led?.captainId;
      const tid = led?.teamId;
      if (!captainId || !tid) { setLoading(false); return; }
      setTeamId(tid);
      setIsCaptainViewer(Boolean(led?.canManage));

      const { fixtures: matchFixtures, matchRows: rowsById, matchResults: results } = await loadMatchFixtures(captainId, tid);
      setMatchRows(rowsById);
      setMatchResults(results);

      const tournamentFixtures = await loadTournamentEntries(tid!);

      const withRows = sortSettleFixtures([...matchFixtures, ...tournamentFixtures]);

      setFixtures(withRows);
      setLoading(false);
    }
    load();
  }, [user]);

  if (loading) {
    return <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>;
  }

  // Captains only: a player has no fee to set, and the fixtures they can see
  // are the ones they're in.
  const tabs = isCaptainViewer && teamId ? (
    <div className="flex bg-surface border border-border rounded-btn p-[3px] gap-[3px] mb-3">
      {([["fixtures", "Fixtures"], ["fee", "Joining fee"]] as const).map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)}
          className={`flex-1 py-2 rounded-[9px] text-xs transition-colors ${tab === id ? "bg-accent text-white font-bold" : "text-text-secondary font-semibold"}`}>
          {label}
        </button>
      ))}
    </div>
  ) : null;

  // Permanent tab rather than one that appears with a fee already set — it's
  // where the fee is set in the first place, so it has to be there when there
  // isn't one.
  if (tab === "fee" && isCaptainViewer && teamId) {
    return <>{tabs}<JoiningFeeAmountPanel teamId={teamId} /></>;
  }

  if (fixtures.length === 0) {
    return (
      <>
      {tabs}
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
      {tabs}
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
              ) : f.matchRowId && matchResults[f.matchRowId] && (() => {
                // Shown as soon as this captain files it, not only once the
                // opponent agrees — the same rule the Calendar and the manage
                // page follow, with "Pending" carrying the difference.
                const r = matchResults[f.matchRowId];
                return (
                  <div className="flex flex-col items-end flex-shrink-0 leading-none">
                    <p className={`text-3xl font-extrabold ${OUTCOME_TEXT[outcomeOf(r.teamScore, r.opponentScore)]}`}>
                      {r.teamScore} – {r.opponentScore}
                    </p>
                    <span className="text-[10px] font-semibold text-text-secondary mt-1">
                      {m?.result_verified ? "Full time" : "Pending"}
                    </span>
                  </div>
                );
              })()}
            </div>

            {!f.isUpcoming && isCaptainViewer && f.matchRowId && !matchResults[f.matchRowId] ? (
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
                teamId={teamId}
                teamPoolPence={f.teamPoolPence}
                label={f.label}
                date={f.date}
                settled={f.settled}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Popup form ────────────────────────────────────────────────────────────
// Same shell as the Team Credits / Payment Status popups it sits beside.
export default function SettlePaymentsModal({ onClose }: { onClose: () => void }) {
  return (
    <BottomSheet title="Settle Payments" subtitle="Issue what your squad owes — fixture shares and the joining fee" onClose={onClose}>
      <SettlePaymentsList />
    </BottomSheet>
  );
}
