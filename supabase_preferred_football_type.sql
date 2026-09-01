-- ════════════════════════════════════════════════════════════════════════
-- UNITR — What kind of football a player actually wants
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Collected at registration, next to position, experience and games per month.
-- Those three describe a player; this one describes what they are here for,
-- which is the question player-team matching actually turns on. Someone after
-- a Sunday kickabout and someone chasing a league place are both "Casual" at
-- experience level and should not be shown the same teams.
--
-- Note the first option means the player does not want a team at all — they
-- are here for fill-in games. That is a legitimate end state, not an
-- unfinished signup, and the new_user home should eventually stop nagging
-- those players to join one. It does not do that yet.
--
-- Stored as a short stable key rather than the button label, so the copy can
-- change without a data migration:
--
--   'casual'      — No Team (Casual Kickabout)
--   'friendly'    — Team Friendly matches
--   'competitive' — Competitive Team Matches (leagues / tournaments)
--
-- Deliberately nullable: every profile created before this migration has no
-- answer and there is no honest default to invent. Read sites must handle
-- null rather than assuming 'casual'.
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists preferred_football_type text;


-- ── Notes ───────────────────────────────────────────────────────────────
-- • Written by app/register/page.tsx at sign-up. Nothing reads it yet — it is
--   not shown on /profile or the Transfer Market player cards, and no
--   matchmaking uses it.
-- • Deliberately NOT mirrored onto teams. The team form's own Level field
--   (Casual / Competitive / Semi-Pro) already covers a team's ambition, and
--   'casual' here means "no team", which cannot describe a team.
-- • Pairs with games_per_month from supabase_play_frequency.sql — that one is
--   how often, this one is what for. Run both.
-- • RLS: profiles already has row-level security from supabase_core_tables_rls
--   .sql, and a new column inherits the table's existing policies — the
--   own-row UPDATE policy covers it with no further change.
