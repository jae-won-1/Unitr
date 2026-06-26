-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Credit Ledger + Replenish migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Implements the model in PAYMENT_PLAN.md:
--   Phase 1  hold_credit       — Team 1 earmarks the full pitch fee at post time
--   Phase 2  capture_and_settle — on match, capture Team 1 + settle Team 2's half
--   Phase 3  apply_replenishment — each player's payment refills their team's credit
--   (plus release_hold for cancelled posts)
--
-- Money is in PENCE everywhere (fixes the old £/pence mismatch).
-- ════════════════════════════════════════════════════════════════════════


-- ── team_credits ────────────────────────────────────────────────────────
-- Canonical (pence) shape. The DO block below migrates legacy tables that
-- still have a £ `balance` column.
create table if not exists public.team_credits (
  team_id        uuid primary key references public.teams(id) on delete cascade,
  balance_pence  integer not null default 0,
  reserved_pence integer not null default 0,   -- earmarked for live posts
  updated_at     timestamptz default now()
);
-- available credit = balance_pence - reserved_pence

do $$
begin
  -- balance_pence: add + backfill from legacy £ `balance`, then drop the old col
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credits' and column_name='balance_pence') then
    alter table public.team_credits add column balance_pence integer not null default 0;
  end if;
  if exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credits' and column_name='balance') then
    update public.team_credits set balance_pence = round(balance * 100);
    alter table public.team_credits drop column balance;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credits' and column_name='reserved_pence') then
    alter table public.team_credits add column reserved_pence integer not null default 0;
  end if;
end $$;

alter table public.team_credits enable row level security;
drop policy if exists "Anyone can view team credits" on public.team_credits;
create policy "Anyone can view team credits" on public.team_credits for select using (true);
-- Writes go through SECURITY DEFINER RPCs below; deposits also need a direct path:
drop policy if exists "Anyone can upsert team credits" on public.team_credits;
create policy "Anyone can upsert team credits" on public.team_credits for all using (true) with check (true);


-- ── team_credit_transactions (signed audit ledger) ──────────────────────
create table if not exists public.team_credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  player_id       uuid references auth.users(id),
  type            text not null default 'deposit',
  -- 'deposit' | 'booking_hold' | 'booking_capture'
  -- | 'opponent_settlement' | 'player_replenish' | 'refund'
  amount_pence    integer not null default 0,   -- SIGNED (+ in, - out)
  post_id         uuid,                          -- set for holds (pre-match)
  match_id        uuid,
  related_team_id uuid references public.teams(id),
  created_at      timestamptz default now()
);

do $$
begin
  -- amount_pence: add + backfill from legacy £ `amount`, then drop old col
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credit_transactions' and column_name='amount_pence') then
    alter table public.team_credit_transactions add column amount_pence integer not null default 0;
  end if;
  if exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credit_transactions' and column_name='amount') then
    update public.team_credit_transactions set amount_pence = round(amount * 100);
    alter table public.team_credit_transactions drop column amount;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credit_transactions' and column_name='type') then
    alter table public.team_credit_transactions add column type text not null default 'deposit';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credit_transactions' and column_name='post_id') then
    alter table public.team_credit_transactions add column post_id uuid;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credit_transactions' and column_name='match_id') then
    alter table public.team_credit_transactions add column match_id uuid;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='team_credit_transactions' and column_name='related_team_id') then
    alter table public.team_credit_transactions add column related_team_id uuid references public.teams(id);
  end if;
end $$;

-- Note on reconciliation: balance_pence is the source of truth. Summing
-- amount_pence reconciles to balance_pence EXCEPT for 'booking_hold' rows,
-- which track the `reserved_pence` earmark, not the balance.

alter table public.team_credit_transactions enable row level security;
drop policy if exists "Anyone can view credit tx" on public.team_credit_transactions;
create policy "Anyone can view credit tx" on public.team_credit_transactions for select using (true);
drop policy if exists "Anyone can insert credit tx" on public.team_credit_transactions;
create policy "Anyone can insert credit tx" on public.team_credit_transactions for insert with check (true);


-- ── player_payments: purpose + destination team ─────────────────────────
alter table public.player_payments
  add column if not exists purpose text not null default 'replenish',  -- 'replenish' | 'ringer_direct'
  add column if not exists team_id uuid references public.teams(id),
  add column if not exists applied boolean not null default false;     -- credited to team yet?


-- ── match_posts: persist payment mode + the batch credit hold ───────────
-- A posting "batch" (one date + its alt-time pitches, or several dates) creates
-- several posts but only one ever matches, so the credit earmark is placed ONCE
-- on a single owner post (hold_pence > 0). Siblings carry hold_pence = 0.
alter table public.match_posts
  add column if not exists payment_mode text not null default 'credit', -- 'credit' | 'individual'
  add column if not exists hold_pence integer not null default 0;


-- ════════════════════════════════════════════════════════════════════════
-- RPCs (SECURITY DEFINER — atomic, run with row locks)
-- ════════════════════════════════════════════════════════════════════════

-- Deposit (joining fee / top-up) — atomic increment, avoids stale-read clobber.
create or replace function public.add_credit(
  p_team_id uuid, p_amount_pence integer, p_player_id uuid
) returns integer language plpgsql security definer as $$
declare v_new integer;
begin
  insert into public.team_credits(team_id, balance_pence) values (p_team_id, p_amount_pence)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + p_amount_pence, updated_at = now()
    returning balance_pence into v_new;

  insert into public.team_credit_transactions(team_id, player_id, type, amount_pence)
    values (p_team_id, p_player_id, 'deposit', p_amount_pence);

  return v_new;
end $$;


-- Phase 1 — earmark the full pitch fee on the posting team.
create or replace function public.hold_credit(
  p_team_id uuid, p_amount_pence integer, p_post_id uuid
) returns void language plpgsql security definer as $$
declare v_balance integer; v_reserved integer;
begin
  select balance_pence, reserved_pence into v_balance, v_reserved
    from public.team_credits where team_id = p_team_id for update;
  if v_balance is null then
    raise exception 'No credit account for team %', p_team_id;
  end if;
  if (v_balance - v_reserved) < p_amount_pence then
    raise exception 'INSUFFICIENT_CREDIT: available %, need %', (v_balance - v_reserved), p_amount_pence;
  end if;

  update public.team_credits
    set reserved_pence = reserved_pence + p_amount_pence, updated_at = now()
    where team_id = p_team_id;

  insert into public.team_credit_transactions(team_id, type, amount_pence, post_id)
    values (p_team_id, 'booking_hold', -p_amount_pence, p_post_id);
end $$;


-- Release an earmark when a hold-owner post leaves 'open' (matched OR cancelled).
-- Reverses the reservation only — balance is untouched (the capture moves balance).
create or replace function public.release_hold(
  p_team_id uuid, p_amount_pence integer, p_post_id uuid
) returns void language plpgsql security definer as $$
begin
  update public.team_credits
    set reserved_pence = greatest(0, reserved_pence - p_amount_pence), updated_at = now()
    where team_id = p_team_id;

  insert into public.team_credit_transactions(team_id, type, amount_pence, post_id)
    values (p_team_id, 'booking_hold', p_amount_pence, p_post_id);   -- +ve reverses the earmark
end $$;


-- Phase 2 — on match: capture Team 1's fee + settle Team 2's half.
-- p_fee_pence = full pitch fee P. Posting team fronted P; challenger reimburses P/2.
-- Moves balances only. The poster's earmark is cleared separately via release_hold
-- (called when the hold-owner post leaves 'open').
create or replace function public.capture_and_settle(
  p_match_id uuid, p_posting_team uuid, p_challenging_team uuid, p_fee_pence integer
) returns void language plpgsql security definer as $$
declare
  v_half integer := p_fee_pence / 2;   -- integer; odd remainder stays with poster
  v_chal_balance integer; v_chal_reserved integer;
  v_first uuid; v_second uuid;
begin
  -- Lock both rows in a stable order to avoid deadlocks.
  v_first  := least(p_posting_team, p_challenging_team);
  v_second := greatest(p_posting_team, p_challenging_team);
  perform 1 from public.team_credits where team_id = v_first  for update;
  perform 1 from public.team_credits where team_id = v_second for update;

  -- Challenger must be able to cover their half.
  select balance_pence, reserved_pence into v_chal_balance, v_chal_reserved
    from public.team_credits where team_id = p_challenging_team;
  if v_chal_balance is null then
    raise exception 'No credit account for challenging team %', p_challenging_team;
  end if;
  if (v_chal_balance - v_chal_reserved) < v_half then
    raise exception 'INSUFFICIENT_CREDIT: challenger available %, need %', (v_chal_balance - v_chal_reserved), v_half;
  end if;

  -- Capture the poster's fee (full fee out of balance; earmark cleared elsewhere).
  update public.team_credits set
    balance_pence = balance_pence - p_fee_pence,
    updated_at = now()
  where team_id = p_posting_team;
  insert into public.team_credit_transactions(team_id, type, amount_pence, match_id)
    values (p_posting_team, 'booking_capture', -p_fee_pence, p_match_id);

  -- Challenger reimburses their half to the poster.
  update public.team_credits set balance_pence = balance_pence - v_half, updated_at = now()
    where team_id = p_challenging_team;
  insert into public.team_credit_transactions(team_id, type, amount_pence, match_id, related_team_id)
    values (p_challenging_team, 'opponent_settlement', -v_half, p_match_id, p_posting_team);

  update public.team_credits set balance_pence = balance_pence + v_half, updated_at = now()
    where team_id = p_posting_team;
  insert into public.team_credit_transactions(team_id, type, amount_pence, match_id, related_team_id)
    values (p_posting_team, 'opponent_settlement', v_half, p_match_id, p_challenging_team);

  -- Net: each team down ~P/2. Players replenish this in Phase 3.
end $$;


-- Phase 2 (split) — on match: debit each team its OWN half directly.
-- p_fee_pence = full pitch fee P. Neither team fronts the other's share —
-- the poster is debited ceil(P/2), the challenger floor(P/2), independently.
-- Supersedes capture_and_settle's front-then-reimburse mechanism.
create or replace function public.split_pitch_fee(
  p_match_id uuid, p_posting_team uuid, p_challenging_team uuid, p_fee_pence integer
) returns void language plpgsql security definer as $$
declare
  v_post_half integer := ceil(p_fee_pence / 2.0);   -- poster absorbs the odd penny
  v_chal_half integer := p_fee_pence - v_post_half;
  v_post_balance integer; v_post_reserved integer;
  v_chal_balance integer; v_chal_reserved integer;
  v_first uuid; v_second uuid;
begin
  -- Lock both rows in a stable order to avoid deadlocks.
  v_first  := least(p_posting_team, p_challenging_team);
  v_second := greatest(p_posting_team, p_challenging_team);
  perform 1 from public.team_credits where team_id = v_first  for update;
  perform 1 from public.team_credits where team_id = v_second for update;

  select balance_pence, reserved_pence into v_post_balance, v_post_reserved
    from public.team_credits where team_id = p_posting_team;
  if v_post_balance is null then
    raise exception 'No credit account for posting team %', p_posting_team;
  end if;
  if (v_post_balance - v_post_reserved) < v_post_half then
    raise exception 'INSUFFICIENT_CREDIT: posting team available %, need %', (v_post_balance - v_post_reserved), v_post_half;
  end if;

  select balance_pence, reserved_pence into v_chal_balance, v_chal_reserved
    from public.team_credits where team_id = p_challenging_team;
  if v_chal_balance is null then
    raise exception 'No credit account for challenging team %', p_challenging_team;
  end if;
  if (v_chal_balance - v_chal_reserved) < v_chal_half then
    raise exception 'INSUFFICIENT_CREDIT: challenger available %, need %', (v_chal_balance - v_chal_reserved), v_chal_half;
  end if;

  -- Debit the poster's own half.
  update public.team_credits set balance_pence = balance_pence - v_post_half, updated_at = now()
    where team_id = p_posting_team;
  insert into public.team_credit_transactions(team_id, type, amount_pence, match_id, related_team_id)
    values (p_posting_team, 'booking_capture', -v_post_half, p_match_id, p_challenging_team);

  -- Debit the challenger's own half.
  update public.team_credits set balance_pence = balance_pence - v_chal_half, updated_at = now()
    where team_id = p_challenging_team;
  insert into public.team_credit_transactions(team_id, type, amount_pence, match_id, related_team_id)
    values (p_challenging_team, 'booking_capture', -v_chal_half, p_match_id, p_posting_team);

  -- Net: each team down its own half — no transfer between them.
end $$;


-- Phase 3 — a player's replenishment payment refills THEIR team's credit.
-- Credits the pitch-share portion (amount_pence); the 5% fee goes to Unitr.
-- Idempotent: only applies once per payment row.
create or replace function public.apply_replenishment(
  p_payment_id uuid
) returns void language plpgsql security definer as $$
declare v_team uuid; v_share integer; v_purpose text; v_applied boolean;
begin
  select team_id, amount_pence, purpose, applied
    into v_team, v_share, v_purpose, v_applied
    from public.player_payments where id = p_payment_id for update;

  if v_team is null then return; end if;            -- ringer_direct / no team
  if v_purpose <> 'replenish' then return; end if;
  if v_applied then return; end if;                 -- already credited

  update public.team_credits set balance_pence = balance_pence + v_share, updated_at = now()
    where team_id = v_team;

  insert into public.team_credit_transactions(team_id, player_id, type, amount_pence)
    select v_team, player_id, 'player_replenish', v_share
      from public.player_payments where id = p_payment_id;

  update public.player_payments set applied = true, status = 'paid' where id = p_payment_id;
end $$;
