-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Team group chat migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run after supabase_joining_fees.sql (needs `teams` and `team_members`).
--
-- One chat per team, whose membership is DERIVED rather than stored: the
-- captain plus every approved `team_members` row. Nothing has to be written
-- when someone joins — approving a squad member, or a join through the invite
-- link, puts them in the chat on their next load, and losing the membership
-- row takes them back out.
--
-- `team_chat_members` therefore holds only what the derivation can't know:
-- whether this person has muted the chat, whether they have LEFT it, and how
-- far they have read. A row is created lazily the first time someone opens
-- the chat or changes one of those settings.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.team_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists team_chat_messages_team_idx
  on public.team_chat_messages(team_id, created_at);

-- Per-person state. `left_at` doubles as the flag and as the cut-off: someone
-- who left keeps the history up to that moment and receives nothing after it.
create table if not exists public.team_chat_members (
  team_id      uuid not null references public.teams(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  muted        boolean not null default false,
  left_at      timestamptz,
  last_read_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- ── Who is in the chat ──────────────────────────────────────────────────
-- The captain has no `team_members` row of their own, so both halves matter.
-- security definer because the policies below call it while RLS is being
-- evaluated on the very tables it reads.
create or replace function public.is_team_squad_member(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and (
    exists (select 1 from public.teams t
              where t.id = p_team_id and t.captain_id = p_user_id)
    or exists (select 1 from public.team_members m
              where m.team_id = p_team_id and m.player_id = p_user_id
                and m.status = 'approved')
  );
$$;

-- Posting needs squad membership AND not having left. Reading does not: a
-- member who left still sees what was said before they went.
create or replace function public.can_post_team_chat(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_team_squad_member(p_team_id, p_user_id)
     and not exists (
       select 1 from public.team_chat_members c
        where c.team_id = p_team_id and c.user_id = p_user_id
          and c.left_at is not null
     );
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Deliberately stricter than the rest of the prototype, which is `using
-- (true)` throughout: a squad's chat read by any signed-in stranger is a
-- different kind of leak from a fixture list being public.
alter table public.team_chat_messages enable row level security;

drop policy if exists "Squad can read team chat" on public.team_chat_messages;
create policy "Squad can read team chat" on public.team_chat_messages
  for select using (public.is_team_squad_member(team_id, auth.uid()));

drop policy if exists "Squad can post to team chat" on public.team_chat_messages;
create policy "Squad can post to team chat" on public.team_chat_messages
  for insert with check (
    sender_id = auth.uid() and public.can_post_team_chat(team_id, auth.uid())
  );

-- No update or delete policy: a sent message stays as sent.

alter table public.team_chat_members enable row level security;

drop policy if exists "Own team chat settings readable" on public.team_chat_members;
create policy "Own team chat settings readable" on public.team_chat_members
  for select using (user_id = auth.uid());

drop policy if exists "Own team chat settings writable" on public.team_chat_members;
create policy "Own team chat settings writable" on public.team_chat_members
  for insert with check (
    user_id = auth.uid() and public.is_team_squad_member(team_id, auth.uid())
  );

drop policy if exists "Own team chat settings updatable" on public.team_chat_members;
create policy "Own team chat settings updatable" on public.team_chat_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
