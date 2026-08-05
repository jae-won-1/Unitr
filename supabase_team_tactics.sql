-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Team tactics presets migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Replaces contexts/TacticsContext.tsx, which kept a SINGLE tactics blob in
-- localStorage under "unitr_tactics". That had two fatal limits: it was scoped
-- to a browser rather than a team (so no squad member ever saw their captain's
-- work), and it could only hold one setup at a time.
--
-- A team now saves as many named presets as it likes — "High press vs weak
-- keeper", "Corner routine", "See out a 1-0" — and a captain pulls one into a
-- specific fixture from Manage Match > Tactics.
--
-- Note this is deliberately NOT the same table as match_tactics. A preset is a
-- reusable template owned by the team; a match_tactics row is the concrete plan
-- for one fixture and diverges from its source the moment it's edited. Loading
-- a preset copies values across — it does not create a live reference.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.team_tactics (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  title       text not null,
  -- Free text, not an enum: the UI offers Pressing / Set Piece / Defensive /
  -- Offensive as chips but lets a captain type their own, and an enum here
  -- would mean a migration every time someone invents a new situation.
  situation   text,
  formation   text not null default '4-3-3',
  style       text,
  pressing    text,
  notes       text,
  -- { [formationSlotIndex]: player_id } — the SAME shape as match_tactics.lineup,
  -- so loading a preset into a fixture is a straight copy. Slot index refers to
  -- FORMATIONS[formation] in lib/formations.ts; that array's order is therefore
  -- load-bearing and must not be reshuffled.
  lineup      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists team_tactics_team_idx
  on public.team_tactics (team_id, created_at desc);

-- Titles are how a captain tells two presets apart in the load picker, so
-- duplicates within a team would make that list ambiguous.
create unique index if not exists team_tactics_team_title_idx
  on public.team_tactics (team_id, title);

alter table public.team_tactics enable row level security;
drop policy if exists "Anyone can view team tactics" on public.team_tactics;
create policy "Anyone can view team tactics" on public.team_tactics for select using (true);
drop policy if exists "Anyone can insert team tactics" on public.team_tactics;
create policy "Anyone can insert team tactics" on public.team_tactics for insert with check (true);
drop policy if exists "Anyone can update team tactics" on public.team_tactics;
create policy "Anyone can update team tactics" on public.team_tactics for update using (true);
drop policy if exists "Anyone can delete team tactics" on public.team_tactics;
create policy "Anyone can delete team tactics" on public.team_tactics for delete using (true);
