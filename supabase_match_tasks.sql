-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Match tasks migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- The jobs around a fixture that aren't football: bring the kit, collect the
-- match ball, drive the two players without cars, be there 20 minutes early.
-- Captains were doing this in the team announcement feed, where it scrolls away
-- and nobody can tick anything off.
--
-- Two tables rather than a "done" column, because a task can be aimed at the
-- whole squad ("everyone bring £5 cash") and then each player needs their own
-- completion. assignee_id null means the task is for everybody.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.match_tasks (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  title       text not null,
  detail      text,
  -- null = for the whole squad; set = one named player's job
  assignee_id uuid references auth.users(id),
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

create index if not exists match_tasks_match_team_idx
  on public.match_tasks (match_id, team_id, created_at);

-- ── Per-player completion ─────────────────────────────────────────────
-- A row exists only when someone has ticked the task. Absence is "not done",
-- so un-ticking is a delete rather than a flag flip and there's no third state.
create table if not exists public.match_task_done (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references public.match_tasks(id) on delete cascade,
  player_id uuid not null references auth.users(id),
  done_at   timestamptz default now(),
  unique(task_id, player_id)
);

create index if not exists match_task_done_task_idx
  on public.match_task_done (task_id);

alter table public.match_tasks enable row level security;
drop policy if exists "Anyone can view match tasks" on public.match_tasks;
create policy "Anyone can view match tasks" on public.match_tasks for select using (true);
drop policy if exists "Anyone can manage match tasks" on public.match_tasks;
create policy "Anyone can manage match tasks" on public.match_tasks for all using (true) with check (true);

alter table public.match_task_done enable row level security;
drop policy if exists "Anyone can view task completions" on public.match_task_done;
create policy "Anyone can view task completions" on public.match_task_done for select using (true);
drop policy if exists "Anyone can manage task completions" on public.match_task_done;
create policy "Anyone can manage task completions" on public.match_task_done for all using (true) with check (true);
