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
//
// Formations are grouped by TEAM SIZE (players per side, keeper included),
// because a lineup page that asks a 5-a-side captain to fill eleven slots is
// asking the wrong question. Keys are unique across sizes, so a stored
// formation string still identifies exactly one layout — the grouping decides
// which formations are *offered*, not how one is read back.

export type FormationSlot = { position: string; x: number; y: number };

/** Players per side, keeper included. Parsed out of "7-a-side" strings. */
export type TeamSize = 5 | 7 | 8 | 11;

export const TEAM_SIZES: TeamSize[] = [5, 7, 8, 11];

export const FORMATIONS_BY_SIZE: Record<TeamSize, Record<string, FormationSlot[]>> = {
  // ── 5-a-side: keeper + four out ──────────────────────────────────────
  5: {
    "1-2-1": [
      { position: "GK", x: 50, y: 88 },
      { position: "CB", x: 50, y: 70 },
      { position: "LM", x: 22, y: 48 }, { position: "RM", x: 78, y: 48 },
      { position: "ST", x: 50, y: 24 },
    ],
    "2-1-1": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 30, y: 70 }, { position: "RB", x: 70, y: 70 },
      { position: "CM", x: 50, y: 48 },
      { position: "ST", x: 50, y: 24 },
    ],
    "1-1-2": [
      { position: "GK", x: 50, y: 88 },
      { position: "CB", x: 50, y: 70 },
      { position: "CM", x: 50, y: 50 },
      { position: "ST", x: 30, y: 26 }, { position: "ST", x: 70, y: 26 },
    ],
    "2-2": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 30, y: 68 }, { position: "RB", x: 70, y: 68 },
      { position: "ST", x: 30, y: 30 }, { position: "ST", x: 70, y: 30 },
    ],
  },

  // ── 7-a-side: keeper + six out ───────────────────────────────────────
  7: {
    "2-3-1": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 30, y: 71 }, { position: "RB", x: 70, y: 71 },
      { position: "LM", x: 18, y: 48 }, { position: "CM", x: 50, y: 50 }, { position: "RM", x: 82, y: 48 },
      { position: "ST", x: 50, y: 22 },
    ],
    "3-2-1": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 22, y: 70 }, { position: "CB", x: 50, y: 73 }, { position: "RB", x: 78, y: 70 },
      { position: "CM", x: 34, y: 48 }, { position: "CM", x: 66, y: 48 },
      { position: "ST", x: 50, y: 22 },
    ],
    "2-2-2": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 30, y: 71 }, { position: "RB", x: 70, y: 71 },
      { position: "CM", x: 30, y: 50 }, { position: "CM", x: 70, y: 50 },
      { position: "ST", x: 32, y: 24 }, { position: "ST", x: 68, y: 24 },
    ],
    "3-1-2": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 22, y: 70 }, { position: "CB", x: 50, y: 73 }, { position: "RB", x: 78, y: 70 },
      { position: "CM", x: 50, y: 50 },
      { position: "ST", x: 32, y: 24 }, { position: "ST", x: 68, y: 24 },
    ],
  },

  // ── 8-a-side: keeper + seven out ─────────────────────────────────────
  8: {
    "3-3-1": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 22, y: 71 }, { position: "CB", x: 50, y: 74 }, { position: "RB", x: 78, y: 71 },
      { position: "LM", x: 20, y: 48 }, { position: "CM", x: 50, y: 50 }, { position: "RM", x: 80, y: 48 },
      { position: "ST", x: 50, y: 22 },
    ],
    "2-3-2": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 30, y: 72 }, { position: "RB", x: 70, y: 72 },
      { position: "LM", x: 20, y: 50 }, { position: "CM", x: 50, y: 52 }, { position: "RM", x: 80, y: 50 },
      { position: "ST", x: 34, y: 24 }, { position: "ST", x: 66, y: 24 },
    ],
    "3-2-2": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 22, y: 71 }, { position: "CB", x: 50, y: 74 }, { position: "RB", x: 78, y: 71 },
      { position: "CM", x: 32, y: 50 }, { position: "CM", x: 68, y: 50 },
      { position: "ST", x: 34, y: 24 }, { position: "ST", x: 66, y: 24 },
    ],
    "2-4-1": [
      { position: "GK", x: 50, y: 88 },
      { position: "LB", x: 30, y: 72 }, { position: "RB", x: 70, y: 72 },
      { position: "LM", x: 14, y: 50 }, { position: "CM", x: 38, y: 52 }, { position: "CM", x: 62, y: 52 }, { position: "RM", x: 86, y: 50 },
      { position: "ST", x: 50, y: 22 },
    ],
  },

  // ── 11-a-side: the original four. Slot order is history — do not reorder.
  11: {
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
  },
};

/** Every formation, flattened. Keys are unique across sizes by construction. */
export const FORMATIONS: Record<string, FormationSlot[]> = Object.assign(
  {},
  ...TEAM_SIZES.map((s) => FORMATIONS_BY_SIZE[s])
);

export const FORMATION_KEYS = Object.keys(FORMATIONS);

export const DEFAULT_TEAM_SIZE: TeamSize = 11;
export const DEFAULT_FORMATION = "4-3-3";

const DEFAULT_BY_SIZE: Record<TeamSize, string> = {
  5: "1-2-1",
  7: "2-3-1",
  8: "3-3-1",
  11: DEFAULT_FORMATION,
};

const SIZE_BY_FORMATION: Record<string, TeamSize> = Object.fromEntries(
  TEAM_SIZES.flatMap((s) => Object.keys(FORMATIONS_BY_SIZE[s]).map((k) => [k, s]))
);

/**
 * Players per side for a stored format string — "8-a-side", "8 a side", "8v8".
 * Anything unrecognised (or absent, which is every row written before formats
 * were carried onto a fixture) is 11-a-side, which is what every lineup built
 * before this existed assumed.
 */
export function teamSizeFromFormat(format?: string | null): TeamSize {
  const n = Number(String(format ?? "").match(/\d+/)?.[0]);
  return (TEAM_SIZES as number[]).includes(n) ? (n as TeamSize) : DEFAULT_TEAM_SIZE;
}

/** The size a stored formation key belongs to. */
export function sizeOfFormation(formation: string): TeamSize {
  return SIZE_BY_FORMATION[formation] ?? DEFAULT_TEAM_SIZE;
}

/** The formation keys offered for a size, in the order they should be listed. */
export function formationKeysFor(size: TeamSize): string[] {
  return Object.keys(FORMATIONS_BY_SIZE[size] ?? FORMATIONS_BY_SIZE[DEFAULT_TEAM_SIZE]);
}

export function defaultFormationFor(size: TeamSize): string {
  return DEFAULT_BY_SIZE[size] ?? DEFAULT_FORMATION;
}

/** Human label for a size, e.g. "8-a-side". */
export function formatLabelForSize(size: TeamSize): string {
  return size + "-a-side";
}

/**
 * Slots for a formation. Given a `size`, a formation belonging to a different
 * size (a stored 4-3-3 on a game since fixed as 7-a-side, say) falls back to
 * that size's default rather than drawing eleven dots on a seven-a-side pitch.
 */
export function slotsFor(formation: string, size?: TeamSize): FormationSlot[] {
  if (size !== undefined) {
    const forSize = FORMATIONS_BY_SIZE[size] ?? FORMATIONS_BY_SIZE[DEFAULT_TEAM_SIZE];
    return forSize[formation] ?? forSize[defaultFormationFor(size)];
  }
  return FORMATIONS[formation] ?? FORMATIONS[DEFAULT_FORMATION];
}

/**
 * The formation to actually render: the stored one when it belongs to this
 * size, otherwise the size's default. Saved lineups are never rewritten — a
 * lineup is keyed by slot index and simply shows through whichever slots exist.
 */
export function resolveFormation(formation: string | null | undefined, size: TeamSize): string {
  const forSize = FORMATIONS_BY_SIZE[size] ?? FORMATIONS_BY_SIZE[DEFAULT_TEAM_SIZE];
  return formation && forSize[formation] ? formation : defaultFormationFor(size);
}

// Play style and pressing options — previously inline in the tactics page.
export const PLAY_STYLES = ["Possession", "Counter-Attack", "High Press", "Direct Play"];
export const PRESSING_LEVELS = ["Low", "Medium", "High"];

// Situations a saved preset can be filed under. Free text in the DB — these are
// just the suggestions the UI offers as chips.
export const TACTIC_SITUATIONS = ["Pressing", "Set Piece", "Defensive", "Offensive", "Custom"];

/**
 * Which of a pitch's advertised formats a post should record. A pitch can list
 * several ("5-a-side", "8-a-side"), and taking the first one at random is how a
 * team that plays 8s ended up with an eleven-slot lineup board. `preferred` is
 * the caller's own answer — the team's format, or the filter chip the captain
 * searched on — and wins whenever the pitch actually offers it.
 */
export function pitchFormatFor(
  pitchFormats: string[] | null | undefined,
  preferred?: string | null,
): string {
  const list = pitchFormats ?? [];
  if (preferred && list.includes(preferred)) return preferred;
  return list[0] ?? preferred ?? "";
}
