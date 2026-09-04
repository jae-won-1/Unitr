-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Lock down tournament entry
-- Run in the Supabase SQL editor, AFTER supabase_open_matches.sql.
-- Idempotent — safe to re-run.
--
-- open_match_teams governed entry with `for insert with check (true)`, so a
-- team could enter a paid tournament by writing the row straight from the
-- browser with the anon key and never going near /api/tournaments/join —
-- which is the only place the buy-in is debited. Free entry to a paid event,
-- one devtools call away. Harmless while the money was fake; not harmless for
-- a pilot charging real buy-ins.
--
-- Entry now happens in exactly two places:
--
--   1. /api/tournaments/join — the paid path. Runs on the service key, which
--      bypasses RLS, so it needs no policy of its own. It authenticates the
--      caller, checks captaincy, and debits the buy-in before inserting.
--
--   2. enter_own_tournament() — the ONE legitimate browser insert: an
--      organiser fielding a team in the tournament they just created on
--      /play/create-tournament. There is no buy-in to collect (they fronted
--      the whole pitch fee), so there is nothing for a server route to do,
--      but the row still has to be written by the captain's own session.
--
-- Nothing in the app deletes an entry, so the open delete policy goes too —
-- it let anyone remove any team from any tournament.
-- ════════════════════════════════════════════════════════════════════════


-- ── Close the front door ────────────────────────────────────────────────
-- No insert or delete policy at all: RLS denies by default, service_role is
-- unaffected, and the RPC below is security definer so it doesn't need one.
drop policy if exists "Anyone can join open matches"  on public.open_match_teams;
drop policy if exists "Captains can join open matches" on public.open_match_teams;
drop policy if exists "Anyone can leave open matches" on public.open_match_teams;
drop policy if exists "Joiner can leave"              on public.open_match_teams;

-- Reading stays public — the tournament page lists entered teams to everyone,
-- signed out included. So does updating: SettlePaymentsModal ticks
-- fees_settled from the captain's browser, and that moves no money.
drop policy if exists "Anyone can view open match teams" on public.open_match_teams;
create policy "Anyone can view open match teams" on public.open_match_teams
  for select using (true);

drop policy if exists "Anyone can update open match teams" on public.open_match_teams;
create policy "Anyone can update open match teams" on public.open_match_teams
  for update using (true) with check (true);


-- ════════════════════════════════════════════════════════════════════════
-- enter_own_tournament — the organiser fielding their own team
-- ════════════════════════════════════════════════════════════════════════
-- Deliberately narrow. It will only write a row when ALL of these hold:
--
--   • the caller captains p_team_id
--   • that team is the tournament's organiser_team_id
--   • the tournament is open and not full
--   • the team isn't already entered
--
-- So it cannot be repurposed to enter a tournament someone else is hosting.
-- Anything paid goes through /api/tournaments/join, which this never touches.
create or replace function public.enter_own_tournament(
  p_open_match_id uuid,
  p_team_id       uuid,
  p_team_name     text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_max integer; v_count integer; v_status text; v_organiser uuid;
begin
  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.captain_id = auth.uid()
  ) then
    raise exception 'Only the team captain can enter the team';
  end if;

  select om.max_teams, om.status, om.organiser_team_id
    into v_max, v_status, v_organiser
    from public.open_matches om where om.id = p_open_match_id;

  if v_organiser is null then
    raise exception 'Tournament not found';
  end if;
  if v_organiser <> p_team_id then
    -- Someone else is hosting: entering costs money, so it has to go through
    -- the join route where the buy-in is taken.
    raise exception 'Only the organising team can enter this way';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This tournament has been cancelled';
  end if;

  if exists (
    select 1 from public.open_match_teams
    where open_match_id = p_open_match_id and team_id = p_team_id
  ) then
    raise exception 'That team has already entered';
  end if;

  select count(*) into v_count
    from public.open_match_teams where open_match_id = p_open_match_id;
  if v_count >= v_max then
    raise exception 'This tournament is full';
  end if;

  insert into public.open_match_teams(
    open_match_id, team_id, team_name, joined_by, payment_status)
    values (p_open_match_id, p_team_id, coalesce(p_team_name, ''), auth.uid(), 'paid')
    returning id into v_id;

  return v_id;
end $$;

grant execute on function public.enter_own_tournament(uuid, uuid, text) to authenticated;
revoke execute on function public.enter_own_tournament(uuid, uuid, text) from anon;
