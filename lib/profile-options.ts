import { supabase } from "@/lib/supabase";
import { withOptionalColumn } from "@/lib/optional-column";

// What a player tells us about themselves — asked at registration
// (app/register/page.tsx) and editable afterwards from /profile. The option
// lists live here so the sign-up form and the editor cannot drift apart; the
// comments explaining why each one is a closed set of short keys are on the
// migrations that added them (supabase_player_demographics.sql,
// supabase_play_frequency.sql, supabase_preferred_football_type.sql).

export type Option = { value: string; label: string; hint?: string };

export const POSITIONS = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"];

/** Stored verbatim — the label is the value. */
export const EXPERIENCE_LEVELS = ["Beginner", "Casual", "Intermediate", "Semi-Pro"];

export const AGE_GROUPS: Option[] = [
  { value: "under-18", label: "Under 18" },
  { value: "18-24", label: "18–24" },
  { value: "25-34", label: "25–34" },
  { value: "35-44", label: "35–44" },
  { value: "45+", label: "45+" },
];

export const GENDERS: Option[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const PLAY_FREQUENCIES: Option[] = [
  { value: "1-2", label: "1–2 games" },
  { value: "3-5", label: "3–5 games" },
  { value: "6-9", label: "6–9 games" },
  { value: "10+", label: "10+ games" },
];

export const FOOTBALL_TYPES: Option[] = [
  { value: "casual", label: "No team", hint: "Casual kickabouts and fill-in games" },
  { value: "friendly", label: "Team friendlies", hint: "Regular matches with a team" },
  { value: "competitive", label: "Competitive team matches", hint: "Leagues and tournaments" },
];

/** The label for a stored key, or the key itself if it came from an older row. */
export function optionLabel(options: Option[], value: string | null | undefined): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * A player covers several positions, but one of them is primary.
 *
 * `profiles.positions` is the full answer and `profiles.position` is its first
 * entry — see supabase_multi_select_preferences.sql. Squad lists and cards that
 * only have room for one keep reading the scalar; everything that describes the
 * player reads the array through here.
 */
export type PositionRow = { position?: string | null; positions?: string[] | null };

/** Every position the player plays, in pitch order (GK first), unknowns dropped. */
export function playerPositions(row: PositionRow | null | undefined): string[] {
  if (!row) return [];
  const raw = row.positions?.length ? row.positions : row.position ? [row.position] : [];
  return normalisePositions(raw);
}

/** Pitch order, no duplicates, nothing we don't offer. */
export function normalisePositions(values: (string | null | undefined)[]): string[] {
  return POSITIONS.filter((p) => values.includes(p));
}

/** "CM · CAM", or null when the player never said. */
export function positionLabel(row: PositionRow | null | undefined): string | null {
  const list = playerPositions(row);
  return list.length > 0 ? list.join(" · ") : null;
}

/** Does this player cover `position`? Used by the position filters, which pick one. */
export function playsPosition(row: PositionRow | null | undefined, position: string): boolean {
  return playerPositions(row).includes(position);
}

// The columns a profile has always had, and the ones a migration added later.
// Naming a column that isn't there fails the whole statement, so the optional
// set is dropped as a group on a retry: the player keeps a working profile page
// and an editor that saves their name, position and experience, which is what
// existed before those migrations anyway.
const CORE_COLUMNS = "full_name, position, location, experience";
const OPTIONAL_COLUMNS = [
  "positions",               // supabase_multi_select_preferences.sql
  "games_per_month",         // supabase_play_frequency.sql
  "preferred_football_type", // supabase_preferred_football_type.sql
  "age_group",               // supabase_player_demographics.sql
  "gender",                  //  ″
];

export type ProfileFields = {
  full_name: string;
  positions: string[];
  experience: string;
  games_per_month: string;
  preferred_football_type: string;
  age_group: string;
  gender: string;
};

/**
 * Save the player's own profile. The scalar `position` is written alongside the
 * array and always holds the first choice, so every card and filter that never
 * heard of `positions` still gets a straight answer. `extrasSaved` is false when
 * one of the later migrations hasn't been run — the name, primary position and
 * experience are still saved and the caller says so rather than reporting a
 * save that didn't happen.
 */
export async function saveProfileFields(
  userId: string,
  fields: ProfileFields,
): Promise<{ error: string | null; extrasSaved: boolean }> {
  const positions = normalisePositions(fields.positions);
  const core = {
    full_name: fields.full_name,
    position: positions[0] ?? null,
    experience: fields.experience || null,
  };
  const extras = {
    positions,
    games_per_month: fields.games_per_month || null,
    preferred_football_type: fields.preferred_football_type || null,
    age_group: fields.age_group || null,
    gender: fields.gender || null,
  };

  const { error, included } = await withOptionalColumn(OPTIONAL_COLUMNS, (include) =>
    supabase.from("profiles").update(include ? { ...core, ...extras } : core).eq("id", userId)
  );

  return { error: error?.message ?? null, extrasSaved: included };
}

/** One profile: everything the row has, whichever migrations have been run. */
export async function loadProfileFields<T>(userId: string): Promise<T | null> {
  const { data } = await withOptionalColumn<T>(OPTIONAL_COLUMNS, (include) =>
    supabase.from("profiles")
      .select(include ? `${CORE_COLUMNS}, ${OPTIONAL_COLUMNS.join(", ")}` : CORE_COLUMNS)
      .eq("id", userId)
      .maybeSingle() as PromiseLike<{ data: T | null; error: { message: string } | null }>
  );
  return data;
}
