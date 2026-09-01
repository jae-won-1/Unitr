-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Row-Level Security for the hand-made core tables
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Every table created BY a migration already enables RLS on the way in. The
-- nine tables below predate the migration files — they were created by hand in
-- the Supabase dashboard early on, which is the one path that does not enable
-- RLS for you. That is what the `rls_disabled_in_public` linter is flagging:
-- with RLS off, the anon key alone reads and writes these tables in full, and
-- the anon key ships to every browser that loads the app.
--
-- Policies here stay permissive, matching the rest of the schema and the
-- prototype's threat model — the app has no server-side authorisation layer to
-- fall back on, and all nine tables are written to directly from the client.
-- The one exception is `profiles`, tightened below.
--
-- READ THIS BEFORE ASSUMING YOU ARE DONE: enabling RLS with `using (true)`
-- satisfies the linter but grants exactly the access it had before. It closes
-- the "table is wide open by accident" hole, not the "anyone with the anon key
-- can read the database" one. See the closing notes for what real policies
-- would need.
-- ════════════════════════════════════════════════════════════════════════


-- ── profiles ────────────────────────────────────────────────────────────
-- SELECT stays open: the app reads other people's profiles constantly (squad
-- lists, Transfer Market, player pages, captain names on posts).
--
-- WRITES are locked to your own row. This is a real restriction rather than a
-- rubber stamp, and it costs nothing — every write site is already own-row
-- (`.eq("id", user.id)`): app/profile/page.tsx:57, :128 and
-- components/SaveCardPrompt.tsx:30. It matters because profiles carries the
-- saved-card columns (stripe_customer_id, stripe_payment_method_id,
-- card_brand, card_last4). Without this, anyone with the anon key can point
-- another player's saved payment method at their own.
--
-- INSERT is deliberately left open. Registration inserts the profile straight
-- after supabase.auth.signUp (app/register/page.tsx:55); if email confirmation
-- is enabled there is no session yet, so auth.uid() is null and an own-row
-- check would break sign-up outright. The insert only ever carries the new
-- user's own id, and UPDATE is what protects the card columns.
alter table public.profiles enable row level security;
drop policy if exists "Anyone can view profiles" on public.profiles;
create policy "Anyone can view profiles" on public.profiles
  for select using (true);
drop policy if exists "Anyone can create a profile" on public.profiles;
create policy "Anyone can create a profile" on public.profiles
  for insert with check (true);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Users can delete their own profile" on public.profiles;
create policy "Users can delete their own profile" on public.profiles
  for delete using (auth.uid() = id);


-- ── teams ───────────────────────────────────────────────────────────────
-- Teams are public by design: the whole point of TeamsPanel and the Transfer
-- Market is browsing teams you are not in, including signed out.
alter table public.teams enable row level security;
drop policy if exists "Anyone can view teams" on public.teams;
create policy "Anyone can view teams" on public.teams
  for select using (true);
drop policy if exists "Anyone can manage teams" on public.teams;
create policy "Anyone can manage teams" on public.teams
  for all using (true) with check (true);


-- ── team_members ────────────────────────────────────────────────────────
-- Squad membership drives RoleContext, so it has to be readable before the
-- app knows who you are.
alter table public.team_members enable row level security;
drop policy if exists "Anyone can view team members" on public.team_members;
create policy "Anyone can view team members" on public.team_members
  for select using (true);
drop policy if exists "Anyone can manage team members" on public.team_members;
create policy "Anyone can manage team members" on public.team_members
  for all using (true) with check (true);


-- ── match_posts ─────────────────────────────────────────────────────────
-- The discovery feed on Home renders for signed-out visitors behind the
-- landing hero, so SELECT cannot require a session.
alter table public.match_posts enable row level security;
drop policy if exists "Anyone can view match posts" on public.match_posts;
create policy "Anyone can view match posts" on public.match_posts
  for select using (true);
drop policy if exists "Anyone can manage match posts" on public.match_posts;
create policy "Anyone can manage match posts" on public.match_posts
  for all using (true) with check (true);


-- ── challenges ──────────────────────────────────────────────────────────
alter table public.challenges enable row level security;
drop policy if exists "Anyone can view challenges" on public.challenges;
create policy "Anyone can view challenges" on public.challenges
  for select using (true);
drop policy if exists "Anyone can manage challenges" on public.challenges;
create policy "Anyone can manage challenges" on public.challenges
  for all using (true) with check (true);


-- ── matches ─────────────────────────────────────────────────────────────
-- Carries roster_locked_at / settled_at, which the settlement run in
-- /api/settle-match reads and writes server-side (service role bypasses RLS).
alter table public.matches enable row level security;
drop policy if exists "Anyone can view matches" on public.matches;
create policy "Anyone can view matches" on public.matches
  for select using (true);
drop policy if exists "Anyone can manage matches" on public.matches;
create policy "Anyone can manage matches" on public.matches
  for all using (true) with check (true);


-- ── match_confirmations ─────────────────────────────────────────────────
-- is_ringer lives here and decides who is excluded from settlement.
alter table public.match_confirmations enable row level security;
drop policy if exists "Anyone can view match confirmations" on public.match_confirmations;
create policy "Anyone can view match confirmations" on public.match_confirmations
  for select using (true);
drop policy if exists "Anyone can manage match confirmations" on public.match_confirmations;
create policy "Anyone can manage match confirmations" on public.match_confirmations
  for all using (true) with check (true);


-- ── availability_requests / availability_responses ──────────────────────
-- Written from the client (upsert on respond) and deleted from
-- app/api/availability/delete, which runs on adminSupabase — that falls back
-- to the anon key when SUPABASE_SERVICE_ROLE_KEY is not set, so the delete has
-- to pass under anon too.
alter table public.availability_requests enable row level security;
drop policy if exists "Anyone can view availability requests" on public.availability_requests;
create policy "Anyone can view availability requests" on public.availability_requests
  for select using (true);
drop policy if exists "Anyone can manage availability requests" on public.availability_requests;
create policy "Anyone can manage availability requests" on public.availability_requests
  for all using (true) with check (true);

alter table public.availability_responses enable row level security;
drop policy if exists "Anyone can view availability responses" on public.availability_responses;
create policy "Anyone can view availability responses" on public.availability_responses
  for select using (true);
drop policy if exists "Anyone can manage availability responses" on public.availability_responses;
create policy "Anyone can manage availability responses" on public.availability_responses
  for all using (true) with check (true);


-- ════════════════════════════════════════════════════════════════════════
-- Verify
-- ════════════════════════════════════════════════════════════════════════
-- Lists every public table with RLS still off. Should return zero rows; any
-- row is a table created outside the migration files and missed here.
--
--   select tablename
--     from pg_tables
--    where schemaname = 'public'
--      and not rowsecurity
--    order by tablename;
--
-- And to see the policies this file installed:
--
--   select tablename, policyname, cmd
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('profiles','teams','team_members','match_posts',
--                        'challenges','matches','match_confirmations',
--                        'availability_requests','availability_responses')
--    order by tablename, policyname;


-- ════════════════════════════════════════════════════════════════════════
-- What this does NOT fix
-- ════════════════════════════════════════════════════════════════════════
-- The Supabase warning is now answered, but only in the sense that access is
-- deliberate rather than accidental. `using (true)` means the anon key still
-- reads and writes these tables, and that key is public by construction.
--
-- Real policies would need, at minimum:
--   • team_members / teams  — writes restricted to the team's captain
--     (teams.captain_id = auth.uid()), reads left public.
--   • match_posts / challenges / matches  — writes restricted to a captain of
--     one of the teams involved.
--   • match_confirmations  — a player writes only their own row; the captain
--     writes any row on their own team's match.
--   • availability_responses  — a player writes only their own response.
--
-- Each of those needs a helper like `is_captain_of(team_id)` marked
-- `security definer` to avoid recursive policy evaluation when a policy on
-- team_members has to read team_members. That is a schema-wide change — the
-- other ~30 tables are permissive on the same assumption — and it wants doing
-- as one deliberate pass with the app exercised end to end, not table by
-- table. Until then: treat the database as readable by anyone who loads the
-- site, and keep anything genuinely secret (Stripe secret key, service-role
-- key) server-side only, which is where it is today.
