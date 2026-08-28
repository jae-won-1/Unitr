"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import AvailabilityPollForm, { DateOption } from "@/components/AvailabilityPollForm";
import AvailabilityModal from "@/components/AvailabilityModal";
import MatchAvailabilityList, { useMatchAvailability } from "@/components/MatchAvailabilityList";
import BottomSheet from "@/components/BottomSheet";

// The captain's whole availability loop, run from home without a redirect:
// post the poll, watch the votes land, and cast their own. The captain is a
// squad member like anyone else — squadSize counts them (they have no
// team_members row of their own), so a poll they never answer reads as
// permanently incomplete. Hence the vote path lives here rather than only in
// the player-side tab they never see.

type Request = { id: string; date_options: DateOption[] };
type Response = { player_id: string; available_date_ids: string[] };

// The poll's last option having passed means it's stale — the same rule
// My Team uses to stop showing a dead poll.
function isPollExpired(options: { date: string; time: string }[]): boolean {
  const MONTHS: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return options.every((o) => {
    const m = o.date.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
    if (!m) return false;
    const mo = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (mo === undefined) return false;
    return new Date(Number(m[3]), mo, Number(m[1])) < today;
  });
}

export function usePollStatus(teamId: string | null, userId: string | undefined) {
  const [request, setRequest] = useState<Request | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [squadSize, setSquadSize] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId) { setRequest(null); setLoading(false); return; }
    setLoading(true);
    const { data: req } = await supabase.from("availability_requests")
      .select("id, date_options")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    if (!req || isPollExpired(req.date_options as DateOption[])) {
      setRequest(null); setResponses([]); setLoading(false); return;
    }

    // player_id comes back so the captain's own answer is a filter over rows we
    // already have, rather than a second round-trip for one of them.
    const [{ data: resps }, { count }] = await Promise.all([
      supabase.from("availability_responses").select("player_id, available_date_ids").eq("request_id", req.id),
      supabase.from("team_members").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("status", "approved"),
    ]);

    setRequest(req as Request);
    setResponses((resps ?? []) as Response[]);
    setSquadSize((count ?? 0) + 1); // the captain isn't a team_members row
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  // null means "hasn't replied"; [] is a real answer meaning "none of these".
  const mine = userId ? responses.find((r) => r.player_id === userId) : undefined;
  const myAnswer = mine ? mine.available_date_ids : null;

  return { request, responses, squadSize, myAnswer, loading, reload: load };
}

// Overlay wrapper. The scroll lives on the backdrop, not the panel, so the
// date/time pickers inside the create form can overflow the panel freely —
// an `overflow-y-auto` panel would clip their dropdowns.




type PollStatusTileProps = {
  teamId: string | null;
  userId: string | undefined;
};

export default function PollStatusTile({ teamId, userId }: PollStatusTileProps) {
  const { request, responses, squadSize, myAnswer, loading, reload } = usePollStatus(teamId, userId);
  // Confirmed fixtures need the captain's own answer too, and plenty of them
  // never went through a poll — so the tile has something to show even when
  // no poll is running.
  const { matches, awaiting: myMatchesAwaiting, reload: reloadMatches } = useMatchAvailability(teamId, userId);
  const [view, setView] = useState<"status" | "create" | "vote" | null>(null);

  const replied = responses.length;
  const waiting = Math.max(0, squadSize - replied);
  const iVoted = myAnswer !== null;

  // The captain's own missing vote outranks the squad count in the badge: it's
  // the one number on this tile they can fix themselves, right now.
  // Tones are light-theme: a tinted fill needs a *darker* label than the old
  // dark-background pairing used, or it drops below readable contrast on white.
  const WAITING = "bg-orange-50 text-orange-700 border-orange-200";
  const DONE = "bg-success-bg text-accent-ink border-success-border";
  const badge = !request
    ? (myMatchesAwaiting > 0 ? { label: "Your reply", tone: WAITING } : null)
    : !iVoted ? { label: "Your vote", tone: DONE }
    : waiting > 0 ? { label: `${waiting} left`, tone: WAITING }
    : { label: "Complete", tone: DONE };

  const subtitle = loading ? "Checking…"
    : !request
      ? (matches.length > 0
          ? `${matches.length} confirmed match${matches.length === 1 ? "" : "es"} · tap to set availability`
          : "No poll running · tap to start one")
    : !iVoted ? `${replied} of ${squadSize} replied · you haven't voted yet`
    : `${replied} of ${squadSize} replied${waiting > 0 ? ` · waiting on ${waiting}` : " · all in"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setView(request || matches.length > 0 ? "status" : "create")}
        disabled={loading || !teamId}
        className="w-full rounded-card px-4 py-3.5 text-left border bg-surface border-border shadow-card disabled:opacity-60"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent-2 text-white flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary">Availability Poll</p>
            <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>
          </div>
          {badge && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 border ${badge.tone}`}>
              {badge.label}
            </span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      </button>

      {/* Voting reuses the player-side modal outright — same options, same
          upsert, so the captain's vote is an ordinary response row. Rendered
          instead of the status sheet rather than on top of it, to keep one
          overlay on screen at a time. */}
      {/* Poll dates only — the confirmed fixtures live in the status sheet this
          returns to, and listing them twice would just be noise. */}
      {view === "vote" && request && userId && (
        <AvailabilityModal
          request={request}
          myAnswer={myAnswer}
          userId={userId}
          onClose={() => setView("status")}
          onSubmitted={() => { reload(); }}
        />
      )}

      {view === "create" && teamId && userId && (
        <BottomSheet
          onClose={() => setView(null)}
          title={request ? "New poll" : "Start a poll"}
          subtitle={request
            ? "Posting new dates replaces the current poll and clears its votes."
            : "Add the dates you're considering. Your squad votes on which they can make."}
        >
          <AvailabilityPollForm
            teamId={teamId}
            captainId={userId}
            showIntro={false}
            // Straight into their own vote: the captain is counted in the squad
            // total, so a poll they haven't answered can never read "all in".
            onCreated={async () => { await reload(); setView("vote"); }}
          />
        </BottomSheet>
      )}

      {view === "status" && (request || matches.length > 0) && (
        <BottomSheet
          onClose={() => setView(null)}
          title="Availability"
          subtitle={request
            ? `${replied} of ${squadSize} replied${waiting > 0 ? ` · still waiting on ${waiting}` : ""}`
            : "No poll running — these games are already confirmed."}
        >

          {/* Confirmed fixtures first: they're happening either way, whereas a
              poll option is still only a proposal. */}
          {matches.length > 0 && teamId && userId && (
            <div className="mb-5">
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Confirmed matches</p>
              <MatchAvailabilityList
                matches={matches} userId={userId} teamId={teamId} onChanged={reloadMatches}
              />
            </div>
          )}

          {request && (
          <div className="space-y-2 mb-4">
            {matches.length > 0 && (
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Poll dates</p>
            )}
            {request.date_options.map((opt) => {
              const votes = responses.filter((r) => r.available_date_ids.includes(opt.id)).length;
              const pct = replied > 0 ? Math.round((votes / replied) * 100) : 0;
              const mine = myAnswer?.includes(opt.id);
              return (
                <div key={opt.id} className="bg-panel border border-border rounded-btn px-3.5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-semibold">
                      {opt.dayName} · {opt.time}
                      {mine && <span className="text-[10px] font-bold text-accent-ink ml-1.5">you</span>}
                    </p>
                    <span className="text-xs font-bold text-accent-ink">{votes} vote{votes !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-2 rounded-full">
                    <div className="h-1.5 bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-text-secondary mt-1">
                    {opt.date}{opt.location ? ` · ${opt.location}` : ""}
                  </p>
                </div>
              );
            })}

            {(() => {
              const none = responses.filter((r) => r.available_date_ids.length === 0).length;
              const pct = replied > 0 ? Math.round((none / replied) * 100) : 0;
              return (
                <div className="bg-panel border border-border rounded-btn px-3.5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-semibold text-text-secondary">Unavailable for any of these dates</p>
                    <span className="text-xs font-bold text-red-600">{none} vote{none !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-2 rounded-full">
                    <div className="h-1.5 bg-red-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}

            {replied === 0 && <p className="text-xs text-text-secondary py-1">No responses yet.</p>}
          </div>
          )}

          <div className="space-y-2">
            {request && (
              <button
                type="button"
                onClick={() => setView("vote")}
                disabled={!userId}
                className={`w-full py-3.5 rounded-btn text-sm font-bold disabled:opacity-40 ${
                  iVoted ? "border border-border text-text-secondary" : "bg-accent text-white"
                }`}
              >
                {iVoted ? "Change your vote" : "Add your availability"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setView("create")}
              className={`w-full py-3.5 rounded-btn text-sm font-bold ${
                request ? "border border-accent text-accent-ink" : "bg-accent text-white"
              }`}
            >
              {request ? "Post new dates" : "Start a poll"}
            </button>
            <a href="/my-team/collect-availability"
              className="block w-full py-2 text-center text-xs font-medium text-text-secondary">
              Open full poll manager
            </a>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
