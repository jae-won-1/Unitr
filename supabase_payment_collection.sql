-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Payment Collection + Direct Messages migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Lets a captain, from each match's widget in Match History, tick which
-- players participated, split the team's booking cost (+5% Unitr fee)
-- evenly between them, and send each a payment request as a direct
-- message. The Collect Payment popup (Team Credits bar) then aggregates
-- every player's outstanding total across all matches, and the captain
-- can tap a player to send a follow-up reminder DM.
--
-- This is a bookkeeping checklist only — it does NOT move team credit or
-- trigger Stripe; the real settlement flow is in supabase_credit_ledger.sql.
-- ════════════════════════════════════════════════════════════════════════

-- A match is "fully paid off" once every included player has been ticked
-- as received. Stored explicitly (not just derived) per the captain's request.
alter table public.matches
  add column if not exists fees_settled boolean not null default false;

create table if not exists public.payment_collection_status (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  player_id   uuid not null references auth.users(id) on delete cascade,
  included    boolean not null default true,   -- ticked as a participant who owes a share
  share_pence integer not null default 0,        -- locked in when the first request is sent
  received    boolean not null default false,
  updated_at  timestamptz default now(),
  unique (match_id, player_id)
);

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_collection_status' and column_name='included') then
    alter table public.payment_collection_status add column included boolean not null default true;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_collection_status' and column_name='share_pence') then
    alter table public.payment_collection_status add column share_pence integer not null default 0;
  end if;
end $$;

alter table public.payment_collection_status enable row level security;
drop policy if exists "Anyone can view payment collection status" on public.payment_collection_status;
create policy "Anyone can view payment collection status" on public.payment_collection_status for select using (true);
drop policy if exists "Anyone can upsert payment collection status" on public.payment_collection_status;
create policy "Anyone can upsert payment collection status" on public.payment_collection_status for all using (true) with check (true);


-- ── Direct messages (minimal inbox) ─────────────────────────────────────
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  body        text not null,
  type        text not null default 'direct',   -- 'direct' | 'payment_reminder'
  match_id    uuid references public.matches(id),
  read        boolean not null default false,
  created_at  timestamptz default now()
);

alter table public.messages enable row level security;
drop policy if exists "Anyone can view messages" on public.messages;
create policy "Anyone can view messages" on public.messages for select using (true);
drop policy if exists "Anyone can insert messages" on public.messages;
create policy "Anyone can insert messages" on public.messages for insert with check (true);
drop policy if exists "Anyone can update messages" on public.messages;
create policy "Anyone can update messages" on public.messages for update using (true);
