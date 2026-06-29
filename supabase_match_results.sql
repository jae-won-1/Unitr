-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Match Results migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Lets the captain submit the final score, scorers, and participating
-- squad (starters + subs brought on) for a completed match.
-- ════════════════════════════════════════════════════════════════════════

alter table public.matches
  add column if not exists result_submitted boolean not null default false;

create table if not exists public.match_results (
  id               uuid primary key default gen_random_uuid(),
  match_id         uuid not null references public.matches(id) on delete cascade,
  team_id          uuid not null references public.teams(id) on delete cascade,
  team_score       integer not null default 0,
  opponent_score   integer not null default 0,
  submitted_by     uuid not null references auth.users(id),
  created_at       timestamptz default now(),
  unique (match_id, team_id)
);

alter table public.match_results enable row level security;
drop policy if exists "Anyone can view match results" on public.match_results;
create policy "Anyone can view match results" on public.match_results for select using (true);
drop policy if exists "Anyone can insert match results" on public.match_results;
create policy "Anyone can insert match results" on public.match_results for insert with check (true);
drop policy if exists "Anyone can update match results" on public.match_results;
create policy "Anyone can update match results" on public.match_results for update using (true);

create table if not exists public.match_result_players (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  player_id   uuid not null references auth.users(id) on delete cascade,
  started     boolean not null default false,
  subbed_on   boolean not null default false,
  goals       integer not null default 0,
  unique (match_id, player_id)
);

alter table public.match_result_players enable row level security;
drop policy if exists "Anyone can view match result players" on public.match_result_players;
create policy "Anyone can view match result players" on public.match_result_players for select using (true);
drop policy if exists "Anyone can insert match result players" on public.match_result_players;
create policy "Anyone can insert match result players" on public.match_result_players for insert with check (true);
drop policy if exists "Anyone can update match result players" on public.match_result_players;
create policy "Anyone can update match result players" on public.match_result_players for update using (true);
