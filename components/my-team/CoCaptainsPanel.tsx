"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadSquadForAppointment, setCoCaptain, type CoCaptainRow,
} from "@/lib/team-leadership";

// ── Co-captains ─────────────────────────────────────────────────────────
// The captain's list of squad members, each with one switch: co-captain or
// not. A co-captain gets the captain's screens and the captain's authority —
// posting games, managing matches, picking line-ups, entering tournaments,
// spending team credit — with exactly one exception, which is this panel.
// Handing out authority stays with the person who was handed the team, so a
// co-captain never sees it (Team Settings renders the note below instead).
//
// The database enforces the same rule independently: set_co_captain refuses
// anyone but the captain, and a trigger refuses a direct write to the flag.
// This panel is the affordance, not the gate.

const MISSING_MIGRATION =
  "Co-captains aren't set up yet — run supabase_co_captains.sql in Supabase.";

export default function CoCaptainsPanel({ teamId }: { teamId: string }) {
  const [rows, setRows] = useState<CoCaptainRow[] | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await loadSquadForAppointment(teamId));
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(row: CoCaptainRow) {
    setBusyId(row.playerId);
    setError(null);
    const res = await setCoCaptain(teamId, row.playerId, !row.isCoCaptain);
    setBusyId(null);
    if (!res.ok) { setError(res.error ?? "Couldn't save that. Try again."); return; }
    // Optimistic-after-the-fact: the write succeeded, so flip the one row
    // rather than re-reading the whole squad.
    setRows((prev) => (prev ?? []).map((r) =>
      r.playerId === row.playerId ? { ...r, isCoCaptain: !r.isCoCaptain } : r));
  }

  const count = (rows ?? []).filter((r) => r.isCoCaptain).length;

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4 mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-bold">Co-captains</p>
        {count > 0 && (
          <span className="text-[11px] font-semibold text-text-secondary">{count} appointed</span>
        )}
      </div>
      <p className="text-xs text-text-secondary mb-3">
        A co-captain can do everything you can — post games, manage matches, pick line-ups,
        enter tournaments and spend team credit. The one thing they can&rsquo;t do is appoint
        other co-captains.
      </p>

      {rows === undefined && (
        <div className="py-6 flex justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      )}

      {rows === null && (
        <p className="text-xs text-text-secondary">{MISSING_MIGRATION}</p>
      )}

      {rows && rows.length === 0 && (
        <p className="text-xs text-text-secondary">
          Nobody in the squad yet. Approve a join request or share your invite link first.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.playerId} className="flex items-center gap-3 bg-surface-2 border border-border rounded-btn px-3 py-2.5">
              <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                {r.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 flex items-center gap-[7px]">
                <p className="text-sm font-semibold truncate">{r.name}</p>
                {r.isCoCaptain && (
                  <span className="text-[9px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[5px] bg-[#E7F8EC] text-accent-ink border border-[#B7E8C6] flex-shrink-0">VC</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => toggle(r)}
                disabled={busyId === r.playerId}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border flex-shrink-0 disabled:opacity-50 ${
                  r.isCoCaptain
                    ? "border-border bg-surface text-text-secondary"
                    : "border-accent bg-accent text-white"
                }`}
              >
                {busyId === r.playerId ? "Saving…" : r.isCoCaptain ? "Remove" : "Make co-captain"}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-btn px-3 py-2.5 mt-3">{error}</p>
      )}
    </div>
  );
}
