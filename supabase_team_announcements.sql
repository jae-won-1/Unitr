-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Team Announcements migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Lets a captain post a team-wide announcement (separate from match posts).
-- The most recent one (if within the last 7 days) shows on My Team between
-- the Next Fixture banner and the team card; older ones are reachable via
-- "View Previous Announcements". Posting one notifies every other squad
-- member as a direct message.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.team_announcements (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  captain_id  uuid not null references auth.users(id),
  title       text,
  body        text not null,
  created_at  timestamptz default now()
);

alter table public.team_announcements
  add column if not exists title text;

alter table public.team_announcements enable row level security;
drop policy if exists "Anyone can view team announcements" on public.team_announcements;
create policy "Anyone can view team announcements" on public.team_announcements for select using (true);
drop policy if exists "Anyone can insert team announcements" on public.team_announcements;
create policy "Anyone can insert team announcements" on public.team_announcements for insert with check (true);
