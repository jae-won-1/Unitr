-- ── OPEN MATCHES (venue-hosted games teams can join) ──────────
-- Pitch owners block out a slot and post an open match/tournament.
-- Teams browse these in the Play page and buy in per team.
create table if not exists public.open_matches (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid references public.pitches(id) on delete cascade not null,
  venue_owner_id uuid references auth.users(id) not null,
  -- Denormalised for easy display in the player-facing Play feed
  pitch_name text not null,
  venue_address text,
  -- Slot
  match_date text not null,        -- ISO "2026-06-27"
  start_time text not null,        -- "18:00"
  end_time text not null,          -- "19:00"
  -- Listing
  title text not null,
  match_type text not null default 'match',   -- 'match' | 'tournament'
  format text,                     -- "5-a-side", "7-a-side", "11-a-side"
  skill_level text default 'Mixed',-- 'Casual' | 'Competitive' | 'Mixed'
  price_per_team_pence integer not null default 0,
  max_teams integer not null default 2,
  description text,
  status text not null default 'open',         -- 'open' | 'full' | 'cancelled'
  -- The pitch_bookings row that reserves this slot on the venue calendar
  booking_id uuid references public.pitch_bookings(id),
  created_at timestamptz default now()
);

alter table public.open_matches enable row level security;
drop policy if exists "Anyone can view open matches" on public.open_matches;
create policy "Anyone can view open matches" on public.open_matches for select using (true);
drop policy if exists "Venue owners can manage open matches" on public.open_matches;
create policy "Venue owners can manage open matches" on public.open_matches for all using (true) with check (true);


-- ── OPEN MATCH TEAMS (which teams have bought in) ─────────────
create table if not exists public.open_match_teams (
  id uuid primary key default gen_random_uuid(),
  open_match_id uuid references public.open_matches(id) on delete cascade not null,
  team_id uuid references public.teams(id) not null,
  team_name text not null,
  joined_by uuid references auth.users(id) not null,
  payment_status text default 'paid',          -- dummy Stripe split for now
  created_at timestamptz default now(),
  unique(open_match_id, team_id)
);

alter table public.open_match_teams enable row level security;
drop policy if exists "Anyone can view open match teams" on public.open_match_teams;
create policy "Anyone can view open match teams" on public.open_match_teams for select using (true);
-- Open like the rest of the payment tables (team_credits, player_payments, …):
-- the join itself is written server-side via /api/tournaments/join using
-- adminSupabase, which falls back to the anon key in local dev (no user JWT on
-- that client) — an auth.uid()-scoped check() would always fail there. The
-- route enforces capacity/duplicate/credit checks instead of RLS.
drop policy if exists "Anyone can join open matches" on public.open_match_teams;
create policy "Anyone can join open matches" on public.open_match_teams for insert with check (true);
drop policy if exists "Anyone can leave open matches" on public.open_match_teams;
create policy "Anyone can leave open matches" on public.open_match_teams for delete using (true);


-- ── Mark booking_type column usage ────────────────────────────
-- Open-match reservations are written to pitch_bookings with
-- booking_type = 'open_match' so they appear on the venue calendar
-- and block the slot from regular /book reservations. No schema
-- change needed — booking_type is already free-text.
