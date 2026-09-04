-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Team invite links migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run after supabase_joining_fees.sql (this file relies on that file's
-- approval triggers firing for link joins too).
--
-- A captain generates one link — /join/<code> — and sends it to their squad.
-- Anyone who opens it joins the team directly, no request to approve: the
-- captain already vouched for them by handing over the link. That is the
-- whole point of the feature, and it is why the code is a secret rather than
-- the team's uuid, and why the captain can rotate it.
--
-- Joining through a link is otherwise an ORDINARY approval. It writes the
-- same `team_members` row with status 'approved' that the captain's Approve
-- button writes, so the joining-fee snapshot and welcome DM
-- (supabase_joining_fees.sql) fire unchanged — a link joiner still owes the
-- fee before they can vote available.
--
-- Everything here is SECURITY DEFINER and keyed off auth.uid(): the browser
-- says which code it holds, never who it is or which team it lands in.
-- ════════════════════════════════════════════════════════════════════════

alter table public.teams
  add column if not exists invite_code text;

-- Partial unique index rather than a unique constraint: teams that have never
-- generated a link keep a null code, and many nulls must coexist.
create unique index if not exists teams_invite_code_key
  on public.teams (invite_code)
  where invite_code is not null;


-- ── Code generation ─────────────────────────────────────────────────────
-- 12 hex characters from md5(). Not cryptographically strong, but the search
-- space is far past anything worth brute-forcing for a prototype, and md5()
-- needs no extension — pgcrypto is not guaranteed to be enabled. Hex also
-- dodges the o/0 and l/1 confusions in a code read aloud.
create or replace function public.gen_team_invite_code()
returns text language plpgsql as $$
declare v_code text;
begin
  loop
    v_code := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    exit when not exists (select 1 from public.teams where invite_code = v_code);
  end loop;
  return v_code;
end $$;


-- ── Captain: get (or mint) the team's link ──────────────────────────────
-- Returns the existing code so a link the captain already sent out keeps
-- working — only rotate_team_invite_code() ever invalidates one.
create or replace function public.ensure_team_invite_code(p_team_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select invite_code into v_code
    from public.teams
    where id = p_team_id and captain_id = auth.uid();

  if not found then
    raise exception 'Only the team captain can create an invite link';
  end if;

  if v_code is null then
    v_code := public.gen_team_invite_code();
    update public.teams set invite_code = v_code where id = p_team_id;
  end if;

  return v_code;
end $$;


-- ── Captain: burn the old link, mint a new one ──────────────────────────
-- The link is a bearer token — anyone holding it is in the squad. When one
-- leaks into the wrong group chat the only fix is a new code.
create or replace function public.rotate_team_invite_code(p_team_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not exists (
    select 1 from public.teams where id = p_team_id and captain_id = auth.uid()
  ) then
    raise exception 'Only the team captain can reset an invite link';
  end if;

  v_code := public.gen_team_invite_code();
  update public.teams set invite_code = v_code where id = p_team_id;
  return v_code;
end $$;


-- ── Anyone: what team is behind this code? ──────────────────────────────
-- Callable signed out, because that is the whole first half of the flow: a
-- stranger opens the link and has to see whose team it is before deciding to
-- sign up. Deliberately returns only what the public team page already shows
-- — no squad, no captain id, no fee bookkeeping.
create or replace function public.team_by_invite_code(p_code text)
returns table (
  id uuid,
  name text,
  location text,
  level text,
  format text,
  photo_url text,
  joining_fee_pence integer,
  member_count integer
) language sql security definer stable set search_path = public as $$
  select
    t.id,
    t.name,
    t.location,
    t.level,
    t.format,
    t.photo_url,
    coalesce(t.joining_fee_pence, 0),
    (select count(*)::integer + 1
       from public.team_members m
       where m.team_id = t.id and m.status = 'approved')
  from public.teams t
  where t.invite_code = p_code
  limit 1;
$$;


-- ── Signed in: take the invite ──────────────────────────────────────────
-- Returns a jsonb verdict rather than raising, because every outcome here is
-- something the page has to *say* — "you're in", "you already were", "you
-- captain another team" are all normal, not errors.
--
--   status: joined | already_member | captain_elsewhere | in_other_team
--         | is_captain | venue_manager | not_found
--
-- One approved membership per player is an invariant the app leans on
-- (RoleContext does a maybeSingle over approved rows, which errors outright
-- on two), so a player already settled somewhere is turned away here rather
-- than left with a broken Home.
create or replace function public.join_team_by_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_team record;
  v_existing record;
  v_other text;
begin
  if v_uid is null then
    raise exception 'Sign in to use an invite link';
  end if;

  select t.id, t.name, t.captain_id into v_team
    from public.teams t where t.invite_code = p_code;

  if v_team.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Venue managers have no squad life at all; sending them into a team would
  -- put a role on the account its whole portal assumes it doesn't have.
  if exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.account_type = 'venue_manager'
  ) then
    return jsonb_build_object('status', 'venue_manager');
  end if;

  if v_team.captain_id = v_uid then
    return jsonb_build_object(
      'status', 'is_captain', 'team_id', v_team.id, 'team_name', v_team.name);
  end if;

  select t.name into v_other
    from public.teams t where t.captain_id = v_uid limit 1;
  if v_other is not null then
    return jsonb_build_object('status', 'captain_elsewhere', 'other_team', v_other);
  end if;

  -- Already approved somewhere else → refuse. Already approved *here* → say
  -- so and stop, so a re-tapped link is a no-op rather than a second row.
  select m.id, m.team_id, m.status into v_existing
    from public.team_members m
    where m.player_id = v_uid and m.status = 'approved'
    limit 1;

  if v_existing.id is not null then
    if v_existing.team_id = v_team.id then
      return jsonb_build_object(
        'status', 'already_member', 'team_id', v_team.id, 'team_name', v_team.name);
    end if;
    select t.name into v_other from public.teams t where t.id = v_existing.team_id;
    return jsonb_build_object('status', 'in_other_team', 'other_team', v_other);
  end if;

  -- A pending or previously rejected request for THIS team becomes the
  -- approval — the link is the captain answering it.
  select m.id into v_existing
    from public.team_members m
    where m.player_id = v_uid and m.team_id = v_team.id
    limit 1;

  if v_existing.id is not null then
    update public.team_members
      set status = 'approved'
      where id = v_existing.id;
  else
    insert into public.team_members (team_id, player_id, status)
      values (v_team.id, v_uid, 'approved');
  end if;

  return jsonb_build_object(
    'status', 'joined', 'team_id', v_team.id, 'team_name', v_team.name);
end $$;


-- ── Grants ──────────────────────────────────────────────────────────────
-- Signed-out browsers may look a team up; only a session may join or manage.
revoke execute on function public.gen_team_invite_code() from public, anon, authenticated;

revoke execute on function public.ensure_team_invite_code(uuid) from public, anon;
grant  execute on function public.ensure_team_invite_code(uuid) to authenticated;

revoke execute on function public.rotate_team_invite_code(uuid) from public, anon;
grant  execute on function public.rotate_team_invite_code(uuid) to authenticated;

grant  execute on function public.team_by_invite_code(text) to anon, authenticated;

revoke execute on function public.join_team_by_invite(text) from public, anon;
grant  execute on function public.join_team_by_invite(text) to authenticated;
