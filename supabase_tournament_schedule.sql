-- Tournament scheduling + referees + a general notifications table.
-- Run in the Supabase SQL editor. Idempotent - safe to re-run.

-- 1. Fixtures within a tournament (one row per scheduled game). The organiser
--    generates these manually or randomly from the joined teams. Each game gets
--    a referee: a randomly chosen player from a team NOT playing in that game.
create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  open_match_id uuid references public.open_matches(id) on delete cascade not null,
  round_label text,                       -- e.g. "Group", "Round 1", "Final"
  slot_index integer not null default 0,  -- order within the day
  scheduled_time text,                    -- "18:00" within the booked block
  home_team_id uuid references public.teams(id),
  home_team_name text,
  away_team_id uuid references public.teams(id),
  away_team_name text,
  referee_player_id uuid references auth.users(id),
  referee_name text,
  referee_team_id uuid references public.teams(id),
  referee_team_name text,
  home_score integer,
  away_score integer,
  status text not null default 'scheduled',   -- 'scheduled' | 'played'
  created_at timestamptz default now()
);

alter table public.tournament_matches enable row level security;
drop policy if exists "Anyone can view tournament matches" on public.tournament_matches;
create policy "Anyone can view tournament matches" on public.tournament_matches for select using (true);
-- Scheduling is enforced in-app (organiser only); RLS left open like the rest
-- of the prototype's write paths so client + server writes both work.
drop policy if exists "Anyone can manage tournament matches" on public.tournament_matches;
create policy "Anyone can manage tournament matches" on public.tournament_matches for all using (true) with check (true);


-- 2. General notifications (referee assignments, and reusable for future alerts).
-- Additive: if a notifications table already exists (from earlier work) with a
-- different shape, we add any missing columns rather than failing on them.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid()
);

alter table public.notifications
  add column if not exists user_id uuid references auth.users(id),
  add column if not exists type text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists link text,       -- in-app path the bell click opens
  add column if not exists read boolean not null default false,
  add column if not exists created_at timestamptz default now();

create index if not exists notifications_user_idx on public.notifications(user_id, read);

alter table public.notifications enable row level security;
-- A user reads their own notifications.
drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications for select using (auth.uid() = user_id);
-- Anyone (the scheduler) can create a notification for another user, and users
-- can mark their own read. Open insert matches the prototype's other tables.
drop policy if exists "Anyone can create notifications" on public.notifications;
create policy "Anyone can create notifications" on public.notifications for insert with check (true);
drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications" on public.notifications for update using (auth.uid() = user_id);
