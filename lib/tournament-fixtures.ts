import { supabase } from "@/lib/supabase";
import { isUpcomingDate } from "@/lib/match-dates";

export type TournamentFixture = {
  id: string;
  title: string;
  date: string;
  time: string;
  pitch: string;
  address: string | null;
  format: string | null;
  /** True when this team organised it rather than entered it — gates "Manage". */
  hosting: boolean;
};

const COLUMNS = "id, title, match_date, start_time, pitch_name, venue_address, format, status";

type Row = {
  id: string; title: string; match_date: string; start_time: string;
  pitch_name: string; venue_address: string | null; format: string | null; status: string;
};

// A team relates to a tournament two ways: entered (open_match_teams) or
// hosted (open_matches.organiser_team_id) — merge both and dedupe.
//
// `includePast` is what separates the two callers: Home wants the next thing
// coming up, the Calendar wants the whole record. Everything else is identical,
// so the filter is the only knob rather than a second near-copy of the query.
export async function loadTournamentFixtures(
  teamId: string | null | undefined,
  { includePast = false }: { includePast?: boolean } = {},
): Promise<TournamentFixture[]> {
  if (!teamId) return [];

  const [{ data: entries }, { data: hosted }] = await Promise.all([
    supabase.from("open_match_teams").select("open_match_id").eq("team_id", teamId),
    supabase.from("open_matches")
      .select(COLUMNS)
      .eq("match_type", "tournament")
      .eq("organiser_team_id", teamId)
      .neq("status", "cancelled"),
  ]);

  const enteredIds = (entries ?? []).map((r) => r.open_match_id).filter(Boolean) as string[];
  const { data: entered } = enteredIds.length
    ? await supabase.from("open_matches")
        .select(COLUMNS)
        .in("id", enteredIds)
        .eq("match_type", "tournament")
        .neq("status", "cancelled")
    : { data: [] as Row[] };

  const hostedIds = new Set((hosted ?? []).map((t) => t.id));
  const byId = new Map<string, TournamentFixture>();
  for (const t of [...((hosted ?? []) as Row[]), ...((entered ?? []) as Row[])]) {
    byId.set(t.id, {
      id: t.id,
      title: t.title,
      date: t.match_date,
      time: t.start_time,
      pitch: t.pitch_name,
      address: t.venue_address,
      format: t.format,
      hosting: hostedIds.has(t.id),
    });
  }

  const all = Array.from(byId.values());
  return includePast ? all : all.filter((t) => isUpcomingDate(t.date));
}

/** Upcoming only — the home screen's "next fixture" needs nothing else. */
export async function loadUpcomingTournamentFixtures(teamId: string | null | undefined): Promise<TournamentFixture[]> {
  return loadTournamentFixtures(teamId);
}
