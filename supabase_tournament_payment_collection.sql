-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Collect Payment for tournament entry fees
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Captains can already tick off who owes a share of a MATCH fee from Match
-- History (supabase_payment_collection.sql). Tournaments couldn't use that
-- flow: payment_collection_status.match_id and messages.match_id both FK
-- matches(id), and a tournament entry has no matches row — it lives in
-- open_matches + open_match_teams.
--
-- This widens both tables so a charge can target EITHER a match or a
-- tournament, and gives open_match_teams the per-team "fully settled" flag
-- that matches.fees_settled provides on the match side.
-- ════════════════════════════════════════════════════════════════════════

-- ── payment_collection_status: target a match OR a tournament ────────────
alter table public.payment_collection_status
  alter column match_id drop not null;

alter table public.payment_collection_status
  add column if not exists open_match_id uuid references public.open_matches(id) on delete cascade;

-- Exactly one target per row. Existing rows all carry a match_id, so this
-- validates cleanly against current data.
alter table public.payment_collection_status
  drop constraint if exists payment_collection_target_chk;
alter table public.payment_collection_status
  add constraint payment_collection_target_chk
  check (num_nonnulls(match_id, open_match_id) = 1);

-- The old unique(match_id, player_id) can't express "one row per player per
-- target" once match_id is nullable — Postgres treats every NULL as distinct,
-- so it would stop guarding tournament rows entirely. Replace it with a
-- partial unique index per target. (Constraint name varies by how the table
-- was first created, so drop whatever unique constraints exist.)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.payment_collection_status'::regclass and contype = 'u'
  loop
    execute format('alter table public.payment_collection_status drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists payment_collection_match_player_uniq
  on public.payment_collection_status (match_id, player_id) where match_id is not null;
create unique index if not exists payment_collection_open_match_player_uniq
  on public.payment_collection_status (open_match_id, player_id) where open_match_id is not null;

create index if not exists payment_collection_open_match_idx
  on public.payment_collection_status (open_match_id, team_id);


-- ── messages: a payment reminder can point at a tournament ───────────────
alter table public.messages
  add column if not exists open_match_id uuid references public.open_matches(id);


-- ── open_match_teams: the tournament analogue of matches.fees_settled ─────
-- Settlement is PER ENTERED TEAM (each team collects from its own squad),
-- which is exactly the grain of open_match_teams.
alter table public.open_match_teams
  add column if not exists fees_settled boolean not null default false;
