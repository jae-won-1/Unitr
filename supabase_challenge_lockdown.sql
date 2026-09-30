-- Close the credit-ledger functions and the friendly tables to the browser.
--
-- ⚠ Run this ONLY after the deploy that adds /api/challenges/accept is live on
-- Vercel. Before it, the web's Accept Match still calls these functions from
-- the browser, and this file would break accepting a challenge.
--
-- Found 30 Sep 2026: five `security definer` functions in
-- supabase_credit_ledger.sql / supabase_secured_posts.sql were granted to
-- PUBLIC (the default) and check nothing about their caller. Verified with the
-- anon key and no session — each ran as far as looking up the team ids:
--
--   reimburse_secured_pitch — moves half a "fee" from one team's credit into
--                             another's: any team could take any other's money
--   split_pitch_fee         — debits any two teams
--   hold_credit             — freezes any team's available credit
--   release_hold            — un-freezes it (or, with a negative amount, freezes)
--   capture_and_settle      — the older front-then-reimburse charge (unused)
--
-- And match_posts / challenges / matches were `for all using (true)`, so even
-- behind a server route a forged post "by" another team could be accepted at
-- any price. This file:
--
--   1. makes all five functions service-role only. The server calls them —
--      /api/challenges/accept and /api/posts/take-down — never the browser;
--   2. lets a team's captain or co-captain (is_team_leader,
--      supabase_co_captains.sql) create, edit and delete ONLY their own team's
--      match posts;
--   3. takes client writes off challenges entirely (only the accept route
--      writes them), and leaves matches updatable by the leaders of the two
--      teams in it (Payment Status ticks fees_settled; Submit Result sets the
--      verification flags). Nothing inserts or deletes a match from a browser.
--
-- Reads are unchanged — everything stays publicly readable, as before.
-- To see what is left afterwards:
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('match_posts','challenges','matches')
--    order by 1, 2;
-- Run after supabase_credit_ledger.sql, supabase_secured_posts.sql,
-- supabase_core_tables_rls.sql and supabase_co_captains.sql. Idempotent.

-- ── 1. Ledger functions: service role only ──────────────────────────────
revoke execute on function public.hold_credit(uuid, integer, uuid)                     from public, anon, authenticated;
revoke execute on function public.release_hold(uuid, integer, uuid)                    from public, anon, authenticated;
revoke execute on function public.split_pitch_fee(uuid, uuid, uuid, integer)           from public, anon, authenticated;
revoke execute on function public.capture_and_settle(uuid, uuid, uuid, integer)        from public, anon, authenticated;
revoke execute on function public.reimburse_secured_pitch(uuid, uuid, uuid, integer)   from public, anon, authenticated;

grant execute on function public.hold_credit(uuid, integer, uuid)                      to service_role;
grant execute on function public.release_hold(uuid, integer, uuid)                     to service_role;
grant execute on function public.split_pitch_fee(uuid, uuid, uuid, integer)            to service_role;
grant execute on function public.capture_and_settle(uuid, uuid, uuid, integer)         to service_role;
grant execute on function public.reimburse_secured_pitch(uuid, uuid, uuid, integer)    to service_role;

-- ── 1b. Clear EVERY existing policy on the three tables ────────────────
-- Postgres ORs permissive policies together, so one leftover "anyone can
-- write" policy under a name this file doesn't know keeps the table open.
-- That is exactly what happened on the first run (30 Sep): the functions
-- locked, but a stranger could still insert a match and post in another
-- team's name. So drop whatever is there, by whatever name, and rebuild the
-- set below — reads included, so nothing loses SELECT along the way.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
     where schemaname = 'public' and tablename in ('match_posts', 'challenges', 'matches')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.match_posts enable row level security;
alter table public.challenges  enable row level security;
alter table public.matches     enable row level security;

-- Reads stay public: the Home feed renders for signed-out visitors.
create policy "Anyone can view match posts" on public.match_posts for select using (true);
create policy "Anyone can view challenges"  on public.challenges  for select using (true);
create policy "Anyone can view matches"     on public.matches     for select using (true);

-- ── 2. match_posts: a team's leaders write only their own posts ─────────
drop policy if exists "Anyone can manage match posts" on public.match_posts;
drop policy if exists "Team leaders insert their posts" on public.match_posts;
drop policy if exists "Team leaders update their posts" on public.match_posts;
drop policy if exists "Team leaders delete their posts" on public.match_posts;

create policy "Team leaders insert their posts" on public.match_posts
  for insert with check (public.is_team_leader(team_id, auth.uid()));
create policy "Team leaders update their posts" on public.match_posts
  for update using (public.is_team_leader(team_id, auth.uid()))
  with check (public.is_team_leader(team_id, auth.uid()));
create policy "Team leaders delete their posts" on public.match_posts
  for delete using (public.is_team_leader(team_id, auth.uid()));

-- ── 3. challenges: server only; matches: the two teams' leaders update ──
drop policy if exists "Anyone can manage challenges" on public.challenges;

drop policy if exists "Anyone can manage matches" on public.matches;
drop policy if exists "Match teams' leaders update the match" on public.matches;
create policy "Match teams' leaders update the match" on public.matches
  for update
  using (public.is_team_leader(posting_team_id, auth.uid())
         or public.is_team_leader(challenging_team_id, auth.uid()))
  with check (public.is_team_leader(posting_team_id, auth.uid())
              or public.is_team_leader(challenging_team_id, auth.uid()));

-- ── Check afterwards ────────────────────────────────────────────────────
-- From a browser console on the live site (signed in as anyone), each of these
-- should now fail with "permission denied":
--   await supabase.rpc('split_pitch_fee', { p_match_id: crypto.randomUUID(),
--     p_posting_team: crypto.randomUUID(), p_challenging_team: crypto.randomUUID(), p_fee_pence: 0 })
--   await supabase.rpc('reimburse_secured_pitch', { … same … })
-- and accepting a real challenge on the web should still work.
