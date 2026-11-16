-- UNITER — Venue opening hours (pitch_availability)
--
-- The venue portal's Settings → Schedule tab saves a pitch's weekly opening
-- hours here, and lib/pitch-day.ts reads them when it draws a day's bookable
-- hours. supabase_venue.sql created this table with a policy that let anyone
-- write any venue's hours, and it was never run on the live database — so
-- Save Schedule had nowhere to write. This file replaces that part of it.
--
-- Run after supabase_pitch_bookings_lockdown.sql (uniter_owns_pitch).
-- Idempotent. Seeds nothing: a pitch with no rows keeps the default
-- 07:00–22:00 every day until its venue saves a schedule.

create table if not exists public.pitch_availability (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid references public.pitches(id) on delete cascade not null,
  day_of_week integer not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  open_time text not null,    -- "09:00"
  close_time text not null,   -- "22:00"
  is_active boolean default true,
  created_at timestamptz default now(),
  unique (pitch_id, day_of_week)
);

alter table public.pitch_availability enable row level security;

drop policy if exists "Anyone can view availability"          on public.pitch_availability;
drop policy if exists "Venue owners can manage availability"  on public.pitch_availability;
drop policy if exists "Owners add their pitch hours"          on public.pitch_availability;
drop policy if exists "Owners change their pitch hours"       on public.pitch_availability;
drop policy if exists "Owners remove their pitch hours"       on public.pitch_availability;

-- Everyone picking a pitch reads the hours; only the pitch's own venue writes.
create policy "Anyone can view availability" on public.pitch_availability
  for select using (true);
create policy "Owners add their pitch hours" on public.pitch_availability
  for insert with check (public.uniter_owns_pitch(pitch_id));
create policy "Owners change their pitch hours" on public.pitch_availability
  for update using (public.uniter_owns_pitch(pitch_id)) with check (public.uniter_owns_pitch(pitch_id));
create policy "Owners remove their pitch hours" on public.pitch_availability
  for delete using (public.uniter_owns_pitch(pitch_id));

-- Check afterwards, signed in as a venue: Settings → Schedule → change a day →
-- Save Schedule → reload; the change is still there. Signed in as anyone else,
-- this should change nothing:
--   await supabase.from('pitch_availability').update({ is_active: false }).eq('pitch_id', '<a pitch id>').select()
