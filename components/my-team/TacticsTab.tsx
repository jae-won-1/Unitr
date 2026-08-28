"use client";

// ── Tactics ───────────────────────────────────────────────────────────
// A team's library of saved setups. Previously this was one tactics blob in
// localStorage (contexts/TacticsContext), which meant a captain's work lived in
// their own browser and no player ever saw it. Now it's team_tactics rows: as
// many named presets as the situation calls for — "High press", "See out a 1-0",
// "Corner routine" — visible to the whole squad and pullable into any fixture
// from Manage Match > Tactics.
//
// Presets hold shape and instructions, not players. A preset outlives any given
// squad list, and pinning names into it would mean every transfer quietly
// corrupted the plan. Player assignment happens per-fixture, on the lineup board.
//
// Captains author. Players read.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  FORMATION_KEYS, DEFAULT_FORMATION, slotsFor,
  PLAY_STYLES, PRESSING_LEVELS, TACTIC_SITUATIONS,
} from "@/lib/formations";

export type TeamTactic = {
  id: string;
  team_id: string;
  title: string;
  situation: string | null;
  formation: string;
  style: string | null;
  pressing: string | null;
  notes: string | null;
};

const MISSING_TABLE_MSG = "Saved tactics aren't set up yet — run supabase_team_tactics.sql.";

/** Shared with Manage Match's "load from saved" picker. */
export async function loadTeamTactics(teamId: string): Promise<TeamTactic[] | null> {
  const { data, error } = await supabase
    .from("team_tactics")
    .select("id, team_id, title, situation, formation, style, pressing, notes")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  // null means "the table isn't there", which the caller renders as a disabled
  // explanation. An empty array means "no presets yet" — a different message.
  if (error) return null;
  return (data ?? []) as TeamTactic[];
}

// ── Pitch preview ─────────────────────────────────────────────────────
function PitchPreview({ formation }: { formation: string }) {
  const slots = slotsFor(formation);
  return (
    <svg viewBox="0 0 100 130" className="w-full rounded-xl bg-[#0d2818] border border-border">
      <rect x="1" y="1" width="98" height="128" fill="none" stroke="#2a4a35" strokeWidth="0.5" />
      <line x1="1" y1="65" x2="99" y2="65" stroke="#2a4a35" strokeWidth="0.5" />
      <circle cx="50" cy="65" r="12" fill="none" stroke="#2a4a35" strokeWidth="0.5" />
      <rect x="30" y="1" width="40" height="16" fill="none" stroke="#2a4a35" strokeWidth="0.5" />
      <rect x="30" y="113" width="40" height="16" fill="none" stroke="#2a4a35" strokeWidth="0.5" />
      {slots.map((s, i) => (
        <g key={i}>
          <circle cx={s.x} cy={(s.y / 100) * 130} r="5" fill="#0E7A3C" />
          <text x={s.x} y={(s.y / 100) * 130 + 1.8} textAnchor="middle" fontSize="3.4" fontWeight="700" fill="#000">
            {s.position}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Editor ────────────────────────────────────────────────────────────
function TacticEditor({
  teamId, userId, existing, onDone, onCancel,
}: {
  teamId: string;
  userId: string;
  existing: TeamTactic | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [situation, setSituation] = useState(existing?.situation ?? "");
  const [formation, setFormation] = useState(existing?.formation ?? DEFAULT_FORMATION);
  const [style, setStyle] = useState<string | null>(existing?.style ?? null);
  const [pressing, setPressing] = useState<string | null>(existing?.pressing ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setError("Give this setup a name so you can find it later."); return; }
    setBusy(true);
    setError(null);

    const payload = {
      team_id: teamId,
      title: title.trim(),
      situation: situation || null,
      formation,
      style,
      pressing,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error: err } = existing
      ? await supabase.from("team_tactics").update(payload).eq("id", existing.id)
      : await supabase.from("team_tactics").insert({ ...payload, created_by: userId });

    setBusy(false);
    if (err) {
      // The unique index on (team_id, title) is what a captain will hit most.
      setError(err.code === "23505" ? "You already have a setup with that name." : err.message);
      return;
    }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={onCancel}>
      <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl max-h-[88dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="p-4 space-y-4">
          <h3 className="text-base font-bold">{existing ? "Edit setup" : "New setup"}</h3>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Name</label>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. High press vs weak keeper"
              className="w-full bg-surface border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Situation</label>
            <div className="flex flex-wrap gap-2">
              {TACTIC_SITUATIONS.map((s) => (
                <button key={s} type="button" onClick={() => setSituation(situation === s ? "" : s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    situation === s ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Formation</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {FORMATION_KEYS.map((f) => (
                <button key={f} type="button" onClick={() => setFormation(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    formation === f ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {f}
                </button>
              ))}
            </div>
            <PitchPreview formation={formation} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Play style</label>
            <div className="flex flex-wrap gap-2">
              {PLAY_STYLES.map((s) => (
                <button key={s} type="button" onClick={() => setStyle(style === s ? null : s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    style === s ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Pressing</label>
            <div className="flex gap-2">
              {PRESSING_LEVELS.map((p) => (
                <button key={p} type="button" onClick={() => setPressing(pressing === p ? null : p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    pressing === p ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Instructions</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
              placeholder="What the squad needs to do differently in this setup."
              className="w-full bg-surface border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-accent resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pb-2">
            <button type="button" onClick={onCancel} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={busy} className="flex-1 py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-60">
              {busy ? "Saving…" : "Save setup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────
function TacticCard({
  tactic, isCaptain, onEdit, onDelete,
}: {
  tactic: TeamTactic;
  isCaptain: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 text-left flex-1">
          {tactic.situation && (
            <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border mb-1.5 bg-accent/10 text-accent-ink border-accent/20">
              {tactic.situation}
            </span>
          )}
          <p className="text-sm font-bold truncate">{tactic.title}</p>
          <p className="text-xs text-text-secondary mt-0.5">
            {[tactic.formation, tactic.style, tactic.pressing && `${tactic.pressing} press`].filter(Boolean).join(" · ")}
          </p>
        </button>
        <span className="text-text-secondary text-xs flex-shrink-0 mt-1">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          <PitchPreview formation={tactic.formation} />
          {tactic.notes && <p className="text-xs text-text-secondary whitespace-pre-wrap">{tactic.notes}</p>}
          {isCaptain && (
            <div className="flex gap-2">
              <button type="button" onClick={onEdit} className="flex-1 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary">
                Edit
              </button>
              <button type="button" onClick={onDelete} className="flex-1 py-2 rounded-lg border border-red-500/30 text-xs font-semibold text-red-600">
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TacticsTab({
  teamId, userId, isCaptain,
}: {
  teamId: string;
  userId: string;
  isCaptain: boolean;
}) {
  const [tactics, setTactics] = useState<TeamTactic[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TeamTactic | null | undefined>(undefined); // undefined = closed

  const load = useCallback(async () => {
    const rows = await loadTeamTactics(teamId);
    if (rows === null) setUnavailable(true);
    else { setTactics(rows); setUnavailable(false); }
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    await supabase.from("team_tactics").delete().eq("id", id);
    setTactics((prev) => prev.filter((t) => t.id !== id));
  }

  if (loading) {
    return <div className="py-12 flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold mb-0.5">Saved setups</h2>
          <p className="text-xs text-text-secondary">
            {isCaptain
              ? "Build a setup once, then pull it into any fixture."
              : "How your captain wants the team to play in different situations."}
          </p>
        </div>
        {/* Greyed rather than hidden — a player should see that setups get
            authored, and by whom, even though they can't author one. */}
        <button
          type="button"
          disabled={!isCaptain || unavailable}
          onClick={() => setEditing(null)}
          title={!isCaptain ? "Only the captain can create setups" : unavailable ? MISSING_TABLE_MSG : undefined}
          className="flex-shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + New
        </button>
      </div>

      {unavailable ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
          <p className="text-sm font-semibold mb-1">Not set up yet</p>
          <p className="text-xs text-text-secondary">{MISSING_TABLE_MSG}</p>
        </div>
      ) : tactics.length === 0 ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
          <p className="text-sm font-semibold mb-1">No setups saved</p>
          <p className="text-xs text-text-secondary">
            {isCaptain
              ? "Save your pressing shape, a set-piece routine, or how you see out a lead."
              : "Your captain hasn't saved any setups yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tactics.map((t) => (
            <TacticCard
              key={t.id} tactic={t} isCaptain={isCaptain}
              onEdit={() => setEditing(t)}
              onDelete={() => remove(t.id)}
            />
          ))}
        </div>
      )}

      {editing !== undefined && (
        <TacticEditor
          teamId={teamId} userId={userId} existing={editing}
          onDone={() => { setEditing(undefined); load(); }}
          onCancel={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
