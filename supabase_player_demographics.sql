-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Age group and gender
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Collected at registration, alongside position, experience, games per month
-- and preferred football type. Both are self-reported buckets rather than a
-- free-text age or a strict binary, for the same reason games_per_month is a
-- bucket: an honest approximate answer beats a precise-looking one, and a
-- closed set is what the eventual "Gender" / "Age" team-discovery filters in
-- components/TeamsPanel.tsx (currently greyed as UNWIRED — no columns back
-- them) will need to match against.
--
--   age_group: 'under-18' | '18-24' | '25-34' | '35-44' | '45+'
--   gender:    'male' | 'female' | 'non_binary' | 'prefer_not_to_say'
--
-- Stored as short stable keys rather than the button label, so the copy can
-- change without a data migration.
--
-- Deliberately nullable: every profile created before this migration has no
-- answer and there is no honest default to invent. Read sites must handle
-- null rather than assuming a bucket.
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists age_group text;

alter table public.profiles
  add column if not exists gender text;


-- ── Notes ───────────────────────────────────────────────────────────────
-- • Written by app/register/page.tsx at sign-up, both required there (same as
--   position/experience/games_per_month/preferred_football_type) — 'prefer_
--   not_to_say' is itself a valid, selectable answer for gender, so requiring
--   a choice never forces disclosure.
-- • Not yet surfaced anywhere — /profile, the Transfer Market player cards and
--   the TeamsPanel filters don't read either column. Wiring them up is a
--   display change, not a schema one.
-- • RLS: profiles already has row-level security from supabase_core_tables_rls
--   .sql. Adding a column inherits the table's existing policies — the
--   own-row UPDATE policy covers both with no further change.
