-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Handing a team over, and deleting an account
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run after supabase_co_captains.sql, supabase_captain_joining_fee.sql,
-- supabase_joining_fee_current.sql and supabase_pilot_security.sql.
--
-- Both stores require an app to let a person delete their account. A captain
-- can't simply vanish — the team, its credit and every fixture filed under
-- their id would be left with nobody holding them — so deletion is refused
-- until the captain hands the team to one of their co-captains (user, 26 Oct
-- 2026). This file is the handover. The deletion itself runs in
-- /api/account/delete with the service key; the one piece of it that needs
-- SQL is removing the sign-in identities, below.
--
-- Both functions are SERVICE ROLE ONLY. The routes check who is asking
-- (lib/api-auth.ts) and then call them; a browser calling them directly would
-- be naming any team and any captain it liked.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. hand_over_team ───────────────────────────────────────────────────
-- p_from (the captain) gives p_team_id to p_to (an approved co-captain).
-- One transaction, so the squad never sees half a handover:
--
--   • p_to's membership row goes — a captain holds the team through
--     teams.captain_id and has no row — and their joining-fee figures move
--     onto the captain's copy on teams.
--   • p_from gets an ordinary approved membership carrying their own captain's
--     figures, so they stay in the squad as a player. They can leave, or
--     delete their account, from there.
--   • Everything filed under the captain's id is re-filed under the new one
--     (CLAUDE.md, Co-captains rule 2): open and matched match posts, the
--     team's side of challenges, availability polls, pending player offers.
--     Every `.eq("captain_id", …)` read then keeps finding them.
--
-- The guards on teams.captain_id and the money columns trust the service role
-- (uniter_trusted_writer), which is the only caller this is granted to.
create or replace function public.hand_over_team(
  p_team_id uuid,
  p_from    uuid,
  p_to      uuid
) returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_team    record;
  v_member  record;
begin
  select t.id, t.name, t.captain_id,
         coalesce(t.captain_joining_fee_due_pence, 0)  as due,
         coalesce(t.captain_joining_fee_paid_pence, 0) as paid
    into v_team
    from public.teams t where t.id = p_team_id for update;
  if v_team.id is null then
    raise exception 'Team not found';
  end if;
  if v_team.captain_id is distinct from p_from then
    raise exception 'Only the captain can hand the team over';
  end if;
  if p_to = p_from then
    raise exception 'You already captain this team';
  end if;

  select m.id,
         coalesce(m.joining_fee_due_pence, 0)  as due,
         coalesce(m.joining_fee_paid_pence, 0) as paid
    into v_member
    from public.team_members m
   where m.team_id = p_team_id and m.player_id = p_to
     and m.status = 'approved' and m.is_co_captain
   for update;
  if v_member.id is null then
    raise exception 'The team can only be handed to one of its co-captains';
  end if;

  delete from public.team_members where id = v_member.id;

  -- The old captain joins the squad while still captain, so the welcome DM
  -- the approval trigger sends (notify_joining_fee, when a fee is owed) goes
  -- from them to themselves — and is removed straight after. now() is the
  -- transaction's start, so only this handover's message matches.
  insert into public.team_members
    (team_id, player_id, status, is_co_captain, joining_fee_due_pence, joining_fee_paid_pence)
  values (p_team_id, p_from, 'approved', false, v_team.due, v_team.paid);
  delete from public.messages
   where sender_id = p_from and receiver_id = p_from and created_at >= now();

  update public.teams
     set captain_id = p_to,
         captain_joining_fee_due_pence  = v_member.due,
         captain_joining_fee_paid_pence = v_member.paid
   where id = p_team_id;

  update public.match_posts set captain_id = p_to
   where team_id = p_team_id and captain_id = p_from;
  update public.challenges set challenger_captain_id = p_to
   where challenger_team_id = p_team_id and challenger_captain_id = p_from;
  update public.availability_requests set captain_id = p_to
   where team_id = p_team_id and captain_id = p_from;
  if to_regclass('public.player_offers') is not null then
    update public.player_offers set captain_id = p_to
     where team_id = p_team_id and captain_id = p_from and status = 'pending';
  end if;

  insert into public.notifications(user_id, type, title, body, link)
  values (
    p_to, 'team_handover',
    'You''re now the captain',
    'You now captain ' || coalesce(v_team.name, 'your team')
      || '. You can appoint co-captains from Team Settings.',
    '/my-team/settings');
end $fn$;

revoke all on function public.hand_over_team(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.hand_over_team(uuid, uuid, uuid) to service_role;


-- ── 2. delete_auth_identities ───────────────────────────────────────────
-- /api/account/delete soft-deletes the auth user, which keeps the auth.users
-- row so the ledger, bookings and results that reference it stay intact. Its
-- sign-in identities are removed here, so a Google account that belonged to a
-- deleted Uniter account can create a fresh one later instead of landing on
-- the deleted one.
create or replace function public.delete_auth_identities(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  delete from auth.identities where user_id = p_user_id;
end $fn$;

revoke all on function public.delete_auth_identities(uuid) from public, anon, authenticated;
grant  execute on function public.delete_auth_identities(uuid) to service_role;


-- ── Verify ──────────────────────────────────────────────────────────────
-- Both should list service_role only:
--   select p.proname, array_agg(r.rolname)
--     from pg_proc p
--     join lateral aclexplode(p.proacl) a on true
--     join pg_roles r on r.oid = a.grantee
--    where p.proname in ('hand_over_team', 'delete_auth_identities')
--    group by 1;
