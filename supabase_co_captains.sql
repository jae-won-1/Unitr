-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Co-captains migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run AFTER: supabase_joining_fees.sql, supabase_team_invites.sql,
--            supabase_tournament_entry_lockdown.sql
--            (it redefines functions first defined in those files).
--
-- A captain can promote approved squad members to CO-CAPTAIN. A co-captain
-- has the captain's authority everywhere except one place: they cannot
-- appoint, demote, or otherwise change who else is a co-captain. Handing out
-- authority stays with the one person who was handed the team.
--
-- The flag lives on the membership row, not on `teams`, because a team has
-- one captain and any number of co-captains, and because every co-captain is
-- by definition already an approved member.
--
--   team_members.is_co_captain — true for a promoted squad member
--
-- Two things follow from that:
--
--   • A co-captain still owes their joining fee like any other member. Being
--     trusted with the squad is not a discount.
--   • Leaving the team drops the membership row and the promotion with it,
--     which is the behaviour you want and costs nothing to get.
--
-- CLIENT SIDE: the app never keys a fixture off "the acting user's id" any
-- more — a post, a challenge, a poll and an announcement are all written
-- under the TEAM'S captain_id even when a co-captain is the one pressing the
-- button (lib/team-leadership.ts). That keeps every existing query reading
-- `.eq("captain_id", …)` correct without rewriting it.
-- ════════════════════════════════════════════════════════════════════════

alter table public.team_members
  add column if not exists is_co_captain boolean not null default false;

create index if not exists team_members_co_captain_idx
  on public.team_members(team_id) where is_co_captain;


-- ── Legacy `notifications.player_id` ────────────────────────────────────
-- Some databases carry an older notifications table whose `player_id` column
-- is NOT NULL, predating supabase_tournament_schedule.sql standardising on
-- `user_id`. Every insert in the app — referee assignments, tournament
-- invites, and set_co_captain below — writes `user_id` only, so that
-- constraint fails the write. The browser swallows the error; SQL doesn't.
--
-- Relax it where it exists and backfill from user_id, so one shape works
-- everywhere. Deliberately repeated in supabase_captain_joining_fee.sql:
-- each migration has to stand on its own.
do $fix$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications'
       and column_name = 'player_id' and is_nullable = 'NO'
  ) then
    update public.notifications set player_id = user_id
      where player_id is null and user_id is not null;
    alter table public.notifications alter column player_id drop not null;
  end if;
end $fix$;


-- ── Who may act for a team ──────────────────────────────────────────────
-- The one question the rest of this file (and lib/api-auth.ts) asks. Kept in
-- SQL as well as TypeScript because the RPCs below run inside the database
-- and can't call the app.
create or replace function public.is_team_leader(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.teams t
     where t.id = p_team_id and t.captain_id = p_user_id
  ) or exists (
    select 1 from public.team_members m
     where m.team_id = p_team_id
       and m.player_id = p_user_id
       and m.status = 'approved'
       and m.is_co_captain
  );
$fn$;

grant execute on function public.is_team_leader(uuid, uuid) to authenticated, anon, service_role;


-- ── Only the captain may change the co-captain flag ─────────────────────
-- RLS on team_members is `using (true)` in this prototype, so without this a
-- player could promote themselves with one update from the browser. Every
-- other column keeps the permissive policy; this is the one that hands out
-- authority, so it gets a real check.
--
-- auth.uid() is null for the service role (webhooks, admin scripts) — those
-- are trusted and pass through.
create or replace function public.guard_co_captain_writes()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_captain uuid;
begin
  if tg_op = 'INSERT' then
    if not new.is_co_captain then return new; end if;
  elsif new.is_co_captain is not distinct from old.is_co_captain then
    return new;
  end if;

  if v_uid is null then return new; end if;              -- service role

  select captain_id into v_captain from public.teams where id = new.team_id;
  if v_captain is distinct from v_uid then
    raise exception 'Only the team captain can appoint or remove a co-captain';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_guard_co_captain_writes on public.team_members;
create trigger trg_guard_co_captain_writes
  before insert or update on public.team_members
  for each row execute function public.guard_co_captain_writes();


-- ── Appoint / step down ─────────────────────────────────────────────────
-- Captain-only, by design: this is the single power a co-captain does not
-- inherit. Promoting tells the player, in the inbox everything else from
-- their captain arrives in, plus a bell notification.
create or replace function public.set_co_captain(
  p_team_id   uuid,
  p_player_id uuid,
  p_make      boolean
) returns void language plpgsql security definer set search_path = public as $fn$
declare v_team record; v_updated integer;
begin
  select t.id, t.name, t.captain_id into v_team
    from public.teams t where t.id = p_team_id;
  if v_team.id is null then
    raise exception 'Team not found';
  end if;
  if v_team.captain_id is distinct from auth.uid() then
    raise exception 'Only the team captain can appoint a co-captain';
  end if;
  if p_player_id = v_team.captain_id then
    raise exception 'The captain already has every permission';
  end if;

  update public.team_members
     set is_co_captain = coalesce(p_make, false)
   where team_id = p_team_id
     and player_id = p_player_id
     and status = 'approved';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'That player is not an approved member of this team';
  end if;

  if p_make then
    insert into public.messages(sender_id, receiver_id, type, body)
    values (v_team.captain_id, p_player_id, 'direct',
      'You are now a co-captain of ' || coalesce(v_team.name, 'the team')
      || '. You can post games, manage matches, pick line-ups, enter tournaments '
      || 'and handle the team''s money exactly as I can. The one thing you cannot '
      || 'do is appoint other co-captains.');

    insert into public.notifications(user_id, type, title, body, link)
    values (p_player_id, 'co_captain',
      'You are a co-captain',
      coalesce(v_team.name, 'Your team') || ' made you a co-captain.',
      '/my-team');
  end if;
end $fn$;

grant execute on function public.set_co_captain(uuid, uuid, boolean) to authenticated;
revoke execute on function public.set_co_captain(uuid, uuid, boolean) from anon;


-- ════════════════════════════════════════════════════════════════════════
-- Redefinitions — every captain-gated RPC now asks is_team_leader()
-- ════════════════════════════════════════════════════════════════════════
-- Bodies are unchanged from their original files apart from the permission
-- line. Listed here rather than edited in place so the original migrations
-- stay runnable on their own.

-- record_cash_credit — supabase_joining_fees.sql
create or replace function public.record_cash_credit(
  p_team_id      uuid,
  p_amount_pence integer,
  p_player_id    uuid
) returns integer language plpgsql security definer set search_path = public as $fn$
declare v_new integer;
begin
  if p_amount_pence is null or p_amount_pence <= 0 then
    raise exception 'record_cash_credit requires a positive amount';
  end if;
  if not public.is_team_leader(p_team_id, auth.uid()) then
    raise exception 'Only the team captain or a co-captain can record a cash payment';
  end if;

  insert into public.team_credits(team_id, balance_pence) values (p_team_id, p_amount_pence)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + p_amount_pence, updated_at = now()
    returning balance_pence into v_new;

  insert into public.team_credit_transactions(team_id, player_id, type, amount_pence)
    values (p_team_id, p_player_id, 'deposit', p_amount_pence);

  perform public.apply_deposit_to_joining_fee(p_team_id, p_player_id, p_amount_pence);

  return v_new;
end $fn$;

grant execute on function public.record_cash_credit(uuid, integer, uuid) to authenticated, service_role;


-- ensure_team_invite_code / rotate_team_invite_code — supabase_team_invites.sql
create or replace function public.ensure_team_invite_code(p_team_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_code text;
begin
  if not public.is_team_leader(p_team_id, auth.uid()) then
    raise exception 'Only the team captain or a co-captain can create an invite link';
  end if;

  select invite_code into v_code from public.teams where id = p_team_id;

  if v_code is null then
    v_code := public.gen_team_invite_code();
    update public.teams set invite_code = v_code where id = p_team_id;
  end if;

  return v_code;
end $fn$;

create or replace function public.rotate_team_invite_code(p_team_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_code text;
begin
  if not public.is_team_leader(p_team_id, auth.uid()) then
    raise exception 'Only the team captain or a co-captain can reset an invite link';
  end if;

  v_code := public.gen_team_invite_code();
  update public.teams set invite_code = v_code where id = p_team_id;
  return v_code;
end $fn$;


-- enter_own_tournament — supabase_tournament_entry_lockdown.sql
-- Still deliberately narrow: organiser's own team, open, not full, not
-- already in. Only the first test loosens, from captain to leader.
create or replace function public.enter_own_tournament(
  p_open_match_id uuid,
  p_team_id       uuid,
  p_team_name     text
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_max integer; v_count integer; v_status text; v_organiser uuid;
begin
  if not public.is_team_leader(p_team_id, auth.uid()) then
    raise exception 'Only the team captain or a co-captain can enter the team';
  end if;

  select om.max_teams, om.status, om.organiser_team_id
    into v_max, v_status, v_organiser
    from public.open_matches om where om.id = p_open_match_id;

  if v_organiser is null then
    raise exception 'Tournament not found';
  end if;
  if v_organiser <> p_team_id then
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
end $fn$;

grant execute on function public.enter_own_tournament(uuid, uuid, text) to authenticated;
revoke execute on function public.enter_own_tournament(uuid, uuid, text) from anon;
