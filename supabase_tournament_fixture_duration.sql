-- How long one tournament fixture runs.
-- Run in the Supabase SQL editor. Idempotent - safe to re-run.
-- Run after supabase_tournament_schedule.sql.
--
-- The organiser is asked for a match length and a break between matches before
-- a schedule is generated (/play/tournament/[id]). The break only shapes where
-- the kickoffs land and is not worth keeping; the length is a fact about each
-- game, so it is stored per fixture and the schedule can show a finish time to
-- everyone reading it, not just to the organiser who typed it.
--
-- Nullable on purpose: fixtures generated before this migration, and any added
-- by hand while the settings were blank, simply have no finish time.

alter table public.tournament_matches
  add column if not exists duration_minutes integer;
