-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Pitches, bookings and per-player payment records
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- This file used to be the one migration in the repo that could not be re-run:
-- bare `create table` / `create policy` with no guards, so a second run failed
-- on the first statement. Worse, it could not complete a FIRST run either --
-- the seed below inserts lat and lng, and the create table never declared
-- them. Every statement after the seed was therefore skipped on a fresh
-- database, which is why pitch_bookings ended up with RLS disabled while
-- appearing, in this file, to have it enabled.
--
-- Both are fixed here. The three things that make it re-runnable:
--   • `create table if not exists` for all three tables
--   • `drop policy if exists` before every `create policy`
--   • the seed guards each row on name, so it tops up rather than duplicating
--
-- lat/lng are added separately as well as declared inline, so a database that
-- already has a pitches table from a partial run gets the columns too.
-- ════════════════════════════════════════════════════════════════════════


-- ── pitches ─────────────────────────────────────────────────────────────
create table if not exists public.pitches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  -- Read by components/PitchMap.tsx, which filters out any pitch where either
  -- is null — so a missing coordinate is an invisible pin, not an error.
  lat numeric(9,6),
  lng numeric(9,6),
  price_per_hour integer not null,
  formats text[] not null default '{}',
  surfaces text[] not null default '{}',
  capacity integer default 22,
  description text,
  amenities text[] default '{}',
  venue_owner_id uuid references auth.users(id),
  contact_email text,
  is_verified boolean default false,
  rating numeric(3,1) default 0,
  created_at timestamptz default now()
);

-- For databases created before lat/lng were declared above.
alter table public.pitches
  add column if not exists lat numeric(9,6),
  add column if not exists lng numeric(9,6);

alter table public.pitches enable row level security;
drop policy if exists "Anyone can view pitches" on public.pitches;
create policy "Anyone can view pitches" on public.pitches
  for select using (true);
drop policy if exists "Venue owners can insert pitches" on public.pitches;
create policy "Venue owners can insert pitches" on public.pitches
  for insert with check (true);
drop policy if exists "Venue owners can update their pitches" on public.pitches;
create policy "Venue owners can update their pitches" on public.pitches
  for update using (true);


-- ── Seed: real London pitches ───────────────────────────────────────────
-- Guarded per row on name rather than `on conflict`, because name has no
-- unique constraint and adding one would fail on any database where a venue
-- manager has since registered a pitch under a duplicate name. This way the
-- seed tops up what is missing and leaves everything else alone, so adding a
-- pitch to the list below and re-running inserts only the new one.
insert into public.pitches (name, address, lat, lng, price_per_hour, formats, surfaces, amenities, rating, is_verified)
select v.name, v.address, v.lat, v.lng, v.price_per_hour, v.formats, v.surfaces, v.amenities, v.rating, v.is_verified
from (values
  ('Powerleague Finsbury Park', '223 Seven Sisters Rd, London N4 2DA', 51.5643, -0.1004, 80,  ARRAY['7-a-side'],              ARRAY['3G'],    ARRAY['Changing rooms','Parking','Floodlights'],        4.8, true),
  ('Hackney Marshes Pitch 3',   'Homerton Rd, London E9 5PF',          51.5526, -0.0227, 60,  ARRAY['11-a-side'],             ARRAY['Grass'], ARRAY['Parking','Floodlights'],                        4.5, true),
  ('Goals Walthamstow',         'Higham Hill Rd, London E17 6EA',      51.5867, -0.0219, 95,  ARRAY['5-a-side','7-a-side'],   ARRAY['3G'],    ARRAY['Changing rooms','Café','Parking','Floodlights'], 4.9, true),
  ('Powerleague Shoreditch',    'Old St, London EC1V 9HL',             51.5252, -0.0980, 110, ARRAY['5-a-side'],              ARRAY['3G'],    ARRAY['Changing rooms','Bar','Floodlights'],           4.7, true),
  ('Victoria Park Arena',       'Grove Rd, London E3 5TB',             51.5352, -0.0280, 75,  ARRAY['7-a-side','11-a-side'],  ARRAY['3G'],    ARRAY['Changing rooms','Parking'],                     4.6, true),
  ('Playhive Leyton',           'Oliver Rd, London E10 5LT',           51.5678, -0.0123, 70,  ARRAY['5-a-side','7-a-side'],   ARRAY['3G'],    ARRAY['Changing rooms','Parking','Floodlights'],       4.4, false),
  ('Astroworld Bow',            'Gillender St, London E3 3LB',         51.5289, -0.0156, 65,  ARRAY['7-a-side'],              ARRAY['3G'],    ARRAY['Floodlights'],                                  4.3, false)
) as v(name, address, lat, lng, price_per_hour, formats, surfaces, amenities, rating, is_verified)
where not exists (select 1 from public.pitches p where p.name = v.name);

-- Backfill coordinates onto seed rows that predate the lat/lng columns, so an
-- existing database gets its map pins without a re-seed.
update public.pitches p set lat = v.lat, lng = v.lng
from (values
  ('Powerleague Finsbury Park', 51.5643, -0.1004),
  ('Hackney Marshes Pitch 3',   51.5526, -0.0227),
  ('Goals Walthamstow',         51.5867, -0.0219),
  ('Powerleague Shoreditch',    51.5252, -0.0980),
  ('Victoria Park Arena',       51.5352, -0.0280),
  ('Playhive Leyton',           51.5678, -0.0123),
  ('Astroworld Bow',            51.5289, -0.0156)
) as v(name, lat, lng)
where p.name = v.name and (p.lat is null or p.lng is null);


-- ── pitch_bookings ──────────────────────────────────────────────────────
-- Columns added later by supabase_venue.sql and supabase_venue_payment_sync
-- .sql (end_time, booking_type, booker_name, notes, payment_status) are not
-- repeated here; `if not exists` means this block is a no-op on a database
-- that already has the table, so it never removes them.
create table if not exists public.pitch_bookings (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid references public.pitches(id) not null,
  post_id uuid references public.match_posts(id),
  booked_by uuid references auth.users(id) not null,
  match_date text not null,
  start_time text not null,
  total_price_pence integer not null,
  player_count integer not null default 22,
  per_player_pence integer not null,
  unitr_fee_pence integer not null,
  status text default 'pending',
  stripe_payment_intent_id text,
  created_at timestamptz default now()
);

alter table public.pitch_bookings enable row level security;
drop policy if exists "Anyone can view bookings" on public.pitch_bookings;
create policy "Anyone can view bookings" on public.pitch_bookings
  for select using (true);
drop policy if exists "Authenticated users can create bookings" on public.pitch_bookings;
create policy "Authenticated users can create bookings" on public.pitch_bookings
  for insert with check (auth.uid() = booked_by);
drop policy if exists "Booking owner can update" on public.pitch_bookings;
create policy "Booking owner can update" on public.pitch_bookings
  for update using (true);
-- Without this, the rollback at app/venue/calendar/page.tsx:466 silently
-- deletes nothing and leaves an orphaned booking holding a slot. Kept
-- identical to supabase_pitch_bookings_rls.sql, which exists to repair
-- databases that ran the broken version of this file.
drop policy if exists "Booking owner can delete" on public.pitch_bookings;
create policy "Booking owner can delete" on public.pitch_bookings
  for delete using (auth.uid() = booked_by);


-- ── player_payments ─────────────────────────────────────────────────────
-- Extended by supabase_credit_ledger.sql (purpose, team_id, applied) and
-- supabase_card_on_file.sql (failure_reason, off_session).
create table if not exists public.player_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.pitch_bookings(id) not null,
  player_id uuid references auth.users(id) not null,
  amount_pence integer not null,
  unitr_fee_pence integer not null,
  total_pence integer not null,
  status text default 'pending',
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz default now(),
  unique(booking_id, player_id)
);

alter table public.player_payments enable row level security;
drop policy if exists "Anyone can view player payments" on public.player_payments;
create policy "Anyone can view player payments" on public.player_payments
  for select using (true);
drop policy if exists "System can insert payments" on public.player_payments;
create policy "System can insert payments" on public.player_payments
  for insert with check (true);
drop policy if exists "Players can update their payments" on public.player_payments;
create policy "Players can update their payments" on public.player_payments
  for update using (true);
