// Men's and women's football. supabase_gender_categories.sql gives every team,
// match post, ringer request and event a `gender_category`; this is the only
// place that turns one into a label or tests a row against a filter. Which one
// a viewer sees by default is lib/viewer-gender.ts. Pure — no React, no
// Supabase client — so server routes (lib/gender-entry.ts) share it.
//
// Two different questions, kept apart on purpose:
//   • profiles.gender — who the player is: 'male' | 'female' |
//     'prefer_not_to_say', or null when they haven't been asked yet
//   • gender_category — which competition a team or game is in: 'male' | 'female'
//
// The database enforces who may enter what (a team only enters, posts or
// accepts its own category). Everything here is the *default view*, which a
// viewer can always widen to All.

export type GenderCategory = "male" | "female";
export type GenderFilter = GenderCategory | "all";

export const GENDER_CATEGORIES: { value: GenderCategory; label: string }[] = [
  { value: "male", label: "Men's" },
  { value: "female", label: "Women's" },
];

export const GENDER_FILTERS: { value: GenderFilter; label: string }[] = [
  ...GENDER_CATEGORIES,
  { value: "all", label: "All" },
];

/** A row's category. A row from before the migration has none, and every
 *  team and game then was men's — so that is what it is treated as. */
export function rowCategory(row: { gender_category?: string | null } | null | undefined): GenderCategory {
  return row?.gender_category === "female" ? "female" : "male";
}

/** "Men's" / "Women's". */
export function genderCategoryLabel(c: GenderCategory | null | undefined): string | null {
  return GENDER_CATEGORIES.find((g) => g.value === c)?.label ?? null;
}

/** The category a player's own answer puts them in, or null for someone who
 *  preferred not to say or hasn't answered — they see everything by default. */
export function categoryForGender(gender: string | null | undefined): GenderCategory | null {
  return gender === "male" || gender === "female" ? gender : null;
}

export function matchesGenderFilter(category: GenderCategory, filter: GenderFilter): boolean {
  return filter === "all" || filter === category;
}

/** Does a player's own answer fit this filter? Players who preferred not to say
 *  (or haven't answered) only appear under All. */
export function playerMatchesGenderFilter(gender: string | null | undefined, filter: GenderFilter): boolean {
  return filter === "all" || categoryForGender(gender) === filter;
}

/** The plain-English refusal: "Women's teams only", or "Women only" for a player. */
export function wrongCategoryReason(event: GenderCategory, who: "teams" | "players" = "teams"): string {
  if (who === "players") return event === "female" ? "Women only" : "Men only";
  return `${genderCategoryLabel(event)} teams only`;
}

