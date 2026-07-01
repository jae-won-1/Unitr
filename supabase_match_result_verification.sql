-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Match Result Verification migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- When both teams have submitted their result, we cross-check the scores.
-- If they agree the result is verified; if they conflict the submissions
-- are cleared and both captains are notified to re-submit.
-- ════════════════════════════════════════════════════════════════════════

alter table public.matches
  add column if not exists result_verified boolean not null default false;

alter table public.match_result_players
  add column if not exists assists integer not null default 0;
