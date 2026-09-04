-- ── PITCH AVAILABILITY (weekly recurring schedule) ────────────
-- day_of_week: 0=Sunday, 1=Monday, ..., 6=Saturday (matches JS Date.getDay())
create table if not exists public.pitch_availability (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid references public.pitches(id) on delete cascade not null,
  day_of_week integer not null check (day_of_week between 0 and 6),
  open_time text not null,   -- "09:00"
  close_time text not null,  -- "22:00"
  is_active boolean default true,
  created_at timestamptz default now(),
  unique(pitch_id, day_of_week)
);

alter table public.pitch_availability enable row level security;
drop policy if exists "Anyone can view availability" on public.pitch_availability;
create policy "Anyone can view availability" on public.pitch_availability for select using (true);
drop policy if exists "Venue owners can manage availability" on public.pitch_availability;
create policy "Venue owners can manage availability" on public.pitch_availability for all using (true);


-- ── PITCH BLOCKS (close specific dates / time windows) ─────────
create table if not exists public.pitch_blocks (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid references public.pitches(id) on delete cascade not null,
  block_date date not null,
  start_time text,   -- null = whole day blocked
  end_time text,     -- null = whole day blocked
  reason text,
  created_at timestamptz default now()
);

alter table public.pitch_blocks enable row level security;
drop policy if exists "Anyone can view blocks" on public.pitch_blocks;
create policy "Anyone can view blocks" on public.pitch_blocks for select using (true);
drop policy if exists "Venue owners can manage blocks" on public.pitch_blocks;
create policy "Venue owners can manage blocks" on public.pitch_blocks for all using (true);


-- ── Seed default availability for existing pitches (Mon–Sun, 09:00–22:00) ──
-- Run this after the above creates succeed.
-- Replace the pitch IDs with real ones from your pitches table, OR run:
insert into public.pitch_availability (pitch_id, day_of_week, open_time, close_time)
select id, generate_series(0, 6), '09:00', '22:00'
from public.pitches;
