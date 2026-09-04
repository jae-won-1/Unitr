-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Availability for tournament entries
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run after supabase_open_matches.sql and supabase_ringers.sql.
--
-- A captain does not always run an availability poll before committing the
-- team. They see a tournament on the home feed and enter it, or they take a
-- match straight off the feed — and then still have to pick a matchday squad
-- and settle the fee afterwards. Matches were already covered: accepting a
-- challenge writes a pending match_confirmations row per squad member
-- (components/ChallengePanel.tsx) and everyone answers from Home or the
-- Calendar. Tournaments had nowhere to record the same answer, because a
-- tournament entry has no matches row — it lives in open_matches +
-- open_match_teams.
--
-- So match_confirmations gains a second target, exactly the way
-- payment_collection_status did in supabase_tournament_payment_collection.sql:
-- a row points at EITHER a match or an open_match, never both and never
-- neither.
-- ════════════════════════════════════════════════════════════════════════

-- ── A confirmation can target a match OR a tournament ────────────────────
alter table public.match_confirmations
  alter column match_id drop not null;

alter table public.match_confirmations
  add column if not exists open_match_id uuid references public.open_matches(id) on delete cascade;

-- Exactly one target per row. Every existing row carries a match_id, so this
-- validates cleanly against current data.
alter table public.match_confirmations
  drop constraint if exists match_confirmation_target_chk;
alter table public.match_confirmations
  add constraint match_confirmation_target_chk
  check (num_nonnulls(match_id, open_match_id) = 1);

-- The table's existing unique(match_id, player_id) is deliberately left in
-- place: PostgREST's upsert on the match side names it as the conflict target
-- (`onConflict: "match_id,player_id"`), and dropping it for a pair of partial
-- indexes — as the payment tables did — would break that write. It no longer
-- guards tournament rows though, since Postgres treats every NULL match_id as
-- distinct, so those get their own partial index. Nothing upserts against this
-- one: the tournament write path reads the row first and then inserts or
-- updates it (lib/event-availability.ts), which needs no conflict target.
create unique index if not exists match_confirmations_open_match_player_uniq
  on public.match_confirmations (open_match_id, player_id)
  where open_match_id is not null;

-- The captain's squad view for one tournament.
create index if not exists match_confirmations_open_match_idx
  on public.match_confirmations (open_match_id, team_id);
