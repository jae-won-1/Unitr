-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Venue payouts (Stripe Connect, TEST MODE)
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Adds the "real money out" side of the ledger: when a booking is confirmed,
-- Unitr transfers the pitch fee from its Stripe balance to the VENUE's
-- connected Stripe account. This is the cash counterpart to the in-app
-- credit debit (split_pitch_fee / capture_and_settle), so the two can be
-- reconciled side by side in the finance analysis views.
--
-- NOTE: real Connect payouts require KYC/onboarding per venue and a fintech
-- review before launch. Everything here is wired for Stripe TEST mode so the
-- credit-spend → venue-transfer link is demonstrable end to end.
-- ════════════════════════════════════════════════════════════════════════

-- ── pitches: attach the venue's connected Stripe account ─────────────────
alter table public.pitches
  add column if not exists stripe_account_id text,             -- acct_... (Connect)
  add column if not exists payouts_enabled boolean not null default false;


-- ── venue_transfers: one row per cash payout to a venue ──────────────────
create table if not exists public.venue_transfers (
  id                 uuid primary key default gen_random_uuid(),
  pitch_id           uuid references public.pitches(id),
  booking_id         uuid references public.pitch_bookings(id),
  match_id           uuid,
  stripe_account_id  text,                 -- destination connected account
  stripe_transfer_id text,                 -- tr_... from Stripe
  amount_pence       integer not null,     -- cash sent to the venue
  currency           text not null default 'gbp',
  status             text not null default 'pending',  -- 'pending' | 'paid' | 'failed'
  failure_reason     text,
  created_at         timestamptz default now()
);

alter table public.venue_transfers enable row level security;
drop policy if exists "Anyone can view venue transfers" on public.venue_transfers;
create policy "Anyone can view venue transfers" on public.venue_transfers for select using (true);
drop policy if exists "System can write venue transfers" on public.venue_transfers;
create policy "System can write venue transfers" on public.venue_transfers for all using (true) with check (true);

create index if not exists venue_transfers_pitch_idx   on public.venue_transfers(pitch_id);
create index if not exists venue_transfers_booking_idx on public.venue_transfers(booking_id);

-- ── Team attribution: which team's payment this transfer covers ──────────
-- venue_transfers had no team link, so a tournament buy-in (many teams
-- sharing one open_match, no individual booking_id) couldn't be attributed
-- to a paying team in Reports/Bookings. Add both a direct team_id and the
-- open_match_id so a tournament transfer can also list every entered team.
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='venue_transfers' and column_name='team_id') then
    alter table public.venue_transfers add column team_id uuid references public.teams(id);
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='venue_transfers' and column_name='open_match_id') then
    alter table public.venue_transfers add column open_match_id uuid references public.open_matches(id);
  end if;
end $$;

create index if not exists venue_transfers_open_match_idx on public.venue_transfers(open_match_id, team_id);
