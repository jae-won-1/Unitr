-- ════════════════════════════════════════════════════════════════════════
-- UNITER — The joining fee is the team's current fee, for everyone
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run AFTER supabase_joining_fees.sql, supabase_captain_joining_fee.sql and
-- (if it has been run at all) supabase_pilot_security.sql.
--
-- Until now the fee was a SNAPSHOT taken once — at approval for a member, at
-- the first non-zero fee for the captain — and never re-taken. A captain who
-- raised or lowered the fee changed it for people who joined afterwards and
-- for nobody else, so a squad could be carrying three different fees at once
-- and Payment Status compared each person's payments against a number the
-- captain no longer charges.
--
-- The fee is now simply THE TEAM'S FEE. Changing teams.joining_fee_pence
-- restandardises every approved member and the captain onto the new figure:
--
--   • due_pence follows the team's fee, for old members and new;
--   • paid_pence is untouched — money already in is money already in. Raising
--     the fee leaves the difference owed; lowering it below what somebody has
--     paid settles them, and refunds nothing, because a joining fee is a
--     top-up into team credit and that credit is still there.
--
-- Money is in PENCE everywhere.
-- ════════════════════════════════════════════════════════════════════════


-- ── The captain's own copy follows the fee too ──────────────────────────
-- Redefined from supabase_captain_joining_fee.sql: the `is null` guard that
-- made the snapshot permanent is gone, so the captain is charged whatever
-- they are charging the squad.
--
-- This runs AFTER guard_team_money in trigger-name order ('g' < 's'), which
-- is what lets a co-captain save the fee: the guard sees the captain columns
-- untouched and this trigger sets them afterwards.
create or replace function public.snapshot_captain_joining_fee()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.captain_joining_fee_due_pence := coalesce(new.joining_fee_pence, 0);
  return new;
end $fn$;

drop trigger if exists trg_snapshot_captain_joining_fee on public.teams;
create trigger trg_snapshot_captain_joining_fee
  before insert or update of joining_fee_pence on public.teams
  for each row execute function public.snapshot_captain_joining_fee();


-- ── Tell the captain, whenever what they owe goes up ────────────────────
-- Redefined from supabase_captain_joining_fee.sql. It used to fire only on
-- the transition out of null, because the figure could never move again. Now
-- it fires whenever the amount due rises — setting a fee for the first time,
-- or raising it. Lowering it, or a save that leaves the fee alone, says
-- nothing.
create or replace function public.notify_captain_joining_fee()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(new.captain_joining_fee_due_pence, 0) > new.captain_joining_fee_paid_pence
     and (tg_op = 'INSERT'
          or coalesce(new.captain_joining_fee_due_pence, 0)
             > coalesce(old.captain_joining_fee_due_pence, 0))
     and new.captain_id is not null then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.captain_id,
      'joining_fee',
      'Pay your own joining fee',
      'The joining fee for ' || coalesce(new.name, 'your team') || ' is now £'
        || to_char(new.captain_joining_fee_due_pence / 100.0, 'FM999990.00')
        || '. It applies to you too — top up the £'
        || to_char((new.captain_joining_fee_due_pence - new.captain_joining_fee_paid_pence)
                   / 100.0, 'FM999990.00')
        || ' you still owe into team credit from Home. Until it is paid you '
        || 'cannot vote available for games.',
      '/');
  end if;
  return new;
end $fn$;

drop trigger if exists trg_notify_captain_joining_fee on public.teams;
create trigger trg_notify_captain_joining_fee
  after insert or update of joining_fee_pence on public.teams
  for each row execute function public.notify_captain_joining_fee();


-- ── Restandardise the squad on the new fee ──────────────────────────────
-- AFTER trigger on the team: the fee is saved, so every approved member is
-- moved onto it in the same write. Members whose share just went up get a DM
-- from the captain, in the inbox the welcome one arrives in.
--
-- security definer, plus a transaction-local flag that guard_team_member_money
-- (supabase_pilot_security.sql) recognises below: the guard otherwise refuses
-- a due_pence write from anyone but the captain's own session, which would
-- make this fail for a co-captain saving Team Settings.
create or replace function public.restandardise_joining_fee()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_fee integer := coalesce(new.joining_fee_pence, 0);
begin
  if tg_op = 'UPDATE' and coalesce(old.joining_fee_pence, 0) = v_fee then
    return new;                               -- the fee didn't move
  end if;

  if new.captain_id is not null then
    insert into public.messages(sender_id, receiver_id, type, body)
    select new.captain_id, m.player_id, 'payment_reminder',
           'The joining fee for ' || coalesce(new.name, 'the team') || ' is now £'
             || to_char(v_fee / 100.0, 'FM999990.00')
             || '. You have £'
             || to_char((v_fee - m.joining_fee_paid_pence) / 100.0, 'FM999990.00')
             || ' left to pay — use the Top Up button on your Home screen. It goes into '
             || 'the team''s credit balance, which pays for pitch bookings and tournament '
             || 'entry fees. Until it''s paid you can''t vote available for games.'
      from public.team_members m
     where m.team_id = new.id
       and m.status = 'approved'
       and v_fee > coalesce(m.joining_fee_due_pence, 0)   -- their share went up
       and v_fee > m.joining_fee_paid_pence;              -- and isn't covered
  end if;

  perform set_config('uniter.fee_restandardise', new.id::text, true);

  update public.team_members
     set joining_fee_due_pence = v_fee
   where team_id = new.id
     and status = 'approved'
     and joining_fee_due_pence is distinct from v_fee;

  perform set_config('uniter.fee_restandardise', '', true);
  return new;
end $fn$;

drop trigger if exists trg_restandardise_joining_fee on public.teams;
create trigger trg_restandardise_joining_fee
  after insert or update of joining_fee_pence on public.teams
  for each row execute function public.restandardise_joining_fee();


-- ── Let that one write through the money guard ──────────────────────────
-- Redefined from supabase_pilot_security.sql §5, with one branch added: a
-- due_pence change carrying the flag the trigger above sets, for this team,
-- and leaving paid_pence alone. Everything else is unchanged — nobody can
-- still say a payment happened.
--
-- Only redefined if that file has been run; on a database without it there is
-- no guard to teach, and creating the function on its own would do nothing.
do $sec$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'guard_team_member_money') then
    execute $outer$
create or replace function public.guard_team_member_money()
returns trigger language plpgsql security definer set search_path = public as $body$
declare v_uid uuid := auth.uid(); v_captain uuid;
begin
  if public.uniter_trusted_writer() then     -- the webhook's credit path
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new row may not arrive pre-paid. Leaving due_pence null is what lets
    -- trg_snapshot_joining_fee compute the real figure off teams.joining_fee_pence
    -- (that trigger fires after this one — 'g' sorts before 's').
    if coalesce(new.joining_fee_paid_pence, 0) <> 0 then
      new.joining_fee_paid_pence := 0;
    end if;
    if new.joining_fee_due_pence is not null then
      new.joining_fee_due_pence := null;
    end if;
    return new;
  end if;

  if new.joining_fee_paid_pence is not distinct from old.joining_fee_paid_pence
     and new.joining_fee_due_pence is not distinct from old.joining_fee_due_pence then
    return new;                              -- untouched — the usual update
  end if;

  -- restandardise_joining_fee, moving the squad onto a fee a team leader has
  -- just saved. What is owed, never what is paid.
  if new.joining_fee_paid_pence is not distinct from old.joining_fee_paid_pence
     and current_setting('uniter.fee_restandardise', true) = new.team_id::text then
    return new;
  end if;

  select captain_id into v_captain from public.teams where id = new.team_id;
  if v_captain is distinct from v_uid then
    raise exception 'Joining fees are settled by payment, not by editing the record';
  end if;
  return new;
end $body$;
    $outer$;
  end if;
end $sec$;


-- ── Bring every team that already exists onto its own fee ───────────────
-- Silent: the triggers above notify about a change made from now on, and
-- nobody needs a DM about a fee their captain set months ago.
update public.teams
   set captain_joining_fee_due_pence = coalesce(joining_fee_pence, 0)
 where captain_joining_fee_due_pence is distinct from coalesce(joining_fee_pence, 0);

update public.team_members m
   set joining_fee_due_pence = coalesce(t.joining_fee_pence, 0)
  from public.teams t
 where t.id = m.team_id
   and m.status = 'approved'
   and m.joining_fee_due_pence is distinct from coalesce(t.joining_fee_pence, 0);
