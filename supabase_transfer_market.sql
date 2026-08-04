-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Transfer Market migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- The Transfer Market is two-sided discovery: players browsing teams, and
-- captains browsing players. Three relationships can start there, and only
-- two of them needed new tables:
--
--   player  → team    "ask to join"   — already modelled by team_members
--                                       with status 'pending', so no table here
--   captain → player  "send an offer" — player_offers
--   player  ↔ player  "add friend"    — friend_requests
--
-- Both new tables are request logs, not membership: accepting an offer is what
-- writes the team_members row, so a squad is still described in exactly one
-- place. RLS is permissive to match the rest of the prototype's tables.
-- ════════════════════════════════════════════════════════════════════════

-- ── Captain → player invitations ──────────────────────────────────────
create table if not exists public.player_offers (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  captain_id  uuid not null references auth.users(id),
  player_id   uuid not null references auth.users(id),
  message     text,
  status      text not null default 'pending',   -- pending | accepted | declined
  created_at  timestamptz default now()
);

-- One live offer per team per player. Declining leaves the row in place, so a
-- captain can't re-send to someone who already said no by spamming inserts.
create unique index if not exists player_offers_team_player_idx
  on public.player_offers (team_id, player_id);

create index if not exists player_offers_player_idx
  on public.player_offers (player_id, status);

alter table public.player_offers enable row level security;
drop policy if exists "Anyone can view player offers" on public.player_offers;
create policy "Anyone can view player offers" on public.player_offers for select using (true);
drop policy if exists "Anyone can insert player offers" on public.player_offers;
create policy "Anyone can insert player offers" on public.player_offers for insert with check (true);
drop policy if exists "Anyone can update player offers" on public.player_offers;
create policy "Anyone can update player offers" on public.player_offers for update using (true);
drop policy if exists "Anyone can delete player offers" on public.player_offers;
create policy "Anyone can delete player offers" on public.player_offers for delete using (true);

-- ── Player ↔ player friendships ───────────────────────────────────────
-- A friendship is one row, not two: the requester is from_player_id and the
-- accepted flag lives on the same row, so "are we friends" is one lookup in
-- either direction rather than a pair that can fall out of sync.
create table if not exists public.friend_requests (
  id              uuid primary key default gen_random_uuid(),
  from_player_id  uuid not null references auth.users(id),
  to_player_id    uuid not null references auth.users(id),
  status          text not null default 'pending',  -- pending | accepted | declined
  created_at      timestamptz default now(),
  check (from_player_id <> to_player_id)
);

-- Ordered pair uniqueness only stops duplicate requests in the SAME direction.
-- The app checks for a row in either direction before offering the button, so
-- a simultaneous cross-request is the one case that can produce two rows —
-- harmless, since either one being accepted makes them friends.
create unique index if not exists friend_requests_pair_idx
  on public.friend_requests (from_player_id, to_player_id);

create index if not exists friend_requests_to_idx
  on public.friend_requests (to_player_id, status);

alter table public.friend_requests enable row level security;
drop policy if exists "Anyone can view friend requests" on public.friend_requests;
create policy "Anyone can view friend requests" on public.friend_requests for select using (true);
drop policy if exists "Anyone can insert friend requests" on public.friend_requests;
create policy "Anyone can insert friend requests" on public.friend_requests for insert with check (true);
drop policy if exists "Anyone can update friend requests" on public.friend_requests;
create policy "Anyone can update friend requests" on public.friend_requests for update using (true);
drop policy if exists "Anyone can delete friend requests" on public.friend_requests;
create policy "Anyone can delete friend requests" on public.friend_requests for delete using (true);
