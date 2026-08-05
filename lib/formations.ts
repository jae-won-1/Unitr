// ── Formations ────────────────────────────────────────────────────────
// The single source of truth for pitch layouts. This used to be copy-pasted
// into app/my-team/tactics/page.tsx and app/my-team/match/[matchId]/page.tsx,
// and the two copies had already drifted: they listed the formations in a
// different order, and 3-5-2's middle midfielder was labelled CM in one and
// CDM in the other.
//
// That drift was dangerous rather than cosmetic. A saved lineup is
// `{ [slotIndex]: player_id }` — an INDEX into the array below, not a position
// name — so a lineup written against one copy is read back against whichever
// copy the reading page imported. Reordering slots within a formation would
// silently move every player already assigned in every saved lineup, in both
// match_tactics and team_tactics.
//
// So: adding a new formation key is safe. Editing x/y or a label is safe.
// REORDERING the entries inside a formation array is not — it rewrites history.

export type FormationSlot = { position: string; x: number; y: number };

export const FORMATIONS: Record<string, FormationSlot[]> = {
  "4-3-3": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 25, y: 52 }, { position: "CM", x: 50, y: 50 }, { position: "CM", x: 75, y: 52 },
    { position: "LW", x: 15, y: 28 }, { position: "ST", x: 50, y: 22 }, { position: "RW", x: 85, y: 28 },
  ],
  "4-4-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "LM", x: 15, y: 50 }, { position: "CM", x: 35, y: 50 }, { position: "CM", x: 65, y: 50 }, { position: "RM", x: 85, y: 50 },
    { position: "ST", x: 35, y: 22 }, { position: "ST", x: 65, y: 22 },
  ],
  "4-2-3-1": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CDM", x: 35, y: 55 }, { position: "CDM", x: 65, y: 55 },
    { position: "LW", x: 18, y: 36 }, { position: "CAM", x: 50, y: 36 }, { position: "RW", x: 82, y: 36 },
    { position: "ST", x: 50, y: 18 },
  ],
  // The deeper middle man is a CDM — that was the tactics page's label, and it
  // matches where the dot actually sits (y: 55, behind the two CMs).
  "3-5-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "CB", x: 25, y: 72 }, { position: "CB", x: 50, y: 74 }, { position: "CB", x: 75, y: 72 },
    { position: "LWB", x: 10, y: 52 }, { position: "CM", x: 30, y: 50 }, { position: "CDM", x: 50, y: 55 }, { position: "CM", x: 70, y: 50 }, { position: "RWB", x: 90, y: 52 },
    { position: "ST", x: 35, y: 22 }, { position: "ST", x: 65, y: 22 },
  ],
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);

export const DEFAULT_FORMATION = "4-3-3";

/** Slots for a formation, falling back to 4-3-3 if a stored key is unknown. */
export function slotsFor(formation: string): FormationSlot[] {
  return FORMATIONS[formation] ?? FORMATIONS[DEFAULT_FORMATION];
}

// Play style and pressing options — previously inline in the tactics page.
export const PLAY_STYLES = ["Possession", "Counter-Attack", "High Press", "Direct Play"];
export const PRESSING_LEVELS = ["Low", "Medium", "High"];

// Situations a saved preset can be filed under. Free text in the DB — these are
// just the suggestions the UI offers as chips.
export const TACTIC_SITUATIONS = ["Pressing", "Set Piece", "Defensive", "Offensive", "Custom"];
