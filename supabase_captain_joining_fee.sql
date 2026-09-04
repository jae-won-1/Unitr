-- ════════════════════════════════════════════════════════════════════════
-- UNITR — The captain owes the joining fee too
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run AFTER supabase_joining_fees.sql (it redefines
-- apply_deposit_to_joining_fee from that file).
--
-- A joining fee is the squad's buy-in to its own credit balance: it pays for
-- pitches and tournament entries the whole team then plays in. The captain
-- plays in those games as well, so the captain pays it as well. Until this
-- file, they didn't — not by decision, but because the bookkeeping lives on
-- `team_members` and a captain has no row there.
--
-- So the captain's copy of the same two numbers lives on `teams`:
--
--   teams.captain_joining_fee_due_pence  — snapshot of the fee, taken the
--       first time the captain sets a non-zero one. Null until then.
--   teams.captain_joining_fee_paid_pence — how much of it is covered.
--
-- The snapshot rule matches the squad's exactly: taken once, never re-taken.
-- A captain who later raises the fee is not re-charged, the same way the
-- squad they already have isn't.
--
-- "Paid" is advanced in exactly one place — apply_deposit_to_joining_fee,
-- called only from credit_from_payment (verified Stripe payment) and
-- record_cash_credit (captain's cash path). The browser still cannot say a
-- payment happened.
--
-- The consequence the captain feels: lib/joining-fee.ts reads these columns
-- for a captain, so the same gates the squad live under apply to them —
-- no voting available, no joining games, until the fee is in — and a bell
-- notification tells them the moment the fee is set.
--
-- Money is in PENCE everywhere.
-- ════════════════════════════════════════════════════════════════════════

alter table public.teams
  add column if not exists captain_joining_fee_due_pence  integer,
  add column if not exists captain_joining_fee_paid_pence integer not null default 0;


-- ── Legacy `notifications.player_id` ────────────────────────────────────
-- Some databases carry an older notifications table whose `player_id` column
-- is NOT NULL, predating supabase_tournament_schedule.sql standardising on
-- `user_id`. Every insert in the app — referee assignments, tournament
-- invites, and the one below — writes `user_id` only, so that constraint
-- fails the write. The browser swallows the error; SQL doesn't.
--
-- Relax it where it exists and backfill from user_id, so one shape works
-- everywhere. Deliberately repeated in supabase_co_captains.sql: each
-- migration has to stand on its own.
do $fix$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications'
       and column_name = 'player_id' and is_nullable = 'NO'
  ) then
    update public.notifications set player_id = user_id
      where player_id is null and user_id is not null;
    alter table public.notifications alter column player_id drop not null;
  end if;
end $fix$;


-- ── Snapshot the captain's own fee ──────────────────────────────────────
-- BEFORE trigger so the snapshot rides the same write that sets the fee,
-- whether that's the team's first insert (register a team with a fee) or a
-- later edit in Team Settings.
create or replace function public.snapshot_captain_joining_fee()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if coalesce(new.joining_fee_pence, 0) > 0
     and new.captain_joining_fee_due_pence is null then
    new.captain_joining_fee_due_pence := new.joining_fee_pence;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_snapshot_captain_joining_fee on public.teams;
create trigger trg_snapshot_captain_joining_fee
  before insert or update of joining_fee_pence on public.teams
  for each row execute function public.snapshot_captain_joining_fee();


-- ── Tell the captain ────────────────────────────────────────────────────
-- AFTER trigger, fired on the transition into "owing" — so setting a fee
-- notifies once, and saving Team Settings again doesn't nag.
--
-- A bell notification rather than a DM: the squad's version arrives as a
-- message from the captain, and a message from yourself to yourself reads
-- like a bug.
create or replace function public.notify_captain_joining_fee()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.captain_joining_fee_due_pence is not null
     and (tg_op = 'INSERT' or old.captain_joining_fee_due_pence is null)
     and new.captain_joining_fee_due_pence > new.captain_joining_fee_paid_pence
     and new.captain_id is not null then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.captain_id,
      'joining_fee',
      'Pay your own joining fee',
      'You set a £'
        || to_char(new.captain_joining_fee_due_pence / 100.0, 'FM999990.00')
        || ' joining fee for ' || coalesce(new.name, 'your team')
        || '. It applies to you too — top up that much into team credit from '
        || 'Home. Until it is paid you cannot vote available for games.',
      '/');
  end if;
  return new;
end $fn$;

drop trigger if exists trg_notify_captain_joining_fee on public.teams;
create trigger trg_notify_captain_joining_fee
  after insert or update of joining_fee_pence on public.teams
  for each row execute function public.notify_captain_joining_fee();


-- ── Teams that already had a fee when this file was first run ───────────
-- The triggers above only fire on a write to joining_fee_pence, so a team
-- whose fee was set before this migration existed would never get a
-- snapshot. Backfill it, and tell those captains once — the `not exists`
-- guard is what keeps a re-run from notifying them again.
insert into public.notifications(user_id, type, title, body, link)
select t.captain_id, 'joining_fee', 'Pay your own joining fee',
       'You set a £' || to_char(t.joining_fee_pence / 100.0, 'FM999990.00')
       || ' joining fee for ' || coalesce(t.name, 'your team')
       || '. It applies to you too — top up that much into team credit from '
       || 'Home. Until it is paid you cannot vote available for games.',
       '/'
  from public.teams t
 where coalesce(t.joining_fee_pence, 0) > 0
   and t.captain_joining_fee_due_pence is null
   and t.captain_id is not null
   and not exists (
     select 1 from public.notifications n
      where n.user_id = t.captain_id and n.type = 'joining_fee');

update public.teams
   set captain_joining_fee_due_pence = joining_fee_pence
 where coalesce(joining_fee_pence, 0) > 0
   and captain_joining_fee_due_pence is null;


-- ════════════════════════════════════════════════════════════════════════
-- apply_deposit_to_joining_fee — redefined from supabase_joining_fees.sql
-- ════════════════════════════════════════════════════════════════════════
-- Same contract as before: given a deposit, pay down whatever joining fee
-- the depositor owes this team, capped at what they owe. The addition is the
-- captain branch — a captain has no team_members row, so their fee is on
-- `teams`. Exactly one of the two updates can ever match.
create or replace function public.apply_deposit_to_joining_fee(
  p_team_id uuid, p_player_id uuid, p_amount_pence integer
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_player_id is null or p_amount_pence is null or p_amount_pence <= 0 then
    return;
  end if;

  update public.team_members
    set joining_fee_paid_pence = least(
          coalesce(joining_fee_due_pence, 0),
          joining_fee_paid_pence + p_amount_pence)
    where team_id = p_team_id
      and player_id = p_player_id
      and status = 'approved'
      and joining_fee_paid_pence < coalesce(joining_fee_due_pence, 0);

  update public.teams
    set captain_joining_fee_paid_pence = least(
          coalesce(captain_joining_fee_due_pence, 0),
          captain_joining_fee_paid_pence + p_amount_pence)
    where id = p_team_id
      and captain_id = p_player_id
      and captain_joining_fee_paid_pence < coalesce(captain_joining_fee_due_pence, 0);
end $fn$;

revoke execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) from public;
revoke execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) from anon;
revoke execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) from authenticated;
grant  execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) to service_role;
