-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Pilot security migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Every fix in this file closes a hole reachable from a browser with the
-- anon key, which ships in the JS bundle and is therefore public. The API
-- routes are not the problem: they all authenticate the caller from their
-- Supabase JWT (lib/api-auth.ts). The problem is that a client can skip the
-- API routes entirely and talk to PostgREST directly, where RLS is
-- `using (true)` on most tables and several `security definer` money
-- functions were never revoked from `authenticated`.
--
-- WRITTEN TO BE APPLIED MID-PILOT. Nothing here touches existing data — no
-- balances, entries, joining fees, memberships or saved cards are altered.
-- Every policy and trigger below blocks only writes the application never
-- makes. The one client change that accompanies this file is
-- app/pay/[matchId] calling /api/credit/apply-replenishment instead of the
-- RPC directly; the payment UI itself is unchanged.
--
-- Run AFTER: supabase_core_tables_rls.sql, supabase_payment_integrity.sql,
-- supabase_joining_fees.sql, supabase_open_matches.sql,
-- supabase_event_takedown.sql, supabase_payment_collection.sql.
-- supabase_admin_hosting.sql and supabase_team_tournaments.sql are required
-- too: §4 names organiser_admin_id and organiser_team_id.
-- supabase_co_captains.sql is optional — §0 degrades without it.
--
-- A rollback block is at the foot of the file.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- §0  Helper — "does this person lead that team?"
-- ════════════════════════════════════════════════════════════════════════
-- The same question lib/team-leadership.ts asks on the client and
-- isTeamLeader() asks in the API routes: captain, or approved co-captain.
--
-- Deliberately NOT `is_team_leader()` from supabase_co_captains.sql — that
-- migration may not have been applied yet, and a policy that references a
-- missing function fails the whole statement. This one degrades instead: if
-- team_members has no is_co_captain column, the co-captain half is simply
-- false and captains still pass.
create or replace function public.uniter_leads_team(p_team_id uuid, p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v_co boolean;
begin
  if p_team_id is null or p_user_id is null then
    return false;
  end if;
  if exists (
    select 1 from public.teams t where t.id = p_team_id and t.captain_id = p_user_id
  ) then
    return true;
  end if;
  begin
    select exists (
      select 1 from public.team_members m
       where m.team_id   = p_team_id
         and m.player_id = p_user_id
         and m.status    = 'approved'
         and m.is_co_captain
    ) into v_co;
  exception when undefined_column then
    v_co := false;                          -- supabase_co_captains.sql not run
  end;
  return coalesce(v_co, false);
end $fn$;

grant execute on function public.uniter_leads_team(uuid, uuid) to authenticated, anon, service_role;


-- ── "Is this write coming from the server?" ─────────────────────────────
-- The guards below have to let the legitimate server-side paths through — the
-- Stripe webhook crediting a joining fee, a fix applied by hand in the SQL
-- editor. The obvious test, `auth.uid() is null`, is WRONG and worth spelling
-- out: an unauthenticated PostgREST request also has no auth.uid(), and
-- team_members is still `using (true)`, so "no session" would have been a way
-- past every trigger in this file rather than a reason to trust the write.
--
-- The request's JWT role is the honest signal. PostgREST sets it to 'anon' or
-- 'authenticated' for a browser and 'service_role' for the service key. The
-- one other caller we mean to trust is a direct connection — the SQL editor,
-- psql, a migration — which is not PostgREST and therefore did not log in as
-- the `authenticator` role every API request arrives through.
--
-- Written to fail closed: anything unrecognised, including claims that won't
-- parse, is not trusted.
create or replace function public.uniter_trusted_writer()
returns boolean language plpgsql stable set search_path = public as $fn$
declare v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if v_claims is null and session_user <> 'authenticator' then
    return true;                              -- direct connection
  end if;
  return coalesce(v_claims::json ->> 'role', '') = 'service_role';
exception when others then
  return false;
end $fn$;

grant execute on function public.uniter_trusted_writer() to authenticated, anon, service_role;


-- ════════════════════════════════════════════════════════════════════════
-- §1  refund_event_buyin — server-only
-- ════════════════════════════════════════════════════════════════════════
-- THE SHARPEST HOLE IN THE PILOT. The function is `security definer`, checks
-- nothing about its caller, and — like every Postgres function — was granted
-- to PUBLIC on creation. So any signed-in user could open devtools and run
--
--   supabase.rpc('refund_event_buyin',
--                { p_team_id: <their team>, p_open_match_id: <the event> })
--
-- Their buy-in returns to team credit as a `buyin_refund` row while their
-- open_match_teams entry stays exactly where it is — a free place in the
-- tournament. The credit can then be taken out to a card through
-- /api/credit/refund, which sees a legitimate balance and a legitimate
-- captain. That is real money off the platform.
--
-- Its only legitimate caller is /api/events/take-down, which runs on
-- adminSupabase (service role) after checking isAdmin against the caller's
-- session. Nothing in the browser calls it, so revoking costs nothing.
revoke execute on function public.refund_event_buyin(uuid, uuid, uuid) from public;
revoke execute on function public.refund_event_buyin(uuid, uuid, uuid) from anon;
revoke execute on function public.refund_event_buyin(uuid, uuid, uuid) from authenticated;
grant  execute on function public.refund_event_buyin(uuid, uuid, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- §2  apply_replenishment — server-only
-- ════════════════════════════════════════════════════════════════════════
-- The same shape of hole, pointed at team credit itself. player_payments
-- accepts any insert from the browser ("System can insert payments" is
-- `with check (true)`), and apply_replenishment is definer, unrevoked, and
-- never asks who is calling. Insert a row with purpose='replenish', any
-- team_id and any amount_pence, call the RPC, and the credit is minted with
-- no payment behind it — precisely what supabase_payment_integrity.sql
-- exists to prevent.
--
-- The honest caller is app/pay/[matchId], which pays by card first and then
-- applies the row. That path now goes through /api/credit/apply-replenishment,
-- which authenticates the caller, checks the row is theirs, and asks STRIPE
-- whether the PaymentIntent actually succeeded before calling this as the
-- service role. Same model as the webhook: credit follows a verified payment.
revoke execute on function public.apply_replenishment(uuid) from public;
revoke execute on function public.apply_replenishment(uuid) from anon;
revoke execute on function public.apply_replenishment(uuid) from authenticated;
grant  execute on function public.apply_replenishment(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- §3  profiles.account_type — nobody promotes themselves to admin
-- ════════════════════════════════════════════════════════════════════════
-- account_type is written from the browser at registration, and the profiles
-- UPDATE policy lets you write your own row. Nothing constrained the value,
-- so any user could set it to 'admin' and then pass isAdmin() in
-- lib/api-auth.ts — which gates taking the pilot event down (refunding every
-- entered team), post moderation, /admin/finance and venue transfers.
--
-- The trigger below leaves registration alone: app/register/page.tsx writes
-- 'venue_manager' or 'player' and nothing else, and no screen in the app ever
-- updates the column afterwards. Existing admins keep the value they already
-- have — a trigger only ever inspects a change.
--
-- An admin is still appointed from the SQL editor or a server route — those
-- are what uniter_trusted_writer() lets through. Note the INSERT branch does
-- NOT lean on the session: registration inserts the profile straight after
-- signUp, and with email confirmation on there is no session yet, so an
-- "is anybody signed in?" test would have left the whole hole open to an
-- unauthenticated request.
create or replace function public.guard_account_type()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if public.uniter_trusted_writer() then     -- service role / SQL editor
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.account_type, 'player') not in ('player', 'venue_manager') then
      raise exception 'account_type must be player or venue_manager';
    end if;
    return new;
  end if;

  -- UPDATE: the column is immutable from a client session. Not "may not
  -- become admin" — may not change at all. A player who could flip to
  -- venue_manager would walk into the venue portal with someone else's
  -- pitches, and nothing in the app needs the write.
  if new.account_type is distinct from old.account_type then
    raise exception 'account_type cannot be changed';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_guard_account_type on public.profiles;
create trigger trg_guard_account_type
  before insert or update on public.profiles
  for each row execute function public.guard_account_type();


-- ════════════════════════════════════════════════════════════════════════
-- §4  open_matches / tournament_invitations — the organiser owns the listing
-- ════════════════════════════════════════════════════════════════════════
-- Both tables were `for all using (true) with check (true)`, and
-- /api/tournaments/join reads the price and the discount straight off them:
--
--   const discount = invite?.status === 'pending' ? invite.discount_pence : 0;
--   const buyIn    = om.price_per_team_pence - discount;
--
-- The route is right to trust the database. The database was wrong to let a
-- captain write it. Either
--   update open_matches set price_per_team_pence = 0 where id = <event>
-- or an invitation inserted for your own team with the full price as the
-- discount, and the entry is free. The same policy let anyone set the pilot
-- event to 'cancelled' or delete it outright.
--
-- Reads stay completely open — the feed, the tournament page and the venue
-- portal all list these to signed-out visitors.
--
-- Writes: an open match is created in exactly three places, each of which
-- names its own organiser — app/admin/create (organiser_admin_id = you),
-- app/play/create-tournament (organiser_team_id = a team you lead) and
-- app/venue/calendar (venue_owner_id = you). Nothing in the client updates
-- or deletes one; /api/tournaments/join marking it 'full' and
-- /api/events/take-down cancelling it both run on the service role, which
-- bypasses RLS. So there is no client UPDATE or DELETE policy at all: with
-- RLS enabled, no policy means no access.
alter table public.open_matches enable row level security;

drop policy if exists "Anyone can view open matches" on public.open_matches;
create policy "Anyone can view open matches" on public.open_matches
  for select using (true);

-- Replaces "Venue owners can manage open matches", which despite its name
-- allowed everybody everything.
drop policy if exists "Venue owners can manage open matches" on public.open_matches;
drop policy if exists "Organisers can post open matches"     on public.open_matches;
create policy "Organisers can post open matches" on public.open_matches
  for insert with check (
    auth.uid() is not null
    and (
      venue_owner_id      = auth.uid()
      or organiser_admin_id = auth.uid()
      or public.uniter_leads_team(organiser_team_id, auth.uid())
    )
  );


-- Invitations carry a per-team discount off the buy-in, so an insert is
-- money. They are written only by the organiser's own screens and by
-- /api/tournaments/join (service role) marking one accepted.
alter table public.tournament_invitations enable row level security;

drop policy if exists "Anyone can view tournament invitations" on public.tournament_invitations;
create policy "Anyone can view tournament invitations" on public.tournament_invitations
  for select using (true);

drop policy if exists "Anyone can manage tournament invitations" on public.tournament_invitations;
drop policy if exists "Organisers can invite teams"             on public.tournament_invitations;
create policy "Organisers can invite teams" on public.tournament_invitations
  for insert with check (
    exists (
      select 1 from public.open_matches om
       where om.id = open_match_id
         and (
           om.venue_owner_id      = auth.uid()
           or om.organiser_admin_id = auth.uid()
           or public.uniter_leads_team(om.organiser_team_id, auth.uid())
         )
    )
  );

drop policy if exists "Organisers can update invitations" on public.tournament_invitations;
create policy "Organisers can update invitations" on public.tournament_invitations
  for update using (
    exists (
      select 1 from public.open_matches om
       where om.id = open_match_id
         and (
           om.venue_owner_id      = auth.uid()
           or om.organiser_admin_id = auth.uid()
           or public.uniter_leads_team(om.organiser_team_id, auth.uid())
         )
    )
  );


-- ════════════════════════════════════════════════════════════════════════
-- §5  Joining fees and team control are not self-service
-- ════════════════════════════════════════════════════════════════════════
-- team_members is `for all using (true) with check (true)` and only the
-- is_co_captain flag was guarded, so a member could run
--
--   update team_members set joining_fee_paid_pence = joining_fee_due_pence
--    where player_id = <me>
--
-- and clear the gate that stops an unpaid member voting available — while
-- the captain's Payment Status tab reports them as paid. The same two
-- columns exist on teams for the captain (supabase_captain_joining_fee.sql),
-- and teams was writable by anyone at all, captain_id included: point that at
-- yourself and you lead the team, spend its credit, and can cash it out to
-- your own card through /api/credit/refund.
--
-- WHAT STILL WORKS, and why. The fee columns move in exactly two places, and
-- both are allowed through below:
--   • the webhook path — credit_from_payment → apply_deposit_to_joining_fee,
--     run by the service role, which uniter_trusted_writer() recognises;
--   • the captain's cash path — record_cash_credit, run from the captain's
--     own browser, which already refuses anyone but that team's captain.
-- A captain writing these columns by hand is therefore no more than they can
-- already do through record_cash_credit. Everyone else is refused.
create or replace function public.guard_team_member_money()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_captain uuid;
begin
  if public.uniter_trusted_writer() then     -- the webhook's credit path
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new row may not arrive pre-paid. Leaving due_pence null is what lets
    -- trg_snapshot_joining_fee compute the real figure off teams.joining_fee_pence
    -- (that trigger fires after this one — 'g' sorts before 's').
    if coalesce(new.joining_fee_paid_pence, 0) <> 0 then
      new.joining_fee_paid_pence := 0;
    end if;
    if new.joining_fee_due_pence is not null then
      new.joining_fee_due_pence := null;
    end if;
    return new;
  end if;

  if new.joining_fee_paid_pence is not distinct from old.joining_fee_paid_pence
     and new.joining_fee_due_pence is not distinct from old.joining_fee_due_pence then
    return new;                              -- untouched — the usual update
  end if;

  select captain_id into v_captain from public.teams where id = new.team_id;
  if v_captain is distinct from v_uid then
    raise exception 'Joining fees are settled by payment, not by editing the record';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_guard_team_member_money on public.team_members;
create trigger trg_guard_team_member_money
  before insert or update on public.team_members
  for each row execute function public.guard_team_member_money();


-- The captain's own copy of the same two numbers lives on teams, next to
-- captain_id. Same rule, plus: whoever holds the team keeps it.
create or replace function public.guard_team_money()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if public.uniter_trusted_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.captain_id is distinct from v_uid then
      raise exception 'A team is created by its own captain';
    end if;
    return new;
  end if;

  -- Handing a team over is not a feature the app has; every screen that
  -- resolves "the team I run" (lib/team-leadership.ts) reads this column, so
  -- a write to it is a takeover of the squad and of its credit.
  if new.captain_id is distinct from old.captain_id then
    raise exception 'captain_id cannot be changed';
  end if;

  -- The captain's joining-fee snapshot: written by trg_snapshot_captain_joining_fee
  -- when the captain sets the fee, and paid down by apply_deposit_to_joining_fee.
  -- Both run as the captain, or as the server.
  --
  -- Those two columns only exist once supabase_captain_joining_fee.sql has been
  -- run. plpgsql resolves record fields at runtime, so a database without them
  -- raises undefined_column here rather than refusing to create the function —
  -- caught, because there is then no captain fee to protect. The house
  -- "missing migrations degrade" rule.
  begin
    if (new.captain_joining_fee_paid_pence is distinct from old.captain_joining_fee_paid_pence
        or new.captain_joining_fee_due_pence is distinct from old.captain_joining_fee_due_pence)
       and old.captain_id is distinct from v_uid then
      raise exception 'Only the captain''s own payments move their joining fee';
    end if;
  exception when undefined_column then
    null;
  end;

  return new;
end $fn$;

drop trigger if exists trg_guard_team_money on public.teams;
create trigger trg_guard_team_money
  before insert or update on public.teams
  for each row execute function public.guard_team_money();


-- Teams themselves: readable by everyone (TeamsPanel and the Transfer Market
-- browse teams you are not in, signed out included), written by the people who
-- run them. The three write sites are app/my-team/create (insert),
-- app/my-team/settings and lib/team-options.ts (update) — all leaders.
drop policy if exists "Anyone can manage teams"      on public.teams;
drop policy if exists "Captains can create teams"    on public.teams;
drop policy if exists "Leaders can update their team" on public.teams;
drop policy if exists "Leaders can delete their team" on public.teams;

create policy "Captains can create teams" on public.teams
  for insert with check (auth.uid() = captain_id);

create policy "Leaders can update their team" on public.teams
  for update using (public.uniter_leads_team(id, auth.uid()))
          with check (public.uniter_leads_team(id, auth.uid()));

create policy "Leaders can delete their team" on public.teams
  for delete using (public.uniter_leads_team(id, auth.uid()));


-- ════════════════════════════════════════════════════════════════════════
-- §6  Direct messages are private
-- ════════════════════════════════════════════════════════════════════════
-- `messages` was select using (true): with the anon key — which is in the JS
-- bundle of every page — anyone could read every direct message on the
-- platform, including the payment reminders and announcements the app sends
-- as DMs. Team chat was given squad-only policies deliberately
-- (supabase_team_chat.sql); the DM table was left behind.
--
-- Every read in the app is already filtered to the viewer
-- (app/messages/page.tsx, app/messages/[otherId], components/TopBar.tsx), and
-- every insert already writes sender_id = the signed-in user, so these
-- policies describe what the app does rather than change it.
drop policy if exists "Anyone can view messages"   on public.messages;
drop policy if exists "Anyone can insert messages" on public.messages;
drop policy if exists "Anyone can update messages" on public.messages;
drop policy if exists "Correspondents read their messages" on public.messages;
drop policy if exists "Senders write their own messages"   on public.messages;
drop policy if exists "Recipients mark messages read"      on public.messages;

create policy "Correspondents read their messages" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "Senders write their own messages" on public.messages
  for insert with check (auth.uid() = sender_id);

-- Marking read is the only update the app makes, and the recipient makes it.
create policy "Recipients mark messages read" on public.messages
  for update using (auth.uid() = receiver_id) with check (auth.uid() = receiver_id);


-- ════════════════════════════════════════════════════════════════════════
-- Verification — run these after applying, signed in as an ordinary player
-- ════════════════════════════════════════════════════════════════════════
-- From the browser console of a logged-in, non-admin account. Every one of
-- these should now fail; before this migration every one succeeded.
--
--   await supabase.rpc('refund_event_buyin',
--     { p_team_id: '<team>', p_open_match_id: '<event>' })   -- permission denied
--   await supabase.rpc('apply_replenishment', { p_payment_id: '<id>' })
--   await supabase.from('profiles').update({ account_type: 'admin' })
--     .eq('id', (await supabase.auth.getUser()).data.user.id)
--   await supabase.from('open_matches')
--     .update({ price_per_team_pence: 0 }).eq('id', '<event>')
--   await supabase.from('team_members')
--     .update({ joining_fee_paid_pence: 99999 }).eq('player_id', '<me>')
--   await supabase.from('teams').update({ captain_id: '<me>' }).eq('id', '<other team>')
--   await supabase.from('messages').select('*').limit(5)   -- only your own
--
-- And these should still work, unchanged:
--   • paying a joining fee by card → credit + fee marked down (webhook)
--   • a captain recording a cash payment (record_cash_credit)
--   • entering the tournament (/api/tournaments/join)
--   • creating a team, editing team settings, approving a join request
--   • posting an event from /admin/create


-- ════════════════════════════════════════════════════════════════════════
-- Rollback — restores the previous, permissive behaviour
-- ════════════════════════════════════════════════════════════════════════
-- Uncomment and run if something in the pilot breaks and you need the old
-- behaviour back while it is diagnosed. It does not undo §1 and §2, which
-- have no legitimate client caller — put those back only if you are certain.
--
-- drop trigger if exists trg_guard_account_type      on public.profiles;
-- drop trigger if exists trg_guard_team_member_money on public.team_members;
-- drop trigger if exists trg_guard_team_money        on public.teams;
--
-- drop policy if exists "Organisers can post open matches" on public.open_matches;
-- create policy "Venue owners can manage open matches" on public.open_matches
--   for all using (true) with check (true);
--
-- drop policy if exists "Organisers can invite teams"      on public.tournament_invitations;
-- drop policy if exists "Organisers can update invitations" on public.tournament_invitations;
-- create policy "Anyone can manage tournament invitations" on public.tournament_invitations
--   for all using (true) with check (true);
--
-- drop policy if exists "Captains can create teams"     on public.teams;
-- drop policy if exists "Leaders can update their team" on public.teams;
-- drop policy if exists "Leaders can delete their team" on public.teams;
-- create policy "Anyone can manage teams" on public.teams
--   for all using (true) with check (true);
--
-- drop policy if exists "Correspondents read their messages" on public.messages;
-- drop policy if exists "Senders write their own messages"   on public.messages;
-- drop policy if exists "Recipients mark messages read"      on public.messages;
-- create policy "Anyone can view messages"   on public.messages for select using (true);
-- create policy "Anyone can insert messages" on public.messages for insert with check (true);
-- create policy "Anyone can update messages" on public.messages for update using (true);
