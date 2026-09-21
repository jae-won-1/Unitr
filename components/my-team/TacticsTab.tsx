"use client";

// ── Tactics ───────────────────────────────────────────────────────────
// A team's library of saved setups. Previously this was one tactics blob in
// localStorage (contexts/TacticsContext), which meant a captain's work lived in
// their own browser and no player ever saw it. Now it's team_tactics rows: as
// many named presets as the situation calls for — "High press", "See out a 1-0",
// "Corner routine" — visible to the whole squad and pullable into any fixture
// from Manage Match > Tactics.
//
// A preset holds shape, instructions, and — optionally — the players in it.
// Naming players was left out at first because a preset outlives any given squad
// list and a transfer would quietly corrupt the plan. It's in now because a shape
// with nobody in it isn't the tactic a captain actually has in mind, and the
// corruption worry is handled by resolving every assigned id against the CURRENT
// squad at render time: somebody who has left leaves an empty slot, never a ghost
// name, and re-saving drops them.
//
// Captains author. Players read.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  slotsFor, PLAY_STYLES, PRESSING_LEVELS, TACTIC_SITUATIONS,
  TEAM_SIZES, formationKeysFor, defaultFormationFor, sizeOfFormation,
  teamSizeFromFormat, formatLabelForSize, type TeamSize,
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
  /** { [formationSlotIndex]: player_id } — the same shape as match_tactics.lineup,
   *  so loading a preset into a fixture is a straight copy. */
  lineup: Record<number, string>;
};

const MISSING_TABLE_MSG = "Saved tactics aren't set up yet — run supabase_team_tactics.sql.";

/** Shared with Manage Match's "load from saved" picker. */
export async function loadTeamTactics(teamId: string): Promise<TeamTactic[] | null> {
  const { data, error } = await supabase
    .from("team_tactics")
    .select("id, team_id, title, situation, formation, style, pressing, notes, lineup")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  // null means "the table isn't there", which the caller renders as a disabled
  // explanation. An empty array means "no presets yet" — a different message.
  if (error) return null;
  return ((data ?? []) as TeamTactic[]).map((t) => ({ ...t, lineup: t.lineup ?? {} }));
}

// ── The squad a preset can name ───────────────────────────────────────
export type SquadOption = { id: string; name: string; position: string | null };

/**
 * Everyone who could be put on the board: the captain plus every approved
 * member. The captain has no team_members row of their own, so they're fetched
 * and prepended — and teams.captain_id → profiles has no registered FK, so that
 * has to be a second query rather than an embedded select.
 */
export async function loadSquadOptions(teamId: string): Promise<SquadOption[]> {
  const { data: team } = await supabase
    .from("teams").select("captain_id").eq("id", teamId).maybeSingle();
  const { data: rows } = await supabase
    .from("team_members")
    .select("player_id, profiles(full_name, position)")
    .eq("team_id", teamId)
    .eq("status", "approved");

  const out: SquadOption[] = [];
  if (team?.captain_id) {
    const { data: cap } = await supabase
      .from("profiles").select("full_name, position").eq("id", team.captain_id).maybeSingle();
    out.push({ id: team.captain_id, name: cap?.full_name ?? "Captain", position: cap?.position ?? null });
  }
  const members = (rows ?? []) as unknown as {
    player_id: string; profiles: { full_name: string | null; position: string | null } | null;
  }[];
  for (const r of members) {
    if (r.player_id === team?.captain_id) continue;
    out.push({ id: r.player_id, name: r.profiles?.full_name ?? "Player", position: r.profiles?.position ?? null });
  }
  return out;
}

// ── Pitch board ───────────────────────────────────────────────────────
// Same construction as the fixture lineup boards (Manage Match, Manage
// Tournament Fixture): an SVG for the markings, HTML buttons positioned over it
// for the players, so a slot is a real tap target rather than a 5px circle.
function LineupBoard({
  formation, lineup, nameById, onSlotTap,
}: {
  formation: string;
  lineup: Record<number, string>;
  /** Names of players still in the squad. An id missing here renders empty. */
  nameById: Map<string, string>;
  onSlotTap?: (slot: number) => void;
}) {
  // A preset carries no size of its own — the formation key is the size, since
  // keys are unique across them. A 2-3-1 board gets seven dots, not eleven.
  const slots = slotsFor(formation, sizeOfFormation(formation));
  return (
    <div
      className="relative w-full rounded-xl overflow-hidden"
      style={{ paddingBottom: "130%", background: "linear-gradient(180deg,#1a5c1a 0%,#1e6b1e 25%,#1a5c1a 50%,#1e6b1e 75%,#1a5c1a 100%)" }}
    >
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
        <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <rect x="22" y="5" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <rect x="22" y="107" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
      </svg>
      {slots.map((pos, i) => {
        const name = nameById.get(lineup[i] ?? "") ?? "";
        const initials = name ? name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "";
        return (
          <button
            key={i} type="button" disabled={!onSlotTap}
            onClick={() => onSlotTap?.(i)}
            className="absolute flex flex-col items-center gap-0.5"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg border-2 ${
              name ? "bg-white border-white/80" : "bg-black/30 border-dashed border-white/50"}`}>
              <span className={`text-[10px] font-bold leading-none ${name ? "text-text-primary" : "text-white/80"}`}>
                {name ? initials : pos.position}
              </span>
            </div>
            <span className="text-[9px] font-semibold text-white drop-shadow-md bg-black/40 rounded px-1 truncate max-w-[52px] text-center">
              {name ? name.split(" ")[0] : pos.position}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Player picker ─────────────────────────────────────────────────────
// z-[70], not the house z-[60]: this one opens on top of the editor sheet,
// which is itself z-[60], and at equal z it would paint underneath it.
function SlotPicker({
  slots, squad, lineup, slot, onPick, onClear, onClose,
}: {
  slots: { position: string }[];
  squad: SquadOption[];
  lineup: Record<number, string>;
  slot: number;
  onPick: (playerId: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  // The scrim stops propagation as well as closing: this renders inside the
  // editor sheet, whose own scrim would otherwise close the editor underneath.
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-scrim"
      onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl max-h-[70dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="p-4 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between flex-shrink-0">
            <p className="font-bold text-base">Assign {slots[slot]?.position}</p>
            <button type="button" onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto">
            {lineup[slot] && (
              <button type="button" onClick={onClear}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-red-500/30 text-red-600 text-sm font-semibold">
                Clear this position
              </button>
            )}
            {squad.length === 0 && (
              <p className="text-sm text-text-secondary py-2">No squad members yet — approve some players first.</p>
            )}
            {squad.map((p) => {
              const assignedEntry = Object.entries(lineup).find(([, pid]) => pid === p.id);
              const here = assignedEntry !== undefined && Number(assignedEntry[0]) === slot;
              const init = p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
              return (
                <button key={p.id} type="button" onClick={() => onPick(p.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left ${
                    here ? "bg-accent/10 border-accent" : "bg-surface-2 border-border"}`}>
                  <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{p.name}</p>
                    {p.position && <p className="text-[11px] text-text-secondary">{p.position}</p>}
                  </div>
                  {assignedEntry !== undefined && (
                    <span className="text-[10px] text-text-secondary flex-shrink-0">
                      {here ? "Here" : slots[Number(assignedEntry[0])]?.position}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────
function TacticEditor({
  teamId, userId, existing, teamSize, squad, onDone, onCancel,
}: {
  teamId: string;
  userId: string;
  existing: TeamTactic | null;
  /** The team's own format, which a new setup starts on. */
  teamSize: TeamSize;
  squad: SquadOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [situation, setSituation] = useState(existing?.situation ?? "");
  // A team mostly plays one size, so that's where a new setup starts — but a
  // squad that plays 11s all season still enters the odd 7-a-side tournament,
  // so the size is a choice rather than a fact about the team.
  const [size, setSize] = useState<TeamSize>(
    existing ? sizeOfFormation(existing.formation) : teamSize
  );
  const [formation, setFormation] = useState(existing?.formation ?? defaultFormationFor(teamSize));
  const [style, setStyle] = useState<string | null>(existing?.style ?? null);
  const [pressing, setPressing] = useState<string | null>(existing?.pressing ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [lineup, setLineup] = useState<Record<number, string>>(existing?.lineup ?? {});
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = slotsFor(formation, size);
  const nameById = new Map(squad.map((p) => [p.id, p.name]));
  // Only slots that exist on this board, and only players still in the squad —
  // what the captain is looking at is what gets written.
  const visibleLineup = Object.fromEntries(
    Object.entries(lineup).filter(([i, pid]) => Number(i) < slots.length && nameById.has(pid))
  ) as Record<number, string>;
  const assignedCount = Object.keys(visibleLineup).length;

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
      // A squad that failed to load would otherwise wipe a lineup the captain
      // never touched, so the pruned version is only trusted when there is one.
      lineup: squad.length > 0 ? visibleLineup : lineup,
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
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Match size</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {TEAM_SIZES.map((n) => (
                <button key={n} type="button"
                  // A lineup is keyed by slot index, and a different size is a
                  // different board — carrying the old indexes over would move
                  // players to positions nobody picked.
                  onClick={() => { setSize(n); setFormation(defaultFormationFor(n)); setLineup({}); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    size === n ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {formatLabelForSize(n)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Formation</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {formationKeysFor(size).map((f) => (
                <button key={f} type="button" onClick={() => setFormation(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    formation === f ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                {assignedCount} of {slots.length} assigned
              </span>
              <span className="text-[10px] text-text-secondary">Tap a position to assign</span>
            </div>
            <LineupBoard
              formation={formation} lineup={visibleLineup} nameById={nameById}
              onSlotTap={setPickerSlot}
            />
            {assignedCount > 0 && (
              <button type="button" onClick={() => setLineup({})}
                className="mt-2 text-[11px] font-semibold text-text-secondary underline">
                Clear all players
              </button>
            )}
            <p className="text-[11px] text-text-secondary mt-2">
              Optional — a setup saved with players in it loads them straight onto a fixture&apos;s
              lineup board, minus anyone unavailable for that game.
            </p>
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

      {pickerSlot !== null && (
        <SlotPicker
          slots={slots} squad={squad} lineup={visibleLineup} slot={pickerSlot}
          onPick={(playerId) => {
            setLineup((prev) => {
              const next = { ...prev };
              // One slot per player — drop any prior slot they held.
              for (const k of Object.keys(next)) if (next[Number(k)] === playerId) delete next[Number(k)];
              next[pickerSlot] = playerId;
              return next;
            });
            setPickerSlot(null);
          }}
          onClear={() => {
            setLineup((prev) => { const next = { ...prev }; delete next[pickerSlot]; return next; });
            setPickerSlot(null);
          }}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────
function TacticCard({
  tactic, isCaptain, nameById, onEdit, onDelete,
}: {
  tactic: TeamTactic;
  isCaptain: boolean;
  /** Current squad. A player who has left resolves to nothing and their slot
   *  reads as unfilled, rather than the preset naming somebody who's gone. */
  nameById: Map<string, string>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const assigned = Object.values(tactic.lineup).filter((pid) => nameById.has(pid)).length;
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
            {[formatLabelForSize(sizeOfFormation(tactic.formation)), tactic.formation, tactic.style,
              tactic.pressing && `${tactic.pressing} press`,
              assigned > 0 && `${assigned} named`].filter(Boolean).join(" · ")}
          </p>
        </button>
        <span className="text-text-secondary text-xs flex-shrink-0 mt-1">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          <LineupBoard formation={tactic.formation} lineup={tactic.lineup} nameById={nameById} />
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
  const [teamSize, setTeamSize] = useState<TeamSize>(teamSizeFromFormat(null));
  const [squad, setSquad] = useState<SquadOption[]>([]);

  const load = useCallback(async () => {
    const rows = await loadTeamTactics(teamId);
    if (rows === null) setUnavailable(true);
    else { setTactics(rows); setUnavailable(false); }
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  // The team's own format only seeds a NEW setup's size — it never rewrites a
  // saved one, whose size is whatever formation the captain picked.
  useEffect(() => {
    supabase.from("teams").select("format").eq("id", teamId).maybeSingle()
      .then(({ data }) => setTeamSize(teamSizeFromFormat(data?.format)));
  }, [teamId]);

  useEffect(() => { loadSquadOptions(teamId).then(setSquad); }, [teamId]);

  const nameById = new Map(squad.map((p) => [p.id, p.name]));

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
              key={t.id} tactic={t} isCaptain={isCaptain} nameById={nameById}
              onEdit={() => setEditing(t)}
              onDelete={() => remove(t.id)}
            />
          ))}
        </div>
      )}

      {editing !== undefined && (
        <TacticEditor
          teamId={teamId} userId={userId} existing={editing} teamSize={teamSize} squad={squad}
          onDone={() => { setEditing(undefined); load(); }}
          onCancel={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
