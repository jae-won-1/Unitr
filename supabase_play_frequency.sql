-- ════════════════════════════════════════════════════════════════════════
-- UNITR — How often a player plays, per month
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Collected at registration. It is the first availability signal the platform
-- gets about a player: experience says how good someone is, this says how much
-- they actually turn out, which is a different question and the one captains
-- ask first when filling a squad.
--
-- Stored as a bucket string rather than a number because it is self-reported
-- and approximate — "3-5" is honest in a way that "4" is not. The buckets are
-- the same four the register form offers; anything else is a value from an
-- older or hand-edited row and should be treated as unset.
--
--   '1-2' | '3-5' | '6-9' | '10+'
--
-- Deliberately nullable: every profile created before this migration has no
-- answer, and there is no sensible default to invent for them. Read sites must
-- handle null (show nothing, not "0 games").
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists games_per_month text;


-- ── Notes ───────────────────────────────────────────────────────────────
-- • Written by app/register/page.tsx at sign-up. Not yet surfaced anywhere —
--   /profile and the Transfer Market player cards do not read it. Adding it to
--   those is a display change, not a schema one.
-- • The eventual matchmaking use is ranking a player against a team's fixture
--   load, so a team playing weekly is not matched with someone who plays twice
--   a month. That algorithm does not exist yet (see CLAUDE.md, "Technical
--   areas still requiring real expertise").
-- • RLS: profiles already has row-level security from supabase_core_tables_rls
--   .sql. Adding a column inherits the table's existing policies — the own-row
--   UPDATE policy covers this column with no further change.
