-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Match suggestions migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Squad players can't post or challenge on their team's behalf, but they can
-- flag a game they'd like the team to enter. A suggestion is a lightweight
-- pointer at either a match_posts row or an open_matches tournament; the
-- captain reviews them from My Team and decides.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.match_suggestions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  suggested_by uuid not null references auth.users(id) on delete cascade,
  -- 'match' → post_id is a match_posts.id; 'tournament' → an open_matches.id.
  kind text not null default 'match',
  post_id uuid not null,
  status text not null default 'pending',   -- pending | accepted | dismissed
  created_at timestamptz not null default now()
);

-- One suggestion per player per game per team — tapping twice is a no-op,
-- not a duplicate in the captain's inbox.
create unique index if not exists match_suggestions_unique
  on public.match_suggestions (team_id, post_id, suggested_by);

create index if not exists match_suggestions_team_idx
  on public.match_suggestions (team_id, status);

alter table public.match_suggestions enable row level security;

-- Anyone signed in can suggest; the row records who did.
drop policy if exists "insert own suggestions" on public.match_suggestions;
create policy "insert own suggestions" on public.match_suggestions
  for insert to authenticated
  with check (auth.uid() = suggested_by);

-- Readable by the suggester and by anyone in the team it was sent to.
drop policy if exists "read team suggestions" on public.match_suggestions;
create policy "read team suggestions" on public.match_suggestions
  for select to authenticated
  using (
    auth.uid() = suggested_by
    or exists (
      select 1 from public.teams t
      where t.id = match_suggestions.team_id and t.captain_id = auth.uid()
    )
    or exists (
      select 1 from public.team_members m
      where m.team_id = match_suggestions.team_id
        and m.player_id = auth.uid()
        and m.status = 'approved'
    )
  );

-- Only the captain resolves them.
drop policy if exists "captain updates suggestions" on public.match_suggestions;
create policy "captain updates suggestions" on public.match_suggestions
  for update to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = match_suggestions.team_id and t.captain_id = auth.uid()
    )
  );
