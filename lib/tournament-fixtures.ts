import { supabase } from "@/lib/supabase";
import { isUpcomingDate } from "@/lib/match-dates";

export type TournamentFixture = {
  id: string;
  title: string;
  date: string;
  time: string;
  pitch: string;
};

// A team relates to a tournament two ways: entered (open_match_teams) or
// hosted (open_matches.organiser_team_id) — merge both, dedupe, and keep
// only tournaments that haven't kicked off yet.
export async function loadUpcomingTournamentFixtures(teamId: string | null | undefined): Promise<TournamentFixture[]> {
  if (!teamId) return [];

  const [{ data: entries }, { data: hosted }] = await Promise.all([
    supabase.from("open_match_teams").select("open_match_id").eq("team_id", teamId),
    supabase.from("open_matches")
      .select("id, title, match_date, start_time, pitch_name, status")
      .eq("match_type", "tournament")
      .eq("organiser_team_id", teamId)
      .neq("status", "cancelled"),
  ]);

  const enteredIds = (entries ?? []).map((r) => r.open_match_id).filter(Boolean) as string[];
  const { data: entered } = enteredIds.length
    ? await supabase.from("open_matches")
        .select("id, title, match_date, start_time, pitch_name, status")
        .in("id", enteredIds)
        .eq("match_type", "tournament")
        .neq("status", "cancelled")
    : { data: [] as { id: string; title: string; match_date: string; start_time: string; pitch_name: string; status: string }[] };

  const byId = new Map<string, TournamentFixture>();
  for (const t of [...(hosted ?? []), ...(entered ?? [])]) {
    byId.set(t.id, { id: t.id, title: t.title, date: t.match_date, time: t.start_time, pitch: t.pitch_name });
  }

  return Array.from(byId.values()).filter((t) => isUpcomingDate(t.date));
}
