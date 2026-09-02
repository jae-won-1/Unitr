-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Payment integrity migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Closes the gap between "a card was charged" and "credit appeared".
--
-- Before this, the browser called add_credit() directly after Stripe's
-- confirmPayment() resolved. The two were unrelated: the database never
-- learned whether a payment happened, so credit could be minted by calling
-- the RPC without paying, and a real payment whose tab closed mid-flow left
-- the player charged with no credit.
--
-- After this, Stripe-backed credit is applied ONLY by the webhook at
-- /api/webhooks/stripe, keyed on the PaymentIntent id so it lands exactly
-- once no matter how many times the event is delivered.
--
-- Money is in PENCE everywhere.
-- ════════════════════════════════════════════════════════════════════════


-- ── Tie every credit row to the payment that caused it ──────────────────
alter table public.team_credit_transactions
  add column if not exists stripe_payment_intent_id text;

-- Partial unique: one credit row per PaymentIntent, but the many rows with
-- no payment behind them (holds, captures, settlements) stay unconstrained.
create unique index if not exists team_credit_tx_payment_intent_uniq
  on public.team_credit_transactions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;


-- ════════════════════════════════════════════════════════════════════════
-- credit_from_payment — the webhook's entry point
-- ════════════════════════════════════════════════════════════════════════
-- Idempotent on p_payment_intent_id: a redelivered event finds the row
-- already there and returns the balance unchanged rather than crediting
-- twice. Returns the resulting balance in pence.
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
  -- loser inserts nothing and returns the balance untouched. Doing this
  -- before the balance update is what makes it a no-op rather than an error.
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

  return v_new;
end $$;


-- ════════════════════════════════════════════════════════════════════════
-- record_cash_credit — the captain's manual path
-- ════════════════════════════════════════════════════════════════════════
-- A player who settles in cash never touches Stripe, so there is no
-- PaymentIntent to key on. That path stays, but only the team's captain can
-- run it, and only against their own team — previously any signed-in user
-- could credit any team any amount.
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

  return v_new;
end $$;


-- ════════════════════════════════════════════════════════════════════════
-- Lock the front door
-- ════════════════════════════════════════════════════════════════════════
-- add_credit is unguarded by design — it credits whatever it is told to.
-- That is fine for a trusted server caller and catastrophic from a browser,
-- so revoke it from the client roles. It stays available to service_role
-- for the server-side callers that still use it (/api/tournaments/join).
revoke execute on function public.add_credit(uuid, integer, uuid) from public;
revoke execute on function public.add_credit(uuid, integer, uuid) from anon;
revoke execute on function public.add_credit(uuid, integer, uuid) from authenticated;
grant  execute on function public.add_credit(uuid, integer, uuid) to service_role;

-- Same reasoning: only the server may apply a Stripe payment.
revoke execute on function public.credit_from_payment(uuid, integer, uuid, text) from public;
revoke execute on function public.credit_from_payment(uuid, integer, uuid, text) from anon;
revoke execute on function public.credit_from_payment(uuid, integer, uuid, text) from authenticated;
grant  execute on function public.credit_from_payment(uuid, integer, uuid, text) to service_role;

-- The cash path does its own captain check, so the client may call it.
grant execute on function public.record_cash_credit(uuid, integer, uuid) to authenticated;
grant execute on function public.record_cash_credit(uuid, integer, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- Direct writes to the credit tables
-- ════════════════════════════════════════════════════════════════════════
-- Revoking the RPC accomplishes nothing while "Anyone can upsert team
-- credits" lets the browser UPDATE balance_pence straight through PostgREST.
-- Reads stay open (balances are shown all over the app); writes become
-- server-only, which is already how every legitimate write happens — all of
-- them go through the security-definer functions above.
drop policy if exists "Anyone can upsert team credits" on public.team_credits;
drop policy if exists "Anyone can view team credits"   on public.team_credits;
create policy "Anyone can view team credits" on public.team_credits
  for select using (true);
-- No insert/update/delete policy: RLS denies by default. security definer
-- functions and service_role (BYPASSRLS) are unaffected.

drop policy if exists "Anyone can insert credit tx" on public.team_credit_transactions;
-- Ledger rows are written by the functions above only. Reads stay open.
