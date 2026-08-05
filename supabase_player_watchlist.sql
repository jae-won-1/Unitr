-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Player watchlist migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Scouting in the Transfer Market is a browsing session; signing is a decision
-- made later, often after watching someone play. The watchlist is the gap
-- between the two — a captain's shortlist that survives leaving the page.
--
-- Deliberately separate from player_offers: watchlisting is private to the
-- team and the player is never told, whereas an offer is a message sent. A
-- player moves from the watchlist to an offer, not the other way round, and
-- watchlisting someone you've already offered to is allowed (it's how you keep
-- track of who you're waiting on).
--
-- This is the first real "saved player" store in the app. The bookmark toggles
-- on /profile and /search are local-only mocks and are NOT backed by this.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.player_watchlist (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  player_id  uuid not null references auth.users(id),
  added_by   uuid references auth.users(id),
  -- A captain's own scouting note — "good in the air, no left foot"
  note       text,
  created_at timestamptz default now()
);

-- The watchlist is the team's, not the individual captain's, so it survives a
-- change of captain and two admins can't double-add the same player.
create unique index if not exists player_watchlist_team_player_idx
  on public.player_watchlist (team_id, player_id);

create index if not exists player_watchlist_team_idx
  on public.player_watchlist (team_id, created_at desc);

alter table public.player_watchlist enable row level security;
drop policy if exists "Anyone can view watchlist" on public.player_watchlist;
create policy "Anyone can view watchlist" on public.player_watchlist for select using (true);
drop policy if exists "Anyone can manage watchlist" on public.player_watchlist;
create policy "Anyone can manage watchlist" on public.player_watchlist for all using (true) with check (true);
