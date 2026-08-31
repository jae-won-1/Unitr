-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Tie credit top-ups back to the Stripe charge that paid for them.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHY
-- A team credit top-up is a REAL card charge (app/api/create-credits-intent),
-- but the only trace it left in the DB was a generic 'deposit' row in
-- team_credit_transactions. That type is also written by three flows that
-- involve no card at all:
--
--   * a player settling a due in cash        (TeamCreditsBar.markDuePaid)
--   * applying an already-charged due        (DuesTopUpModal.applyTopUp)
--   * refunding a failed tournament join     (tournaments/join/route.ts)
--
-- So "sum of deposits" could never be reconciled against "sum of Stripe
-- top-up charges" — the two legitimately differ. Recording the PaymentIntent
-- on the row that a card actually paid for makes the comparison exact, and
-- makes it possible to spot a charge that Stripe took but the ledger never
-- credited (there is no webhook — credit is granted client-side after
-- confirmPayment resolves, so a closed tab loses the write).
-- ════════════════════════════════════════════════════════════════════════

alter table public.team_credit_transactions
  add column if not exists stripe_payment_intent_id text;

-- One credit per charge. Doubles as replay protection: re-confirming the same
-- PaymentIntent can no longer credit the team twice, because add_credit runs
-- the balance bump and this insert in a single transaction — the conflict
-- rolls back both.
create unique index if not exists team_credit_tx_payment_intent_uniq
  on public.team_credit_transactions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Only card top-ups carry a PaymentIntent, so this index is the "real cash in"
-- filter the admin finance page reads.
create index if not exists team_credit_tx_deposit_idx
  on public.team_credit_transactions (type) where type = 'deposit';


-- ── add_credit gains an optional PaymentIntent ───────────────────────────
-- Dropped first: adding a 4th defaulted parameter alongside the existing
-- 3-arg function would make every 3-arg call ambiguous ("function is not
-- unique"). Existing callers that pass only the first three arguments keep
-- working against the new signature unchanged.
drop function if exists public.add_credit(uuid, integer, uuid);

create or replace function public.add_credit(
  p_team_id uuid,
  p_amount_pence integer,
  p_player_id uuid,
  p_payment_intent_id text default null
) returns integer language plpgsql security definer as $$
declare v_new integer;
begin
  insert into public.team_credits(team_id, balance_pence) values (p_team_id, p_amount_pence)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + p_amount_pence, updated_at = now()
    returning balance_pence into v_new;

  insert into public.team_credit_transactions(
    team_id, player_id, type, amount_pence, stripe_payment_intent_id
  ) values (
    p_team_id, p_player_id, 'deposit', p_amount_pence, p_payment_intent_id
  );

  return v_new;
end $$;
