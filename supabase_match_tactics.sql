-- ── MATCH TACTICS (per-team lineup & tactics for a confirmed match) ──
-- Each team in a confirmed match gets its own private tactics row —
-- the opposing captain never sees this. Captains can pre-fill from
-- their team's default tactics (My Team > Tactics) or start fresh.
create table if not exists public.match_tactics (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade not null,
  team_id uuid references public.teams(id) on delete cascade not null,
  formation text not null default '4-3-3',
  style text,
  notes text,
  -- { [formationSlotIndex]: player_id }
  lineup jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(match_id, team_id)
);

alter table public.match_tactics enable row level security;
drop policy if exists "Anyone can view match tactics" on public.match_tactics;
create policy "Anyone can view match tactics" on public.match_tactics for select using (true);
drop policy if exists "Anyone can manage match tactics" on public.match_tactics;
create policy "Anyone can manage match tactics" on public.match_tactics for all using (true) with check (true);
