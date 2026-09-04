-- ── TOURNAMENT FIXTURE TACTICS ────────────────────────────────────────
-- Run in the Supabase SQL editor. Idempotent - safe to re-run.
-- Run after supabase_match_tactics.sql and supabase_tournament_schedule.sql.
--
-- A tournament fixture (tournament_matches) is a game a squad turns up to and
-- plays, exactly like a friendly — so its captain needs the same lineup and
-- tactics board. It has no matches row, so match_tactics grows a second target
-- alongside match_id, the same way match_confirmations grew open_match_id in
-- supabase_event_availability.sql: one table, one shape, two things a plan can
-- be pinned to. A row targets a match OR a tournament fixture, never both.

alter table public.match_tactics
  add column if not exists tournament_match_id uuid references public.tournament_matches(id) on delete cascade;

-- match_id was NOT NULL when the friendly was the only possibility.
alter table public.match_tactics alter column match_id drop not null;

-- Exactly one target. Without this a row with neither set would be a plan for
-- no game at all, and both set would be a plan two screens disagree about.
alter table public.match_tactics drop constraint if exists match_tactics_one_target;
alter table public.match_tactics add constraint match_tactics_one_target
  check ((match_id is not null) <> (tournament_match_id is not null));

-- The friendly side keeps its unique(match_id, team_id) — a plain unique
-- constraint, which PostgREST can name as an upsert conflict target. The
-- tournament side can't reuse that shape (both columns are nullable, and NULLs
-- don't collide), so it gets a partial unique index instead. That index cannot
-- be an on_conflict target over PostgREST, which is why the page reads its row
-- first and then inserts or updates — same trade-off as match_confirmations.
create unique index if not exists match_tactics_tournament_team_idx
  on public.match_tactics (tournament_match_id, team_id)
  where tournament_match_id is not null;
