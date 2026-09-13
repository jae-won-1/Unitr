-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Several formats per team, several positions per player
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Registration asks each of these as a single choice, and that answer is
-- stored in a scalar text column: teams.format ("7-a-side") and
-- profiles.position ("CM"). Both are read all over the app — teams.format
-- decides how many dots a tactics board draws (teamSizeFromFormat), and both
-- back exact-match filters in the Transfer Market and the squad list.
--
-- A team that plays 5s *and* 7s, or a player who covers CM and CAM, could not
-- say so. This adds an array beside each scalar rather than replacing it:
--
--   • the array is the full answer, and the editors write it
--   • the scalar stays the PRIMARY value (array[1]) and every existing reader
--     keeps working untouched — a lineup still knows its team size, an
--     un-migrated filter still matches the primary
--
-- lib/team-options.ts and lib/profile-options.ts are the only places these are
-- read or written; both fall back to the scalar when the array is null, so the
-- app works before this file is run and simply offers one choice.
-- ════════════════════════════════════════════════════════════════════════

-- ── Teams: preferred players per side ───────────────────────────────────
alter table public.teams
  add column if not exists formats text[];

-- Backfill: every existing team's single format becomes a one-element array,
-- so the editors open showing what the team already plays rather than blank.
update public.teams
   set formats = array[format]
 where formats is null
   and format is not null
   and format <> '';


-- ── Profiles: positions played ──────────────────────────────────────────
alter table public.profiles
  add column if not exists positions text[];

update public.profiles
   set positions = array[position]
 where positions is null
   and position is not null
   and position <> '';


-- ── Notes ───────────────────────────────────────────────────────────────
-- • RLS: both tables already have policies (supabase_core_tables_rls.sql) and
--   a new column inherits them — profiles' own-row UPDATE policy and teams'
--   permissive one cover these with no further change. The team editor is
--   gated in the app by loadLeadership(), like the rest of Team Settings.
-- • The scalar is never dropped. Doing so would mean rewriting teamSizeFromFormat
--   and a dozen display sites in the same change, and would break any row an
--   older client wrote. Keeping both costs one extra write per save.
-- • Values are the same option strings the forms offer — "5-a-side" /
--   "7-a-side" / "8-a-side" / "11-a-side" and the ten position codes. Anything
--   else is from a hand-edited row; the editors drop unknown values on save.
