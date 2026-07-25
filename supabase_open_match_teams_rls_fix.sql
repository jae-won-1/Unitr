-- Fix: open_match_teams insert/delete RLS blocked the tournament join flow.
-- Run in the Supabase SQL editor. Idempotent - safe to re-run.
--
-- Joining a tournament now happens server-side via /api/tournaments/join using
-- adminSupabase, which falls back to the anon key in local dev when
-- SUPABASE_SERVICE_ROLE_KEY isn't set - that client has no user JWT, so the old
-- "auth.uid() = joined_by" check always failed. Open these policies to match
-- every other payment table in the prototype (team_credits, player_payments),
-- where the route's own checks (capacity, duplicates, credit) enforce access.

drop policy if exists "Captains can join open matches" on public.open_match_teams;
drop policy if exists "Joiner can leave" on public.open_match_teams;
drop policy if exists "Anyone can join open matches" on public.open_match_teams;
drop policy if exists "Anyone can leave open matches" on public.open_match_teams;

create policy "Anyone can join open matches" on public.open_match_teams for insert with check (true);
create policy "Anyone can leave open matches" on public.open_match_teams for delete using (true);
