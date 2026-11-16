-- ════════════════════════════════════════════════════════════════════════
-- Team finance — payment requests paid into a team's own linked account
-- ════════════════════════════════════════════════════════════════════════
--
-- docs/PAYMENT_PIVOT.md. Team credit is being replaced: instead of Uniter
-- holding a balance for a team, a leader links the team's bank account through
-- Stripe and asks squad members for money with payment requests. A member pays
-- by card and the money goes to that linked account.
--
-- This file is ADDITIVE. It creates new tables and functions and touches
-- nothing that team credit uses, so it is safe to run while the live app is
-- still on credit — nothing reads these tables until the app is switched over
-- (NEXT_PUBLIC_FINANCE_MODE=linked, lib/finance-mode.ts).
--
-- Dependencies: none beyond `teams` and `team_members`. Idempotent.
--
-- EVERY TABLE HERE IS SERVER-ONLY. Row level security is on and there are no
-- policies, so a browser or phone session reads and writes nothing directly;
-- the /api/finance/* routes are the only door, on the service key. That is
-- deliberate: a member may see only their own requests, a leader the whole
-- squad's, and one place deciding that is safer than a set of policies.


-- ── The team's linked Stripe account ────────────────────────────────────
-- One row per team PER STRIPE MODE. Local development runs a test key against
-- the live database (lib/stripe-mode.ts), so a test account must never replace
-- a team's live one — `livemode` keeps the two apart.
create table if not exists public.team_finance_accounts (
  team_id           uuid        not null references public.teams(id) on delete cascade,
  livemode          boolean     not null,
  stripe_account_id text        not null,
  -- Whose Stripe account it is. Only this person can finish onboarding or
  -- open the payouts dashboard: it holds their identity and bank details.
  linked_by         uuid        not null,
  details_submitted boolean     not null default false,
  transfers_active  boolean     not null default false,
  payouts_enabled   boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (team_id, livemode)
);


-- ── A payment request ───────────────────────────────────────────────────
-- kind:
--   general      anything a leader asks for — kit, a team dinner
--   joining_fee  the team's standing fee; one live row per team, everyone in
--                the squad is on it, and new members are added by the trigger
--                below
--   match_fee    a fixture's cost shared among who played; issued from Settle
--                match fees, one per fixture per team
-- Only joining_fee and match_fee stop a member voting Available.
create table if not exists public.payment_requests (
  id            uuid        primary key default gen_random_uuid(),
  team_id       uuid        not null references public.teams(id) on delete cascade,
  kind          text        not null default 'general'
                            check (kind in ('general', 'joining_fee', 'match_fee')),
  title         text        not null,
  description   text,
  image_path    text,                       -- object path in the payment-requests bucket
  amount_pence  integer     not null check (amount_pence > 0),   -- per member
  due_date      date,
  match_id      uuid,                       -- match_fee for a friendly
  open_match_id uuid,                       -- match_fee for an event entry
  created_by    uuid        not null,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz
);

create index if not exists payment_requests_team_idx
  on public.payment_requests (team_id, created_at desc);

create unique index if not exists payment_requests_one_joining_fee
  on public.payment_requests (team_id)
  where kind = 'joining_fee' and cancelled_at is null;

create unique index if not exists payment_requests_one_per_match
  on public.payment_requests (team_id, match_id)
  where match_id is not null and cancelled_at is null;

create unique index if not exists payment_requests_one_per_event
  on public.payment_requests (team_id, open_match_id)
  where open_match_id is not null and cancelled_at is null;


-- ── Who a request was sent to, and what they have paid ──────────────────
-- `amount_pence` is what this member is asked for; `paid_pence` what has come
-- in. Paid means paid_pence >= amount_pence. Keeping both, rather than a
-- paid flag, is what lets a joining fee be raised later: the amount moves and
-- the difference is owed, exactly as the fee behaves today.
create table if not exists public.payment_request_members (
  id           uuid        primary key default gen_random_uuid(),
  request_id   uuid        not null references public.payment_requests(id) on delete cascade,
  team_id      uuid        not null references public.teams(id) on delete cascade,
  player_id    uuid        not null,
  amount_pence integer     not null check (amount_pence >= 0),
  paid_pence   integer     not null default 0 check (paid_pence >= 0),
  -- 'card' through Uniter, or 'manual' when a leader ticks it off (cash, a
  -- bank transfer). Null while nothing has been paid.
  paid_via     text        check (paid_via in ('card', 'manual')),
  paid_at      timestamptz,
  reminded_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (request_id, player_id)
);

create index if not exists payment_request_members_player_idx
  on public.payment_request_members (team_id, player_id);


-- ── Card payments against a request ─────────────────────────────────────
-- One row per PaymentIntent. The unique intent id is the idempotency key: the
-- Stripe webhook and the payer's own browser both report a payment, and
-- whichever arrives second finds the row and does nothing.
create table if not exists public.payment_request_payments (
  id                       uuid        primary key default gen_random_uuid(),
  member_id                uuid        not null references public.payment_request_members(id) on delete cascade,
  request_id               uuid        not null,
  team_id                  uuid        not null,
  player_id                uuid        not null,
  stripe_payment_intent_id text        not null unique,
  amount_pence             integer     not null,            -- what reached the team
  fee_pence                integer     not null default 0,  -- paid on top by the payer
  refunded_pence           integer     not null default 0,
  created_at               timestamptz not null default now()
);


-- ── Everything else that moves the tracked balance ──────────────────────
--   adjustment  a leader setting the balance to match the bank
--   expense     money spent outside Uniter that a leader logs
--   spend       the team card paying for a pitch or an entry through Uniter
-- amount_pence is signed: money out is negative.
create table if not exists public.team_finance_entries (
  id                       uuid        primary key default gen_random_uuid(),
  team_id                  uuid        not null references public.teams(id) on delete cascade,
  kind                     text        not null check (kind in ('adjustment', 'expense', 'spend')),
  amount_pence             integer     not null,
  note                     text,
  created_by               uuid,
  booking_id               uuid,
  match_id                 uuid,
  open_match_id            uuid,
  stripe_payment_intent_id text,
  created_at               timestamptz not null default now()
);

create index if not exists team_finance_entries_team_idx
  on public.team_finance_entries (team_id, created_at desc);


-- ── Server only ─────────────────────────────────────────────────────────
alter table public.team_finance_accounts    enable row level security;
alter table public.payment_requests         enable row level security;
alter table public.payment_request_members  enable row level security;
alter table public.payment_request_payments enable row level security;
alter table public.team_finance_entries     enable row level security;


-- ── Record a card payment ───────────────────────────────────────────────
-- Returns true if this call recorded it, false if it was already recorded (or
-- the member's row has since been removed — the money still reached the team,
-- there is just nothing left to tick).
create or replace function public.apply_request_payment(
  p_member_id         uuid,
  p_payment_intent_id text,
  p_amount_pence      integer,
  p_fee_pence         integer
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  m        public.payment_request_members%rowtype;
  inserted integer;
begin
  select * into m from public.payment_request_members where id = p_member_id for update;
  if not found then
    return false;
  end if;

  insert into public.payment_request_payments
    (member_id, request_id, team_id, player_id, stripe_payment_intent_id, amount_pence, fee_pence)
  values
    (m.id, m.request_id, m.team_id, m.player_id, p_payment_intent_id, p_amount_pence, coalesce(p_fee_pence, 0))
  on conflict (stripe_payment_intent_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return false;
  end if;

  update public.payment_request_members
     set paid_pence = paid_pence + p_amount_pence,
         paid_via   = 'card',
         paid_at    = now()
   where id = m.id;
  return true;
end $fn$;


-- ── Take a refunded payment back off what the member has paid ───────────
-- Takes the charge's CUMULATIVE refunded total, so a redelivered webhook, or a
-- second partial refund, each move the row to the right place rather than
-- subtracting twice.
create or replace function public.reverse_request_payment(
  p_payment_intent_id    text,
  p_refunded_total_pence integer
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  p     public.payment_request_payments%rowtype;
  target integer;
  delta  integer;
begin
  select * into p from public.payment_request_payments
   where stripe_payment_intent_id = p_payment_intent_id for update;
  if not found then
    return false;
  end if;

  -- The charge was the share plus the fee; never reverse more than the share.
  target := least(greatest(p_refunded_total_pence, 0), p.amount_pence);
  delta  := target - p.refunded_pence;
  if delta <= 0 then
    return false;
  end if;

  update public.payment_request_payments set refunded_pence = target where id = p.id;
  update public.payment_request_members
     set paid_pence = greatest(0, paid_pence - delta)
   where id = p.member_id;
  return true;
end $fn$;


-- A security definer function is callable by everyone the moment it exists.
-- These two move what a member is recorded as having paid, so only the server
-- may call them.
revoke all on function public.apply_request_payment(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.reverse_request_payment(text, integer) from public, anon, authenticated;
grant execute on function public.apply_request_payment(uuid, text, integer, integer) to service_role;
grant execute on function public.reverse_request_payment(text, integer) to service_role;


-- ── A new squad member goes onto the team's joining fee ─────────────────
-- Fires however the membership was approved — the Approve button, an invite
-- link, an accepted offer, a team hand-over — so no route has to remember.
-- Does nothing for a team with no joining-fee request, which is every team
-- until the app is switched over.
create or replace function public.add_member_to_joining_fee_request()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    insert into public.payment_request_members (request_id, team_id, player_id, amount_pence)
    select r.id, r.team_id, new.player_id, r.amount_pence
      from public.payment_requests r
     where r.team_id = new.team_id
       and r.kind = 'joining_fee'
       and r.cancelled_at is null
    on conflict (request_id, player_id) do nothing;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_joining_fee_request_member on public.team_members;
create trigger trg_joining_fee_request_member
  after insert or update of status on public.team_members
  for each row execute function public.add_member_to_joining_fee_request();


-- ── Screenshots attached to a request ───────────────────────────────────
-- A private bucket with no storage policies: the server uploads, and hands
-- out short-lived signed links to the people allowed to see the request.
insert into storage.buckets (id, name, public)
values ('payment-requests', 'payment-requests', false)
on conflict (id) do nothing;


-- ── Checks ──────────────────────────────────────────────────────────────
-- 1. As a signed-in player in the browser console, both of these should come
--    back empty / refused:
--      await supabase.from('payment_requests').select('*')
--      await supabase.rpc('apply_request_payment', { p_member_id: '...', p_payment_intent_id: 'x', p_amount_pence: 1, p_fee_pence: 0 })
-- 2. select id, public from storage.buckets where id = 'payment-requests';  -- public = false
