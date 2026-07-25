"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

// Invite teams to a tournament. Used by the organiser (hosting captain) on the
// tournament detail page and by the venue owner in the venue portal. Both can
// attach a discount off the per-team buy-in; the invited team's captain is
// notified and gets the reduced price when they join.

type TeamRow = { id: string; name: string; location: string | null; level: string | null; format: string | null; captain_id: string | null };

export default function TournamentInvitePanel({
  openMatchId,
  tournamentTitle,
  buyInPence,
  inviterUserId,
  inviterKind,
  inviterName,
  onClose,
  onSent,
}: {
  openMatchId: string;
  tournamentTitle: string;
  buyInPence: number;
  inviterUserId: string;
  inviterKind: "team" | "venue";
  inviterName: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [{ data: allTeams }, { data: joined }, { data: invited }] = await Promise.all([
        supabase.from("teams").select("id, name, location, level, format, captain_id").order("name"),
        supabase.from("open_match_teams").select("team_id").eq("open_match_id", openMatchId),
        supabase.from("tournament_invitations").select("team_id").eq("open_match_id", openMatchId),
      ]);
      const ex = new Set<string>([
        ...(joined ?? []).map((r) => r.team_id as string),
        ...(invited ?? []).map((r) => r.team_id as string),
      ]);
      setExcluded(ex);
      setTeams((allTeams ?? []) as TeamRow[]);
      setLoading(false);
    }
    load();
  }, [openMatchId]);

  const discountPence = Math.min(buyInPence, Math.max(0, Math.round(Number(discount || "0") * 100)));

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams
      .filter((t) => !excluded.has(t.id))
      .filter((t) => !q || `${t.name} ${t.location ?? ""} ${t.level ?? ""} ${t.format ?? ""}`.toLowerCase().includes(q));
  }, [teams, excluded, search]);

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const send = async () => {
    if (selected.size === 0) return;
    setBusy(true); setError(null);
    const picked = teams.filter((t) => selected.has(t.id));

    const invites = picked.map((t) => ({
      open_match_id: openMatchId,
      team_id: t.id,
      team_name: t.name,
      invited_by: inviterUserId,
      inviter_kind: inviterKind,
      discount_pence: discountPence,
      status: "pending",
    }));
    const { error: insErr } = await supabase.from("tournament_invitations")
      .upsert(invites, { onConflict: "open_match_id,team_id", ignoreDuplicates: true });
    if (insErr) {
      setBusy(false);
      setError(insErr.code === "42P01" ? "Run supabase_tournament_invitations.sql in Supabase first." : insErr.message);
      return;
    }

    // Notify each invited team's captain.
    const notifs = picked.filter((t) => t.captain_id).map((t) => ({
      user_id: t.captain_id,
      type: "tournament_invite",
      title: "Tournament invitation",
      body: `${inviterName} invited ${t.name} to ${tournamentTitle}${discountPence > 0 ? ` — £${(discountPence / 100).toFixed(2)} off the buy-in` : ""}`,
      link: `/play/tournament/${openMatchId}`,
    }));
    if (notifs.length) await supabase.from("notifications").insert(notifs);

    setSent(picked.length);
    setExcluded((prev) => new Set([...prev, ...picked.map((t) => t.id)]));
    setSelected(new Set());
    setBusy(false);
    onSent?.();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0">
          <div>
            <p className="font-bold">Invite teams</p>
            <p className="text-[11px] text-text-secondary">Good-fit teams for {tournamentTitle}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="px-5 pb-4 overflow-y-auto flex flex-col gap-3">
          {sent > 0 && (
            <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <p className="text-[11px] text-accent font-semibold">{sent} invitation{sent > 1 ? "s" : ""} sent.</p>
            </div>
          )}

          {/* Discount */}
          <div className="flex items-center gap-3 bg-surface-2 border border-border rounded-xl px-3 py-2.5">
            <div className="flex-1">
              <p className="text-xs font-semibold">Discount off buy-in</p>
              <p className="text-[10px] text-text-secondary">Buy-in £{(buyInPence / 100).toFixed(2)} · they pay £{((buyInPence - discountPence) / 100).toFixed(2)}</p>
            </div>
            <div className="relative w-24">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">£</span>
              <input type="number" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0"
                className="w-full bg-background border border-border rounded-lg pl-6 pr-2 py-2 text-sm outline-none focus:border-accent/50" />
            </div>
          </div>

          {/* Search */}
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teams by name, area, level…"
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />

          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* Team list */}
          {loading ? (
            <p className="text-xs text-text-secondary text-center py-6">Loading teams…</p>
          ) : available.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-6">No teams to invite{search ? " match your search." : "."}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {available.map((t) => {
                const on = selected.has(t.id);
                return (
                  <button key={t.id} onClick={() => toggle(t.id)}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? "bg-accent/10 border-accent" : "bg-background border-border"}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{t.name}</p>
                      <p className="text-[11px] text-text-secondary truncate">
                        {[t.location, t.level, t.format].filter(Boolean).join(" · ") || "No details"}
                      </p>
                    </div>
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${on ? "border-accent bg-accent" : "border-border"}`}>
                      {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex-shrink-0">
          <button onClick={send} disabled={busy || selected.size === 0}
            className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <><svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Sending…</>
              : selected.size > 0 ? `Send ${selected.size} invitation${selected.size > 1 ? "s" : ""}${discountPence > 0 ? ` · £${(discountPence / 100).toFixed(2)} off` : ""}`
              : "Select teams to invite"}
          </button>
        </div>
      </div>
    </div>
  );
}
