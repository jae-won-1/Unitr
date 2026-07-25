-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Team Profile migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Adds team history, play style, and a team photo to the teams table so
-- captains can flesh out their team's public profile. Shown on the team
-- profile page (app/my-team/[teamId]) to help match players to teams.
-- ════════════════════════════════════════════════════════════════════════

alter table public.teams
  add column if not exists history text,
  add column if not exists play_style text,
  add column if not exists photo_url text;
