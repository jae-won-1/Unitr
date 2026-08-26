-- Admin-hosted events (Unitr staff hosting tournaments / leagues / friendlies
-- on pitches booked outside the app) + admin player ratings.
-- Run in the Supabase SQL editor. Idempotent - safe to re-run.

-- 1. Admin-hosted open_matches have no real pitch row and no venue owner:
--    the admin books the pitch on the venue's own website and just types the
--    venue name/address into the post. pitch_name stays NOT NULL and doubles
--    as the free-text venue name (it is what every card and detail surface
--    renders); venue_address (already nullable) holds the address hint.
alter table public.open_matches alter column pitch_id drop not null;
alter table public.open_matches alter column venue_owner_id drop not null;

-- Who hosts decides where a buy-in goes on join:
--   organiser_team_id set   -> reimburse the hosting team's credit
--   organiser_admin_id set  -> platform keeps it (admin paid the venue in cash)
--   both null               -> venue-hosted, Stripe transfer to the venue
alter table public.open_matches
  add column if not exists organiser_admin_id uuid references auth.users(id),
  add column if not exists organiser_admin_name text;

create index if not exists open_matches_admin_idx on public.open_matches(organiser_admin_id);

-- 2. Admin ratings: the hosting admin rates players 1-10 per event.
create table if not exists public.admin_player_ratings (
  id uuid primary key default gen_random_uuid(),
  open_match_id uuid references public.open_matches(id) on delete cascade not null,
  player_id uuid references auth.users(id) not null,
  team_id uuid references public.teams(id),
  team_name text,
  rated_by uuid references auth.users(id) not null,
  rating smallint not null check (rating between 1 and 10),
  note text,
  created_at timestamptz default now(),
  unique(open_match_id, player_id)
);

alter table public.admin_player_ratings enable row level security;
drop policy if exists "Anyone can view admin ratings" on public.admin_player_ratings;
create policy "Anyone can view admin ratings" on public.admin_player_ratings for select using (true);
-- Rating entry is enforced in-app (event host only); RLS left open like the
-- rest of the prototype's write paths so client + server writes both work.
drop policy if exists "Anyone can manage admin ratings" on public.admin_player_ratings;
create policy "Anyone can manage admin ratings" on public.admin_player_ratings for all using (true) with check (true);
