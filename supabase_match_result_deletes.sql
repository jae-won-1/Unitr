-- Let a team's leaders delete its match-result rows.
--
-- supabase_match_results.sql gave match_results and match_result_players
-- select / insert / update policies but no DELETE policy, so under RLS every
-- client delete matched nothing — silently, with no error. Two flows in
-- lib/submit-result.ts depend on deleting:
--
--   • re-submitting a result replaces the team's scorer rows (delete, then
--     insert). The delete did nothing and the insert then hit
--     unique (match_id, player_id), so a corrected scoresheet never saved;
--   • a score conflict clears BOTH teams' submissions so they can re-submit.
--     Neither was cleared, so the match could never leave the conflict.
--
-- Scoped rather than `using (true)`: a captain or co-captain
-- (is_team_leader, supabase_co_captains.sql) may delete their own team's
-- scorer rows, and either side's result row for a match their team played —
-- the conflict path clears the opponent's row too. Nobody else can.
--
-- Run after supabase_match_results.sql and supabase_co_captains.sql.
-- Idempotent.

drop policy if exists "Team leaders delete their scorer rows" on public.match_result_players;
create policy "Team leaders delete their scorer rows"
  on public.match_result_players for delete
  using (public.is_team_leader(team_id, auth.uid()));

drop policy if exists "Match teams' leaders delete results" on public.match_results;
create policy "Match teams' leaders delete results"
  on public.match_results for delete
  using (exists (
    select 1 from public.matches m
     where m.id = match_results.match_id
       and (public.is_team_leader(m.posting_team_id, auth.uid())
            or public.is_team_leader(m.challenging_team_id, auth.uid()))
  ));
