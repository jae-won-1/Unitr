"use client";

import { useEffect, useState } from "react";
import {
  fmtDate, loadMatchFixtures, loadSettleRoster, loadTournamentEntries, sortSettleFixtures,
  type HistoryFixture, type RosterPlayer,
} from "@/lib/settle-payments";
import { createRequest, failed, pounds, type FinanceRequest } from "@/lib/team-finance";

// Settle match fees — the Team Finance sub-tab.
//
// Lists the fixtures the team has paid for and not yet asked the squad to
// cover, and works as Settle Payments always has: pick who played, share the
// cost equally, send. What it sends is a payment request (kind "match_fee"),
// so it lands on the dashboard beside every other request and is tracked,
// reminded and paid from there. Once a fixture has a request it leaves this
// list — there is nothing left to issue.

function FixtureCard({ fixture, teamId, userId, onIssued }: {
  fixture: HistoryFixture; teamId: string; userId: string;
  onIssued: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null);
  const [played, setPlayed] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTournament = fixture.kind === "tournament";
  const targetId = isTournament ? fixture.openMatchId! : fixture.matchRowId!;

  // The squad is only fetched for a fixture the leader actually opens.
  useEffect(() => {
    if (!open || roster) return;
    let live = true;
    loadSettleRoster({ kind: fixture.kind, id: targetId }, teamId, fixture.date).then((r) => {
      if (!live) return;
      setRoster(r.roster);
      setPlayed(r.participantIds);
      setChecked(new Set(r.participantIds));
    });
    return () => { live = false; };
  }, [open, roster, fixture.kind, fixture.date, targetId, teamId]);

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const send = async () => {
    if (checked.size === 0) return;
    setSending(true);
    setError(null);
    const res = await createRequest({
      teamId,
      kind: "match_fee",
      title: isTournament ? `Entry fee — ${fixture.label}` : `Match fee — vs ${fixture.label}`,
      description: `${fmtDate(fixture.date)}${fixture.pitch && fixture.pitch !== "TBC" ? ` · ${fixture.pitch}` : ""}`,
      totalPence: fixture.teamPoolPence,
      playerIds: Array.from(checked),
      matchId: isTournament ? null : targetId,
      openMatchId: isTournament ? targetId : null,
    });
    if (failed(res)) { setError(res.error); setSending(false); return; }
    await onIssued();
  };

  const row = (p: RosterPlayer) => {
    const on = checked.has(p.player_id);
    return (
      <button key={p.player_id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(p.player_id)}
        className="w-full flex items-center gap-2 bg-panel border border-border rounded-lg px-3 py-2 text-left">
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${on ? "border-accent bg-accent" : "border-border"}`}>
          {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
        </span>
        <span className="flex-1 text-xs font-medium truncate">{p.player_id === userId ? "You" : p.name}</span>
      </button>
    );
  };

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left" aria-expanded={open}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm truncate">{isTournament ? fixture.label : `vs ${fixture.label}`}</p>
              {isTournament && (
                <span className="text-[9px] font-bold uppercase tracking-wider bg-surface border border-border text-text-secondary px-1.5 py-0.5 rounded flex-shrink-0">Event</span>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-1">
              {fmtDate(fixture.date)}{fixture.time ? ` · ${fixture.time}` : ""}{fixture.isUpcoming ? " · upcoming" : ""}
            </p>
            <p className="text-xs text-text-secondary mt-0.5 truncate">{fixture.pitch}</p>
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            <p className="text-sm font-bold">{pounds(fixture.teamPoolPence)}</p>
            <p className="text-[10px] text-text-secondary">to share</p>
          </div>
        </div>
      </button>

      {open && (
        roster === null ? (
          <div className="py-4 text-center"><div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[11px] text-text-secondary mb-3">
              {checked.size > 0
                ? <>Shared between {checked.size}: <span className="font-semibold text-text-primary">{pounds(Math.ceil(fixture.teamPoolPence / checked.size))} each</span></>
                : "Tick who shares the cost."}
            </p>
            <div className="flex items-center gap-1.5 mb-1.5">
              <p className="text-[10px] font-bold text-accent-ink uppercase tracking-wider">Played</p>
              <span className="text-[10px] text-text-secondary">said they were available</span>
            </div>
            <div className="space-y-1.5 mb-3">
              {roster.some((p) => played.has(p.player_id))
                ? roster.filter((p) => played.has(p.player_id)).map(row)
                : <p className="text-[11px] text-text-secondary px-1 py-1">Nobody answered for this date — add players below.</p>}
            </div>
            {roster.some((p) => !played.has(p.player_id)) && (
              <>
                <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1.5">Add from squad</p>
                <div className="space-y-1.5 mb-3">{roster.filter((p) => !played.has(p.player_id)).map(row)}</div>
              </>
            )}
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            <button type="button" onClick={send} disabled={checked.size === 0 || sending}
              className="w-full py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
              {sending ? "Sending…" : `Send payment request (${checked.size})`}
            </button>
          </div>
        )
      )}
    </div>
  );
}

export default function SettleMatchFees({ teamId, captainId, userId, requests, onIssued }: {
  teamId: string;
  /** The team's real captain — fixtures are filed under their id. */
  captainId: string;
  userId: string;
  /** The dashboard's requests, to know which fixtures already have one. */
  requests: FinanceRequest[];
  onIssued: () => void | Promise<void>;
}) {
  const [fixtures, setFixtures] = useState<HistoryFixture[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ fixtures: matches }, events] = await Promise.all([
        loadMatchFixtures(captainId, teamId),
        loadTournamentEntries(teamId),
      ]);
      if (live) setFixtures(sortSettleFixtures([...matches, ...events]));
    })();
    return () => { live = false; };
  }, [captainId, teamId]);

  if (fixtures === null) {
    return <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>;
  }

  const requestedMatches = new Set(requests.map((r) => r.matchId).filter(Boolean));
  const requestedEvents = new Set(requests.map((r) => r.openMatchId).filter(Boolean));
  const unsettled = fixtures.filter((f) =>
    f.teamPoolPence > 0
    && (f.kind === "match"
      ? Boolean(f.matchRowId) && !requestedMatches.has(f.matchRowId)
      : Boolean(f.openMatchId) && !requestedEvents.has(f.openMatchId)));

  if (unsettled.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <div className="w-16 h-16 rounded-full bg-success-bg border border-success-border flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="font-semibold">Nothing to settle</p>
        <p className="text-sm text-text-secondary max-w-[260px]">
          Every game your team has paid for has a payment request. Track who has paid on the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        Games the team has paid for and not yet asked the squad to cover.
      </p>
      {unsettled.map((f) => (
        <FixtureCard key={f.key} fixture={f} teamId={teamId} userId={userId} onIssued={onIssued} />
      ))}
    </div>
  );
}
