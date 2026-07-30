-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Ringers migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- A "ringer" is a one-off guest player. A captain short of bodies posts a
-- ringer request from Manage Match; any player browsing the Fill In feed
-- pays a flat £5 to Unitr by card and is instantly in the matchday squad.
--
-- Money model — deliberately NOT the team-credit model:
--   * The ringer pays Unitr £5. Nothing touches team_credits, the pitch
--     booking, or the venue payout — the team's own pitch fee is unchanged.
--   * A ringer is therefore never charged at settlement. They aren't a
--     team_member, so the captain's Collect Payment roster (built from
--     team_members + captain) already excludes them; the roster-lock
--     settlement in Manage Match filters on match_confirmations.is_ringer.
-- ════════════════════════════════════════════════════════════════════════

-- ── Ringer requests ("we're short N players for this match") ────────────
create table if not exists public.ringer_requests (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  posted_by    uuid not null references auth.users(id) on delete cascade,
  positions    text[] not null default '{}',          -- e.g. {GK,CB,ST}; empty = any
  spots        integer not null default 1,
  notes        text,
  price_pence  integer not null default 500,          -- flat Unitr fee the ringer pays
  status       text not null default 'open',          -- 'open' | 'filled' | 'cancelled'
  created_at   timestamptz default now(),
  -- One live request per team per match; the captain edits spots instead of
  -- posting twice, which keeps "spots left" a single source of truth.
  unique (match_id, team_id)
);

create index if not exists ringer_requests_status_idx on public.ringer_requests(status);

alter table public.ringer_requests enable row level security;
drop policy if exists "Anyone can view ringer requests" on public.ringer_requests;
create policy "Anyone can view ringer requests" on public.ringer_requests for select using (true);
drop policy if exists "Anyone can manage ringer requests" on public.ringer_requests;
create policy "Anyone can manage ringer requests" on public.ringer_requests for all using (true) with check (true);


-- ── Ringer signups (who paid and joined) ────────────────────────────────
-- match_id / team_id are denormalised from the request so the squad view and
-- any later reporting don't need a join to answer "who was a guest here".
create table if not exists public.ringer_signups (
  id                       uuid primary key default gen_random_uuid(),
  request_id               uuid not null references public.ringer_requests(id) on delete cascade,
  match_id                 uuid not null references public.matches(id) on delete cascade,
  team_id                  uuid not null references public.teams(id) on delete cascade,
  player_id                uuid not null references auth.users(id) on delete cascade,
  position                 text,
  amount_pence             integer not null default 500,
  stripe_payment_intent_id text,
  status                   text not null default 'paid',
  created_at               timestamptz default now(),
  unique (request_id, player_id)
);

-- The join route verifies the PaymentIntent before writing, so a replayed
-- request can't create a second signup off one payment.
create unique index if not exists ringer_signups_intent_idx
  on public.ringer_signups(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table public.ringer_signups enable row level security;
drop policy if exists "Anyone can view ringer signups" on public.ringer_signups;
create policy "Anyone can view ringer signups" on public.ringer_signups for select using (true);
-- Written server-side by /api/ringer/join with adminSupabase, which falls back
-- to the anon key in local dev (no user JWT on that client) — an auth.uid()
-- check would always fail there. The route verifies payment instead.
drop policy if exists "Anyone can insert ringer signups" on public.ringer_signups;
create policy "Anyone can insert ringer signups" on public.ringer_signups for insert with check (true);


-- ── Ringers in the squad, but out of the settlement ─────────────────────
-- A paid ringer gets a normal confirmed match_confirmations row so they show
-- up in the lineup board and squad list. This flag is what keeps them out of
-- the captain's charge: settlement filters it out explicitly.
alter table public.match_confirmations
  add column if not exists is_ringer boolean not null default false;
