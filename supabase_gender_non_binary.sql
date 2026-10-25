-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Non-binary as a gender answer
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run after supabase_gender_categories.sql.
--
-- profiles.gender takes 'non_binary' again. It is who the player is, not a
-- competition: teams and games stay male | female (gender_category is
-- untouched). A non-binary player is treated like one who preferred not to
-- say — they see every game by default and no fill-in game refuses them
-- (lib/gender.ts categoryForGender, lib/gender-entry.ts).
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check
  check (gender is null or gender in ('male', 'female', 'non_binary', 'prefer_not_to_say'));
