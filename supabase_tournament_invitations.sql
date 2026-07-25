-- Tournament invitations: the organiser (hosting team's captain) or the venue
-- owner invites a team to join a tournament. Venue/organiser invites can carry a
-- discount off the per-team buy-in. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.tournament_invitations (
  id uuid primary key default gen_random_uuid(),
  open_match_id uuid references public.open_matches(id) on delete cascade not null,
  team_id uuid references public.teams(id) not null,   -- the invited team
  team_name text,
  invited_by uuid references auth.users(id),            -- organiser captain or venue owner
  inviter_kind text default 'team',                     -- 'team' | 'venue'
  discount_pence integer not null default 0,            -- taken off the buy-in on accept
  status text not null default 'pending',               -- 'pending' | 'accepted' | 'declined'
  created_at timestamptz default now(),
  unique(open_match_id, team_id)
);

alter table public.tournament_invitations enable row level security;
drop policy if exists "Anyone can view tournament invitations" on public.tournament_invitations;
create policy "Anyone can view tournament invitations" on public.tournament_invitations for select using (true);
-- Sending/accepting is gated in-app; RLS left open like the prototype's other
-- write paths so client + server (anon-fallback) writes both work.
drop policy if exists "Anyone can manage tournament invitations" on public.tournament_invitations;
create policy "Anyone can manage tournament invitations" on public.tournament_invitations for all using (true) with check (true);
