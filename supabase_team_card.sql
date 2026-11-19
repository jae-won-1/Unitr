-- UNITER — The team card (linked finance, docs/PAYMENT_PIVOT.md step 2)
--
-- A leader saves a card for the team, and the team pays for its event entries
-- with it. Ideally it is the debit card of the bank account the team linked in
-- Team finance, so what the squad pays into payment requests (paid out to that
-- account) is what the card spends.
--
-- The card lives on a Stripe customer that belongs to the TEAM, not to the
-- leader who saved it: any captain or co-captain can pay with it, replace it or
-- remove it, and it stays with the team through a hand-over. One row per team
-- per Stripe mode, like team_finance_accounts — local development runs a test
-- key against the live database.
--
-- Server only: RLS on and no policies, so every read and write goes through
-- /api/finance/team-card and the join route on the service key. Additive and
-- safe to run while the app is on credit. Run after supabase_team_finance.sql.

create table if not exists public.team_cards (
  team_id                  uuid        not null references public.teams(id) on delete cascade,
  livemode                 boolean     not null,
  stripe_customer_id       text        not null,          -- the team's own Stripe customer
  stripe_payment_method_id text,                          -- null until a card is saved
  brand                    text,
  last4                    text,
  exp_month                integer,
  exp_year                 integer,
  funding                  text,                          -- debit / credit / prepaid, as Stripe reports it
  saved_by                 uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (team_id, livemode)
);

alter table public.team_cards enable row level security;
-- No policies on purpose: the browser and the phone never read this table.

-- Check afterwards: node scripts/check-migrations.mjs lists it as 1/1, and
-- signed in as anyone, this returns nothing:
--   await supabase.from('team_cards').select('*')
