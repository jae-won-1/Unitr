"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Captain-side view of the availability poll: how many of the squad have
// replied, and how the votes fall across each date option. Opens as a popup so
// the captain can check the poll without leaving home.

type DateOption = { id: string; date: string; time: string; dayName: string };
type Request = { id: string; date_options: DateOption[] };

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

export function usePollStatus(teamId: string | null) {
  const [request, setRequest] = useState<Request | null>(null);
  const [responses, setResponses] = useState<{ available_date_ids: string[] }[]>([]);
  const [squadSize, setSquadSize] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId) { setLoading(false); return; }
    const { data: req } = await supabase.from("availability_requests")
      .select("id, date_options")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    if (!req || isPollExpired(req.date_options as DateOption[])) {
      setRequest(null); setResponses([]); setLoading(false); return;
    }

    const [{ data: resps }, { count }] = await Promise.all([
      supabase.from("availability_responses").select("available_date_ids").eq("request_id", req.id),
      supabase.from("team_members").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("status", "approved"),
    ]);

    setRequest(req as Request);
    setResponses(resps ?? []);
    setSquadSize((count ?? 0) + 1); // the captain isn't a team_members row
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  return { request, responses, squadSize, loading, reload: load };
}

export default function PollStatusTile({ teamId }: { teamId: string | null }) {
  const { request, responses, squadSize, loading } = usePollStatus(teamId);
  const [open, setOpen] = useState(false);

  const replied = responses.length;
  const waiting = Math.max(0, squadSize - replied);

  return (
    <>
      <button
        type="button"
        onClick={() => request && setOpen(true)}
        disabled={!request}
        className={`w-full rounded-2xl p-4 text-left border transition-colors ${
          request ? "bg-surface-2 border-border" : "bg-surface-2 border-border opacity-60 cursor-default"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Availability Poll</p>
            <p className="text-[11px] text-text-secondary mt-0.5">
              {loading ? "Checking…"
                : !request ? "No poll running · collect availability to start one"
                : `${replied} of ${squadSize} replied${waiting > 0 ? ` · waiting on ${waiting}` : " · all in"}`}
            </p>
          </div>
          {request && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 border ${
              waiting > 0
                ? "bg-orange-500/10 text-orange-400 border-orange-500/30"
                : "bg-accent/10 text-accent border-accent/30"
            }`}>
              {waiting > 0 ? `${waiting} left` : "Complete"}
            </span>
          )}
        </div>
      </button>

      {open && request && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm bg-[#141414] border border-border rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-lg">Availability Poll</p>
              <button onClick={() => setOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              {replied} of {squadSize} replied{waiting > 0 ? ` · still waiting on ${waiting}` : ""}
            </p>

            <div className="space-y-2 mb-4">
              {request.date_options.map((opt) => {
                const votes = responses.filter((r) => r.available_date_ids.includes(opt.id)).length;
                const pct = replied > 0 ? Math.round((votes / replied) * 100) : 0;
                return (
                  <div key={opt.id} className="bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold">{opt.dayName} · {opt.time}</p>
                      <span className="text-xs font-bold text-accent">{votes} vote{votes !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full">
                      <div className="h-1.5 bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1">{opt.date}</p>
                  </div>
                );
              })}

              {(() => {
                const none = responses.filter((r) => r.available_date_ids.length === 0).length;
                const pct = replied > 0 ? Math.round((none / replied) * 100) : 0;
                return (
                  <div className="bg-surface-2 border border-border rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold text-text-secondary">Unavailable for any of these dates</p>
                      <span className="text-xs font-bold text-red-400">{none} vote{none !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full">
                      <div className="h-1.5 bg-red-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}

              {replied === 0 && <p className="text-xs text-text-secondary py-1">No responses yet.</p>}
            </div>

            <a href="/my-team/collect-availability"
              className="block w-full py-3 rounded-xl border border-accent/40 text-accent text-sm font-bold text-center">
              Manage poll
            </a>
          </div>
        </div>
      )}
    </>
  );
}
