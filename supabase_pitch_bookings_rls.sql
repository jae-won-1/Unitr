-- ════════════════════════════════════════════════════════════════════════
-- UNITR — RLS for pitch_bookings
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- supabase_core_tables_rls.sql covered the nine tables that no migration
-- creates. pitch_bookings was not one of them: supabase_pitches.sql creates it
-- AND enables RLS on it, so on paper it was already done. In this project it
-- is not, and the linter still reports rls_disabled_in_public for it.
--
-- The reason is that supabase_pitches.sql is the one migration in the repo
-- that is NOT idempotent — bare `create table` / `create policy` with no
-- guards — and it carries a latent bug: its seed `insert` lists lat and lng,
-- which its own `create table public.pitches (...)` never defines. The script
-- therefore dies partway through, and every statement after the failure point
-- is skipped. pitch_bookings' `enable row level security` and its three
-- policies all sit downstream of that. Re-running the file to fix this does
-- not work: it fails again on `create table public.pitches` already existing.
--
-- So this file re-states just that tail, guarded so it can be run on a
-- database in any of these states.
-- ════════════════════════════════════════════════════════════════════════

alter table public.pitch_bookings enable row level security;

-- Bookings are readable by anyone: they populate the venue calendar, the
-- Calendar page's pitch-booking entries and the availability checks that stop
-- a slot being double-booked, all of which read rows the viewer does not own.
drop policy if exists "Anyone can view bookings" on public.pitch_bookings;
create policy "Anyone can view bookings" on public.pitch_bookings
  for select using (true);

-- You can only book as yourself. All four insert sites already pass
-- booked_by: user.id — BookPitchPanel, ChallengePanel, the venue calendar's
-- two composers and the tournament composer — so this costs nothing.
drop policy if exists "Authenticated users can create bookings" on public.pitch_bookings;
create policy "Authenticated users can create bookings" on public.pitch_bookings
  for insert with check (auth.uid() = booked_by);

-- Left open: a venue manager confirms or cancels a booking they did not make,
-- ChallengePanel attaches a post_id to the poster's booking, and the credit
-- and payment-sync paths flip payment_status on other people's rows.
drop policy if exists "Booking owner can update" on public.pitch_bookings;
create policy "Booking owner can update" on public.pitch_bookings
  for update using (true);

-- NOT in supabase_pitches.sql, and the reason this file exists rather than a
-- copy-paste of that tail. Enabling RLS with only the three policies above
-- would silently break app/venue/calendar/page.tsx:466 — the rollback that
-- deletes a just-created booking when the open_matches insert fails after it.
-- An RLS-filtered delete matches zero rows and reports no error, so the
-- failure is invisible and the orphaned booking stays on the venue calendar
-- holding a slot nobody can play on.
--
-- Scoped to the booker because that rollback only ever deletes a row it just
-- created with booked_by = the current user; it is the only delete path in
-- the app.
drop policy if exists "Booking owner can delete" on public.pitch_bookings;
create policy "Booking owner can delete" on public.pitch_bookings
  for delete using (auth.uid() = booked_by);


-- ── Verify ──────────────────────────────────────────────────────────────
--   select tablename from pg_tables
--    where schemaname = 'public' and not rowsecurity
--    order by tablename;
--
-- Should now return zero rows.


-- ── Still worth fixing, separately ──────────────────────────────────────
-- supabase_pitches.sql remains broken for anyone setting up a fresh database:
-- it is not re-runnable, and its seed insert references lat/lng columns that
-- its create table does not declare. Nothing in a working project depends on
-- repairing it, but a new environment cannot be built from the repo as it
-- stands without hitting the same wall.
