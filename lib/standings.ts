// Standings table for multi-team events (tournaments/leagues), shared between
// the venue portal and the player-facing tournament page.

export type StandingTeam = { team_id: string; team_name: string };
export type StandingFixture = {
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string; // 'scheduled' | 'played'
};

export type StandingRow = {
  name: string; played: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
};

// Standings are aggregated from real, played tournament_matches rows only —
// teams with no played fixtures yet still appear with all-zero rows.
export function computeStandings(joinedTeams: StandingTeam[], fixtures: StandingFixture[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const t of joinedTeams) {
    rows.set(t.team_id, { name: t.team_name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
  }
  for (const f of fixtures) {
    if (f.status !== "played" || f.home_score == null || f.away_score == null) continue;
    const home = f.home_team_id ? rows.get(f.home_team_id) : null;
    const away = f.away_team_id ? rows.get(f.away_team_id) : null;
    if (home) {
      home.played++; home.gf += f.home_score; home.ga += f.away_score;
      if (f.home_score > f.away_score) { home.w++; home.pts += 3; }
      else if (f.home_score === f.away_score) { home.d++; home.pts += 1; }
      else home.l++;
    }
    if (away) {
      away.played++; away.gf += f.away_score; away.ga += f.home_score;
      if (f.away_score > f.home_score) { away.w++; away.pts += 3; }
      else if (f.away_score === f.home_score) { away.d++; away.pts += 1; }
      else away.l++;
    }
  }
  return Array.from(rows.values())
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}
