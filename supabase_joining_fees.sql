-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Team joining fees migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Requires supabase_payment_integrity.sql to have run first (it redefines
-- credit_from_payment / record_cash_credit from that file).
--
-- A captain can set a joining fee for their team. The fee is not a separate
-- pot: it is simply a top-up into the team's credit balance, which then pays
-- pitch fees and tournament buy-ins like any other credit. What this file
-- adds is the BOOKKEEPING of who has covered theirs:
--
--   teams.joining_fee_pence            — the fee the captain currently asks
--   team_members.joining_fee_due_pence — snapshot of that fee at the moment
--                                        the member was approved. Raising the
--                                        fee later never re-charges the squad.
--   team_members.joining_fee_paid_pence— how much of the snapshot is covered.
--
-- "Paid" is only ever advanced inside credit_from_payment (Stripe webhook /
-- saved-card settle) and record_cash_credit (captain's cash path) — the same
-- rule as credit itself: the browser cannot prove a payment happened, so it
-- never gets to say one did. A player's first money in covers their joining
-- fee; anything beyond it is ordinary team credit.
--
-- Money is in PENCE everywhere.
-- ════════════════════════════════════════════════════════════════════════

alter table public.teams
  add column if not exists joining_fee_pence integer not null default 0;

alter table public.team_members
  add column if not exists joining_fee_due_pence integer,
  add column if not exists joining_fee_paid_pence integer not null default 0;


-- ── Snapshot the fee when a member is approved ──────────────────────────
-- BEFORE trigger so the snapshot rides the same write as the approval.
-- Covers every approval path (My Team join requests, transfer-market offers)
-- without each call site having to remember.
create or replace function public.snapshot_joining_fee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and new.joining_fee_due_pence is null then
    select coalesce(t.joining_fee_pence, 0) into new.joining_fee_due_pence
      from public.teams t where t.id = new.team_id;
    new.joining_fee_due_pence := coalesce(new.joining_fee_due_pence, 0);
  end if;
  return new;
end $$;

drop trigger if exists trg_snapshot_joining_fee on public.team_members;
create trigger trg_snapshot_joining_fee
  before insert or update of status on public.team_members
  for each row execute function public.snapshot_joining_fee();

-- Members approved before this migration owe nothing — the fee didn't exist
-- when they joined. New approvals always get a non-null snapshot from the
-- trigger above, so re-running this only ever touches pre-migration rows.
update public.team_members
  set joining_fee_due_pence = 0
  where status = 'approved' and joining_fee_due_pence is null;


-- ── Tell the player, the moment they're in ──────────────────────────────
-- AFTER trigger: the membership row exists, so the DM can reference it.
-- Sent from the captain, in the same inbox payment reminders arrive in.
create or replace function public.notify_joining_fee()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_team record;
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved')
     and coalesce(new.joining_fee_due_pence, 0) > new.joining_fee_paid_pence then
    select t.name, t.captain_id into v_team
      from public.teams t where t.id = new.team_id;
    if v_team.captain_id is not null then
      insert into public.messages(sender_id, receiver_id, type, body)
      values (
        v_team.captain_id,
        new.player_id,
        'payment_reminder',
        'Welcome to ' || coalesce(v_team.name, 'the team') || '! Please pay the £'
          || to_char(coalesce(new.joining_fee_due_pence, 0) / 100.0, 'FM999990.00')
          || ' joining fee using the Top Up button on your Home screen. It goes into the team''s credit balance, which pays for pitch bookings and tournament entry fees. Until it''s paid you can''t join or vote available for games.'
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_joining_fee on public.team_members;
create trigger trg_notify_joining_fee
  after insert or update of status on public.team_members
  for each row execute function public.notify_joining_fee();


-- ── Deposits pay the joining fee down first ─────────────────────────────
-- Shared by both credit paths below. No-op for captains (no team_members
-- row), settled members, and anonymous deposits.
create or replace function public.apply_deposit_to_joining_fee(
  p_team_id uuid, p_player_id uuid, p_amount_pence integer
) returns void language plpgsql security definer set search_path = public as $$
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
end $$;

revoke execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) from public;
revoke execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) from anon;
revoke execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) from authenticated;
grant  execute on function public.apply_deposit_to_joining_fee(uuid, uuid, integer) to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- credit_from_payment — redefined from supabase_payment_integrity.sql
-- ════════════════════════════════════════════════════════════════════════
-- Identical to the original (idempotent on the PaymentIntent id), plus the
-- joining-fee bookkeeping. The fee update sits INSIDE the "first delivery
-- wins" branch, so a replayed Stripe event can't count the same payment
-- toward the fee twice.
create or replace function public.credit_from_payment(
  p_team_id           uuid,
  p_amount_pence      integer,
  p_player_id         uuid,
  p_payment_intent_id text
) returns integer language plpgsql security definer set search_path = public as $$
declare v_new integer; v_inserted integer;
begin
  if p_payment_intent_id is null or p_payment_intent_id = '' then
    raise exception 'credit_from_payment requires a PaymentIntent id';
  end if;
  if p_amount_pence is null or p_amount_pence <= 0 then
    raise exception 'credit_from_payment requires a positive amount';
  end if;

  -- Claim the payment FIRST. The unique index decides who wins, so two
  -- deliveries of the same event racing each other can't both credit — the
  -- loser inserts nothing and returns the balance untouched.
  insert into public.team_credit_transactions(
    team_id, player_id, type, amount_pence, stripe_payment_intent_id)
    values (p_team_id, p_player_id, 'deposit', p_amount_pence, p_payment_intent_id)
    on conflict (stripe_payment_intent_id) where stripe_payment_intent_id is not null
    do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then                             -- already credited
    select balance_pence into v_new from public.team_credits where team_id = p_team_id;
    return coalesce(v_new, 0);
  end if;

  insert into public.team_credits(team_id, balance_pence) values (p_team_id, p_amount_pence)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + p_amount_pence, updated_at = now()
    returning balance_pence into v_new;

  perform public.apply_deposit_to_joining_fee(p_team_id, p_player_id, p_amount_pence);

  return v_new;
end $$;

revoke execute on function public.credit_from_payment(uuid, integer, uuid, text) from public;
revoke execute on function public.credit_from_payment(uuid, integer, uuid, text) from anon;
revoke execute on function public.credit_from_payment(uuid, integer, uuid, text) from authenticated;
grant  execute on function public.credit_from_payment(uuid, integer, uuid, text) to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- record_cash_credit — redefined from supabase_payment_integrity.sql
-- ════════════════════════════════════════════════════════════════════════
-- Same captain-only cash path, plus the joining-fee bookkeeping — a player
-- who hands the captain cash for their joining fee is settled the same way.
create or replace function public.record_cash_credit(
  p_team_id      uuid,
  p_amount_pence integer,
  p_player_id    uuid
) returns integer language plpgsql security definer set search_path = public as $$
declare v_new integer;
begin
  if p_amount_pence is null or p_amount_pence <= 0 then
    raise exception 'record_cash_credit requires a positive amount';
  end if;
  if not exists (
    select 1 from public.teams t where t.id = p_team_id and t.captain_id = auth.uid()
  ) then
    raise exception 'Only the team captain can record a cash payment';
  end if;

  insert into public.team_credits(team_id, balance_pence) values (p_team_id, p_amount_pence)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + p_amount_pence, updated_at = now()
    returning balance_pence into v_new;

  insert into public.team_credit_transactions(team_id, player_id, type, amount_pence)
    values (p_team_id, p_player_id, 'deposit', p_amount_pence);

  perform public.apply_deposit_to_joining_fee(p_team_id, p_player_id, p_amount_pence);

  return v_new;
end $$;

grant execute on function public.record_cash_credit(uuid, integer, uuid) to authenticated;
grant execute on function public.record_cash_credit(uuid, integer, uuid) to service_role;
