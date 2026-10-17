import { supabase } from "@/lib/supabase";

// The pitches a venue manager owns, in the one order every venue screen uses:
// the sidebar lists a calendar per pitch in this order, and /venue/calendar
// opens the first of them — so "first" has to mean the same thing in both.
export type VenuePitch = { id: string; name: string; price_per_hour: number };

export async function loadVenuePitches(ownerId: string): Promise<VenuePitch[]> {
  const { data } = await supabase.from("pitches")
    .select("id, name, price_per_hour")
    .eq("venue_owner_id", ownerId)
    .order("name");
  return (data ?? []) as VenuePitch[];
}
