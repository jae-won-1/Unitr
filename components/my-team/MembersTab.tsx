"use client";

// ── Members ───────────────────────────────────────────────────────────
// Squad · Scout · Watchlist — the three states a player can be in relative to
// this team: in it, out there somewhere, or being thought about.
//
// The Watchlist is the genuinely new one. Scouting in the Transfer Market is a
// browsing session and signing is a decision made days later, usually after
// watching someone play. Until now there was nothing in between, so a captain
// either sent an offer on impulse or lost the name. Watchlisting is private —
// the player is never told — which is exactly why it's safe to be indecisive on.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { sendOffer } from "@/lib/transfer-market";
import { loadSquadStats, emptyPlayerStats, type PlayerStats } from "@/lib/stats";

type SubTab = "squad" | "scout" | "watchlist";

type Member = { id: string; name: string; position: string | null; experience: string | null; isCaptain: boolean; stats: PlayerStats };
type WatchRow = { id: string; playerId: string; name: string; position: string | null; note: string | null };

const MISSING_TABLE_MSG = "The watchlist isn't set up yet — run supabase_player_watchlist.sql.";

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-xs font-bold flex-shrink-0">
      {name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
    </div>
  );
}

// ── Squad ─────────────────────────────────────────────────────────────
function SquadList({ teamId }: { teamId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const squadStats = await loadSquadStats(teamId);

      const { data: team } = await supabase.from("teams").select("captain_id").eq("id", teamId).maybeSingle();
      // teams.captain_id → profiles has no registered FK, so an embedded select
      // fails the whole query with PGRST200. Fetch and merge instead.
      const { data: rows } = await supabase
        .from("team_members")
        .select("player_id, profiles(full_name, position, experience)")
        .eq("team_id", teamId)
        .eq("status", "approved");

      const out: Member[] = [];
      if (team?.captain_id) {
        const { data: cap } = await supabase
          .from("profiles").select("full_name, position, experience").eq("id", team.captain_id).maybeSingle();
        out.push({
          id: team.captain_id,
          name: cap?.full_name ?? "Captain",
          position: cap?.position ?? null,
          experience: cap?.experience ?? null,
          isCaptain: true,
          stats: squadStats.get(team.captain_id) ?? emptyPlayerStats(team.captain_id),
        });
      }
      for (const r of (rows ?? []) as unknown as { player_id: string; profiles: { full_name: string; position: string | null; experience: string | null } | null }[]) {
        if (r.player_id === team?.captain_id) continue;   // captain already added
        out.push({
          id: r.player_id,
          name: r.profiles?.full_name ?? "Player",
          position: r.profiles?.position ?? null,
          experience: r.profiles?.experience ?? null,
          isCaptain: false,
          stats: squadStats.get(r.player_id) ?? emptyPlayerStats(r.player_id),
        });
      }

      if (cancelled) return;
      setMembers(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  if (loading) return <div className="py-8 flex justify-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  if (members.length === 0) {
    return (
      <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
        <p className="text-sm font-semibold mb-1">No squad members yet</p>
        <p className="text-xs text-text-secondary">Approved players show up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">{members.length} player{members.length === 1 ? "" : "s"}</p>
      {members.map((m) => (
        <div key={m.id} className="bg-surface-2 border border-border rounded-xl p-3 flex items-center gap-3">
          <Avatar name={m.name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate">{m.name}</p>
              {m.isCaptain && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 flex-shrink-0">C</span>
              )}
            </div>
            <p className="text-[11px] text-text-secondary">
              {[m.position, m.experience].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="flex gap-3 text-center flex-shrink-0">
            <div><p className="text-sm font-bold">{m.stats.goals}</p><p className="text-[9px] text-text-secondary">G</p></div>
            <div><p className="text-sm font-bold">{m.stats.assists}</p><p className="text-[9px] text-text-secondary">A</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Watchlist ─────────────────────────────────────────────────────────
function Watchlist({ teamId, userId, isCaptain }: { teamId: string; userId: string; isCaptain: boolean }) {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("player_watchlist")
      .select("id, player_id, note")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false });

    if (error) { setUnavailable(true); setLoading(false); return; }

    // player_watchlist.player_id → auth.users, not profiles, so there's no FK to
    // embed across. Names come from a second query.
    const ids = (data ?? []).map((r) => r.player_id);
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id, full_name, position").in("id", ids)
      : { data: [] };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    setRows((data ?? []).map((r) => ({
      id: r.id,
      playerId: r.player_id,
      name: byId.get(r.player_id)?.full_name ?? "Player",
      position: byId.get(r.player_id)?.position ?? null,
      note: r.note,
    })));
    setUnavailable(false);
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    await supabase.from("player_watchlist").delete().eq("id", id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function offer(playerId: string) {
    setBusyId(playerId);
    await sendOffer(teamId, userId, playerId, null);
    setSent((prev) => new Set(prev).add(playerId));
    setBusyId(null);
  }

  if (loading) return <div className="py-8 flex justify-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  if (!isCaptain) {
    return (
      <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
        <p className="text-sm font-semibold mb-1">Captain only</p>
        <p className="text-xs text-text-secondary">Scouting notes stay with whoever picks the squad.</p>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
        <p className="text-sm font-semibold mb-1">Not set up yet</p>
        <p className="text-xs text-text-secondary">{MISSING_TABLE_MSG}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
        <p className="text-sm font-semibold mb-1">Nobody on the watchlist</p>
        <p className="text-xs text-text-secondary mb-4">Save players from the Transfer Market and decide later. They&apos;re never notified.</p>
        <a href="/my-team/transfer" className="inline-block px-5 py-2.5 rounded-xl bg-accent text-black font-bold text-xs">Go Scouting</a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="bg-surface-2 border border-border rounded-xl p-3">
          <div className="flex items-center gap-3">
            <Avatar name={r.name} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{r.name}</p>
              <p className="text-[11px] text-text-secondary">{r.position ?? "—"}</p>
            </div>
          </div>
          {r.note && <p className="text-[11px] text-text-secondary mt-2 italic">{r.note}</p>}
          <div className="flex gap-2 mt-3">
            <button type="button" disabled={busyId === r.playerId || sent.has(r.playerId)} onClick={() => offer(r.playerId)}
              className="flex-1 py-2 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-50">
              {sent.has(r.playerId) ? "Offer sent" : busyId === r.playerId ? "Sending…" : "Send offer"}
            </button>
            <button type="button" onClick={() => remove(r.id)}
              className="px-3 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary">
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MembersTab({
  teamId, userId, isCaptain,
}: {
  teamId: string;
  userId: string;
  isCaptain: boolean;
}) {
  const [sub, setSub] = useState<SubTab>("squad");

  return (
    <div className="space-y-4">
      <div className="flex bg-surface-2 border border-border rounded-lg p-0.5 gap-0.5">
        {([["squad", "Squad"], ["scout", "Scout"], ["watchlist", "Watchlist"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              sub === k ? "bg-accent text-black" : "text-text-secondary"}`}>
            {label}
          </button>
        ))}
      </div>

      {sub === "squad" && <SquadList teamId={teamId} />}

      {sub === "scout" && (
        isCaptain ? (
          <div className="space-y-3">
            <a href="/my-team/transfer" className="block bg-surface-2 border border-border rounded-2xl p-4">
              <p className="text-sm font-bold mb-0.5">Transfer Market</p>
              <p className="text-xs text-text-secondary">Search free agents and other teams, send offers, review join requests.</p>
            </a>
            <a href="/search" className="block bg-surface-2 border border-border rounded-2xl p-4">
              <p className="text-sm font-bold mb-0.5">Search</p>
              <p className="text-xs text-text-secondary">Find a specific player or team by name.</p>
            </a>
          </div>
        ) : (
          // Greyed, not hidden — the tab keeps its shape so the layout doesn't
          // shift for players, and they can see recruitment is a thing.
          <div className="space-y-3">
            <div className="bg-surface-2 border border-border rounded-2xl p-4 opacity-40">
              <p className="text-sm font-bold mb-0.5">Transfer Market</p>
              <p className="text-xs text-text-secondary">Search free agents and other teams, send offers.</p>
            </div>
            <p className="text-xs text-text-secondary text-center">Only your captain can recruit for the team.</p>
          </div>
        )
      )}

      {sub === "watchlist" && <Watchlist teamId={teamId} userId={userId} isCaptain={isCaptain} />}
    </div>
  );
}
