import { supabase } from "@/lib/supabase";
import { withOptionalColumn } from "@/lib/optional-column";

// The team's own answers — the questions /my-team/create asks at registration
// and /my-team/settings lets the captain change afterwards. The option lists
// live here so the two forms cannot drift apart.

export const TEAM_LEVELS = ["Casual", "Intermediate", "Semi-Pro"];

/** The column stays `format`; only the label says "players per side". */
export const TEAM_FORMATS = ["5-a-side", "7-a-side", "8-a-side", "11-a-side"];

/**
 * A team plays however many formats it likes, but one of them is primary.
 *
 * `teams.formats` is the full answer and `teams.format` is its first entry —
 * see supabase_multi_select_preferences.sql. Everything that needs a single
 * format (teamSizeFromFormat for a tactics board, a pitch match) keeps reading
 * the scalar; everything that describes the team reads the array through here.
 */
export type TeamFormatRow = { format?: string | null; formats?: string[] | null };

/** Every format the team plays, in menu order, unknown values dropped. */
export function teamFormats(row: TeamFormatRow | null | undefined): string[] {
  if (!row) return [];
  const raw = row.formats?.length ? row.formats : row.format ? [row.format] : [];
  return normaliseFormats(raw);
}

/** Menu order, no duplicates, nothing we don't offer. */
export function normaliseFormats(values: (string | null | undefined)[]): string[] {
  return TEAM_FORMATS.filter((f) => values.includes(f));
}

/** "5-a-side · 7-a-side", or null when the team never said. */
export function teamFormatLabel(row: TeamFormatRow | null | undefined): string | null {
  const list = teamFormats(row);
  return list.length > 0 ? list.join(" · ") : null;
}

/** Does this team play `format`? Used by the format filters, which pick one. */
export function teamPlaysFormat(row: TeamFormatRow | null | undefined, format: string): boolean {
  return teamFormats(row).includes(format);
}

/**
 * Save the team's details, formats included.
 *
 * The scalar is written alongside the array and always holds the first choice,
 * so a tactics board, a pitch pick or any reader that never heard of `formats`
 * still gets a straight answer. `formatsSaved` is false when the migration
 * hasn't been run — the team keeps its primary format and the caller says so.
 */
export async function saveTeamDetails(
  teamId: string,
  fields: { name: string; location: string; level: string; description: string; formats: string[] },
): Promise<{ error: string | null; formatsSaved: boolean }> {
  const formats = normaliseFormats(fields.formats);
  const base = {
    name: fields.name,
    location: fields.location,
    level: fields.level,
    description: fields.description,
    format: formats[0] ?? null,
  };

  const { error, included } = await withOptionalColumn("formats", (include) =>
    supabase.from("teams").update(include ? { ...base, formats } : base).eq("id", teamId)
  );

  return { error: error?.message ?? null, formatsSaved: included };
}

/** One team, with `formats` when the column is there. */
export async function loadTeamDetails<T>(teamId: string, columns: string): Promise<T | null> {
  const { data } = await withOptionalColumn<T>("formats", (include) =>
    supabase.from("teams")
      .select(include ? `${columns}, formats` : columns)
      .eq("id", teamId)
      .maybeSingle() as PromiseLike<{ data: T | null; error: { message: string } | null }>
  );
  return data;
}
