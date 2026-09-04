-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Refunds
-- Run in the Supabase SQL editor, AFTER supabase_payment_integrity.sql and
-- supabase_joining_fees.sql. Idempotent — safe to re-run.
--
-- Until now money only ever moved one way. 'refund' was listed as a valid
-- team_credit_transactions type in supabase_credit_ledger.sql and nothing
-- wrote one, so a card refunded in the Stripe dashboard left the team's
-- credit untouched: cash out, credit still there, ledger silently wrong.
--
-- Two things use this:
--
--   1. The Stripe webhook. Any refund — dashboard, API, or ours — arrives as
--      charge.refunded and reverses the credit it originally granted.
--   2. /api/credit/refund, the captain's cash-out: leftover team credit paid
--      back to the cards that funded it.
--
-- Money is in PENCE everywhere.
-- ════════════════════════════════════════════════════════════════════════


-- ── Tie a refund row to the Stripe refund that caused it ────────────────
-- Its own column rather than reusing stripe_payment_intent_id: that one
-- carries a unique index (one credit per PaymentIntent), and a refund of a
-- deposit would collide with the deposit it reverses.
alter table public.team_credit_transactions
  add column if not exists stripe_refund_id text,
  add column if not exists refunded_payment_intent_id text;

-- Idempotency: one ledger row per Stripe refund, no matter how many times
-- the event is delivered or the route retried.
create unique index if not exists team_credit_tx_refund_uniq
  on public.team_credit_transactions (stripe_refund_id)
  where stripe_refund_id is not null;

-- The cash-out reads deposits per player to work out who funded what.
create index if not exists team_credit_tx_team_type_idx
  on public.team_credit_transactions (team_id, type);


-- ════════════════════════════════════════════════════════════════════════
-- refund_credit — the only way credit leaves as a refund
-- ════════════════════════════════════════════════════════════════════════
-- Debits the team's balance and records a signed negative 'refund' row,
-- idempotent on the Stripe refund id. Returns the resulting balance.
--
-- p_allow_negative distinguishes the two callers:
--
--   false (the cash-out) — refuse if the team hasn't got the credit. The
--     Stripe refund is only issued once this succeeds, so a team can never
--     cash out money it has already spent.
--
--   true (the webhook) — the refund has ALREADY happened at Stripe, possibly
--     against credit the team spent weeks ago. Reversing it can drive the
--     balance negative, and that is the honest answer: the team owes it. A
--     negative balance simply fails the available-credit checks until it is
--     topped back up. Clamping at zero would leave the ledger and the bank
--     disagreeing, which is the exact failure this file exists to prevent.
create or replace function public.refund_credit(
  p_team_id           uuid,
  p_amount_pence      integer,
  p_player_id         uuid,
  p_stripe_refund_id  text,
  p_payment_intent_id text default null,
  p_allow_negative    boolean default false
) returns integer language plpgsql security definer set search_path = public as $$
declare v_new integer; v_balance integer; v_reserved integer; v_inserted integer;
begin
  if p_stripe_refund_id is null or p_stripe_refund_id = '' then
    raise exception 'refund_credit requires a Stripe refund id';
  end if;
  if p_amount_pence is null or p_amount_pence <= 0 then
    raise exception 'refund_credit requires a positive amount';
  end if;

  -- Claim the refund first, exactly as credit_from_payment claims a payment:
  -- the unique index decides who wins, so a redelivered event finds the row
  -- already there and returns the balance untouched instead of debiting twice.
  insert into public.team_credit_transactions(
    team_id, player_id, type, amount_pence,
    stripe_refund_id, refunded_payment_intent_id)
    values (p_team_id, p_player_id, 'refund', -p_amount_pence,
            p_stripe_refund_id, p_payment_intent_id)
    on conflict (stripe_refund_id) where stripe_refund_id is not null
    do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then                             -- already reversed
    select balance_pence into v_new from public.team_credits where team_id = p_team_id;
    return coalesce(v_new, 0);
  end if;

  select balance_pence, coalesce(reserved_pence, 0)
    into v_balance, v_reserved
    from public.team_credits where team_id = p_team_id for update;

  if v_balance is null then
    raise exception 'No credit account for that team';
  end if;

  -- Reserved credit is earmarked against a live post; it is not the team's to
  -- hand back. Raising here rolls back the claim insert above — a function
  -- body is one transaction — so nothing is left half-done.
  if not p_allow_negative and (v_balance - v_reserved) < p_amount_pence then
    raise exception 'Not enough available credit to refund (% available, % requested)',
      v_balance - v_reserved, p_amount_pence;
  end if;

  update public.team_credits
    set balance_pence = balance_pence - p_amount_pence, updated_at = now()
    where team_id = p_team_id
    returning balance_pence into v_new;

  return v_new;
end $$;

-- Refunds move real money, so the browser never calls this. Both callers are
-- server routes running on the service key.
revoke execute on function public.refund_credit(uuid, integer, uuid, text, text, boolean) from public;
revoke execute on function public.refund_credit(uuid, integer, uuid, text, text, boolean) from anon;
revoke execute on function public.refund_credit(uuid, integer, uuid, text, text, boolean) from authenticated;
grant  execute on function public.refund_credit(uuid, integer, uuid, text, text, boolean) to service_role;


-- ── What the cash-out reads ─────────────────────────────────────────────
-- Per player, for one team: card money in, refunds already taken out. A view
-- rather than a query in the route, so the ledger's shape is defined once.
--
-- Only rows with a PaymentIntent count. Cash the captain recorded by hand
-- (record_cash_credit) has no card behind it and cannot be refunded to one —
-- those players are settled up in cash, the same way they paid.
create or replace view public.team_card_contributions as
select
  t.team_id,
  t.player_id,
  sum(case when t.type = 'deposit' and t.stripe_payment_intent_id is not null
           then t.amount_pence else 0 end)                                  as contributed_pence,
  sum(case when t.type = 'refund' then -t.amount_pence else 0 end)          as refunded_pence
from public.team_credit_transactions t
where t.player_id is not null
group by t.team_id, t.player_id;


-- ════════════════════════════════════════════════════════════════════════
-- Notes for whoever runs this
-- ════════════════════════════════════════════════════════════════════════
-- Joining fees are deliberately NOT reversed. team_members.joining_fee_paid_pence
-- records that a member covered their fee, which stays true whether or not
-- leftover credit is later handed back — the cash-out returns the team's
-- unspent balance, not the fee itself. If you ever need to un-pay a fee
-- (a member approved by mistake), do it by hand in the SQL editor; it is a
-- membership correction, not a payment one.
