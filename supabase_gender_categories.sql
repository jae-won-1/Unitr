-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Male and female football
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run after supabase_player_demographics.sql, supabase_ringers.sql,
-- supabase_team_tournaments.sql (open_matches.organiser_team_id) and
-- supabase_tournament_entry_lockdown.sql.
--
-- Until now every team and game was implicitly men's. This gives each one a
-- category so a women's event can exist, and so a player sees their own
-- side's games by default.
--
--   profiles.gender          'male' | 'female' | 'prefer_not_to_say' | null
--   *.gender_category        'male' | 'female'
--
-- profiles.gender is who the player is (null = not answered yet; the app asks).
-- gender_category is which competition a team or game belongs to. There is no
-- 'mixed' category yet: mixed football will be the individual-spot social
-- games, which aren't built.
--
-- The rules, enforced here so every route and RPC obeys them:
--   • a team is male or female
--   • a match post and a ringer request are always their team's category —
--     a male team can only post male games
--   • a team-hosted tournament is its host team's category; Uniter- and
--     venue-hosted events choose
--   • only a team of the event's category can enter it, or accept a post
--
-- The category is self-declared and a team leader can change it, so this is
-- honesty-based. Staff's Remove button on an event is the fallback.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. profiles.gender: three answers ───────────────────────────────────
-- 'non_binary' is no longer offered. Nobody chose it on the live database at
-- the time of writing; any such row folds into prefer_not_to_say.
update public.profiles set gender = 'prefer_not_to_say' where gender = 'non_binary';

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check
  check (gender is null or gender in ('male', 'female', 'prefer_not_to_say'));


-- ── 2. teams.gender_category ────────────────────────────────────────────
alter table public.teams add column if not exists gender_category text;

-- Backfill: a team takes its captain's gender, and is male unless the captain
-- said female — every team before this was assumed to be men's.
update public.teams t
   set gender_category = case when p.gender = 'female' then 'female' else 'male' end
  from public.profiles p
 where p.id = t.captain_id and t.gender_category is null;
update public.teams set gender_category = 'male' where gender_category is null;

-- A team created by code that doesn't send a category gets the same rule as
-- the backfill, so registration keeps working before the app is deployed.
create or replace function public.team_gender_category_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.gender_category is null then
    select case when p.gender = 'female' then 'female' else 'male' end
      into new.gender_category
      from public.profiles p where p.id = new.captain_id;
    new.gender_category := coalesce(new.gender_category, 'male');
  end if;
  return new;
end $$;

drop trigger if exists team_gender_category_default on public.teams;
create trigger team_gender_category_default
  before insert on public.teams
  for each row execute function public.team_gender_category_default();

alter table public.teams alter column gender_category set not null;
alter table public.teams drop constraint if exists teams_gender_category_check;
alter table public.teams add constraint teams_gender_category_check
  check (gender_category in ('male', 'female'));


-- ── 3. match_posts / ringer_requests: always their team's category ──────
alter table public.match_posts     add column if not exists gender_category text;
alter table public.ringer_requests add column if not exists gender_category text;

update public.match_posts mp set gender_category = t.gender_category
  from public.teams t where t.id = mp.team_id and mp.gender_category is null;
update public.ringer_requests rr set gender_category = t.gender_category
  from public.teams t where t.id = rr.team_id and rr.gender_category is null;
-- A post whose team has since been deleted.
update public.match_posts set gender_category = 'male' where gender_category is null;

-- Fills the category from the team when it's left out (so /api/book/pitch and
-- /api/book/post need no change), and refuses one that disagrees with it.
create or replace function public.inherit_team_gender_category()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  team_category text;
begin
  select gender_category into team_category from public.teams where id = new.team_id;
  if team_category is null then
    return new;  -- team gone (delete cascading); nothing to check against
  end if;
  if new.gender_category is null then
    new.gender_category := team_category;
  elsif new.gender_category <> team_category then
    raise exception 'A % team can only post % games', team_category, team_category;
  end if;
  return new;
end $$;

drop trigger if exists match_posts_gender_category on public.match_posts;
create trigger match_posts_gender_category
  before insert or update of gender_category, team_id on public.match_posts
  for each row execute function public.inherit_team_gender_category();

drop trigger if exists ringer_requests_gender_category on public.ringer_requests;
create trigger ringer_requests_gender_category
  before insert or update of gender_category, team_id on public.ringer_requests
  for each row execute function public.inherit_team_gender_category();

alter table public.match_posts alter column gender_category set not null;
alter table public.match_posts drop constraint if exists match_posts_gender_category_check;
alter table public.match_posts add constraint match_posts_gender_category_check
  check (gender_category in ('male', 'female'));

alter table public.ringer_requests alter column gender_category set not null;
alter table public.ringer_requests drop constraint if exists ringer_requests_gender_category_check;
alter table public.ringer_requests add constraint ringer_requests_gender_category_check
  check (gender_category in ('male', 'female'));


-- ── 4. open_matches: chosen by Uniter / the venue, inherited by a team ──
alter table public.open_matches add column if not exists gender_category text;

update public.open_matches om set gender_category = t.gender_category
  from public.teams t where t.id = om.organiser_team_id and om.gender_category is null;
update public.open_matches set gender_category = 'male' where gender_category is null;

-- A team-hosted tournament is its team's category. An admin or venue event
-- that doesn't say is male — that is what the create screens meant until they
-- were given the choice, and it keeps them working before the app deploys.
create or replace function public.open_match_gender_category()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  team_category text;
begin
  if new.organiser_team_id is not null then
    select gender_category into team_category from public.teams where id = new.organiser_team_id;
  end if;
  if team_category is not null then
    if new.gender_category is null then
      new.gender_category := team_category;
    elsif new.gender_category <> team_category then
      raise exception 'A % team can only host % events', team_category, team_category;
    end if;
  elsif new.gender_category is null then
    new.gender_category := 'male';
  end if;
  return new;
end $$;

drop trigger if exists open_matches_gender_category on public.open_matches;
create trigger open_matches_gender_category
  before insert or update of gender_category, organiser_team_id on public.open_matches
  for each row execute function public.open_match_gender_category();

alter table public.open_matches alter column gender_category set not null;
alter table public.open_matches drop constraint if exists open_matches_gender_category_check;
alter table public.open_matches add constraint open_matches_gender_category_check
  check (gender_category in ('male', 'female'));


-- ── 5. Only the right team can enter ────────────────────────────────────
-- open_match_teams is written only by /api/tournaments/join and the
-- enter_own_tournament RPC, and challenges only by /api/challenges/accept, so
-- a trigger on each is one check covering every way in. The routes should
-- still check first and say so in plain words; this is the backstop.
create or replace function public.check_event_entry_gender()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  team_category  text;
  event_category text;
begin
  select gender_category into team_category from public.teams where id = new.team_id;
  select gender_category into event_category from public.open_matches where id = new.open_match_id;
  if team_category is distinct from event_category then
    raise exception 'This is a % event — only % teams can enter', event_category, event_category;
  end if;
  return new;
end $$;

drop trigger if exists open_match_teams_gender on public.open_match_teams;
create trigger open_match_teams_gender
  before insert on public.open_match_teams
  for each row execute function public.check_event_entry_gender();

create or replace function public.check_challenge_gender()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  team_category text;
  post_category text;
begin
  select gender_category into team_category from public.teams where id = new.challenger_team_id;
  select gender_category into post_category from public.match_posts where id = new.post_id;
  if team_category is distinct from post_category then
    raise exception 'This is a % game — only % teams can accept it', post_category, post_category;
  end if;
  return new;
end $$;

drop trigger if exists challenges_gender on public.challenges;
create trigger challenges_gender
  before insert on public.challenges
  for each row execute function public.check_challenge_gender();


-- ── 6. Changing a team's category ───────────────────────────────────────
-- Refused while the team is entered in, or hosting, an event that hasn't happened — it
-- would leave a male team in a female event or the reverse. Otherwise its
-- open posts and ringer requests move with it, so a post can never disagree
-- with its team.
create or replace function public.team_gender_category_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  today text := to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM-DD');
begin
  if new.gender_category is not distinct from old.gender_category then
    return new;
  end if;
  if exists (
    select 1 from public.open_match_teams omt
      join public.open_matches om on om.id = omt.open_match_id
     where omt.team_id = new.id
       and om.status <> 'cancelled'
       and om.match_date >= today
  ) or exists (
    select 1 from public.open_matches om
     where om.organiser_team_id = new.id
       and om.status <> 'cancelled'
       and om.match_date >= today
  ) then
    raise exception 'Leave or cancel your upcoming events before changing the team''s category';
  end if;
  return new;
end $$;

drop trigger if exists team_gender_category_change on public.teams;
create trigger team_gender_category_change
  before update of gender_category on public.teams
  for each row execute function public.team_gender_category_change();

create or replace function public.team_gender_category_cascade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.match_posts set gender_category = new.gender_category
   where team_id = new.id and status = 'open';
  update public.ringer_requests set gender_category = new.gender_category
   where team_id = new.id and status = 'open';
  return null;
end $$;

drop trigger if exists team_gender_category_cascade on public.teams;
create trigger team_gender_category_cascade
  after update of gender_category on public.teams
  for each row when (old.gender_category is distinct from new.gender_category)
  execute function public.team_gender_category_cascade();


-- ── Grants ──────────────────────────────────────────────────────────────
-- Trigger functions can't be called over PostgREST, but every security
-- definer function here is revoked anyway, per the house rule.
revoke all on function public.team_gender_category_default()  from public, anon, authenticated;
revoke all on function public.inherit_team_gender_category()  from public, anon, authenticated;
revoke all on function public.open_match_gender_category()    from public, anon, authenticated;
revoke all on function public.check_event_entry_gender()      from public, anon, authenticated;
revoke all on function public.check_challenge_gender()        from public, anon, authenticated;
revoke all on function public.team_gender_category_change()   from public, anon, authenticated;
revoke all on function public.team_gender_category_cascade()  from public, anon, authenticated;


-- ── Notes ───────────────────────────────────────────────────────────────
-- • Old rows of matches that already happened keep the category they were
--   backfilled with; nothing reads it for the past.
-- • A prefer_not_to_say or unanswered player belongs to neither side by
--   default; which games they see is an app decision (lib/), not a column.
-- • Nothing stops a player joining a team of the other category — joining a
--   squad is the captain's approval. The category gates teams, not people.
-- • Runs inside the RLS that already exists: team leaders write teams and
--   match_posts, organisers write open_matches. No policy changes here.
