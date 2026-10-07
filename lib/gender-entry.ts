import { adminSupabase } from "@/lib/supabase-admin";
import { genderCategoryLabel, rowCategory, type GenderCategory } from "@/lib/gender";

// Server-side half of the men's/women's rule (lib/gender.ts). The database
// already refuses a team entering an event, or accepting a post, outside its
// own category (supabase_gender_categories.sql) — but those triggers fire on
// the final insert, after a route may have taken money. Routes ask here first,
// so the refusal comes before any charge and in a sentence a captain can read.

type Table = "teams" | "open_matches" | "match_posts" | "ringer_requests";

/** A row's category. select("*") so it answers before the migration is run. */
export async function categoryOf(table: Table, id: string): Promise<GenderCategory | null> {
  const { data } = await adminSupabase.from(table).select("*").eq("id", id).maybeSingle();
  return data ? rowCategory(data) : null;
}

/** Null when the team may take part; otherwise why not. */
export async function teamCategoryRefusal(
  teamId: string, listing: { table: "open_matches" | "match_posts"; id: string },
): Promise<string | null> {
  const [team, event] = await Promise.all([categoryOf("teams", teamId), categoryOf(listing.table, listing.id)]);
  if (!team || !event || team === event) return null;
  const what = listing.table === "open_matches" ? "event" : "game";
  return `This is a ${genderCategoryLabel(event)?.toLowerCase()} ${what} — only ${genderCategoryLabel(event)?.toLowerCase()} teams can take part.`;
}

/** Null when this player may fill in; otherwise why not. A player who
 *  preferred not to say, or hasn't answered, isn't refused. */
export async function playerCategoryRefusal(playerId: string, requestId: string): Promise<string | null> {
  const [{ data: profile }, request] = await Promise.all([
    adminSupabase.from("profiles").select("*").eq("id", playerId).maybeSingle(),
    categoryOf("ringer_requests", requestId),
  ]);
  const own = profile?.gender === "male" || profile?.gender === "female" ? profile.gender : null;
  if (!own || !request || own === request) return null;
  return request === "female"
    ? "This team is looking for women players."
    : "This team is looking for men players.";
}
