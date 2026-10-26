-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Security fixes before the store launch (docs/LAUNCH_PLAN.md item 4)
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run after supabase_core_tables_rls.sql, supabase_pilot_security.sql,
-- supabase_co_captains.sql, supabase_payment_integrity.sql,
-- supabase_refunds.sql, supabase_team_chat.sql and supabase_transfer_market.sql.
--
-- ORDER MATTERS. §3 makes the card columns on profiles unreadable from a
-- browser or phone. Web and phone code that reads them through
-- my_saved_card() (lib/own-card.ts) must be DEPLOYED, and the phone's OTA
-- update installed, before this runs — an older phone build asks for those
-- columns directly and would stop seeing its saved card.
--
-- Three holes, all reachable with the public anon key:
--   1. team_members was `for all using (true)`: anyone could add themselves
--      to any squad as approved, or delete someone else's membership.
--   2. The credit ledger, team balances and per-card contributions were
--      readable by anyone — every team's money, and which player paid what.
--   3. profiles is world-readable (the Transfer Market lists players), and
--      every player's card brand, last four digits and Stripe ids were on it.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. team_members: who may write a membership ─────────────────────────
-- Reads stay public: RoleContext, squads and the Transfer Market need them.
-- Writes, matched to the flows that exist:
--   • a player asks to join            → inserts their OWN row, pending
--   • a player accepts a team's offer  → upserts their OWN row, approved,
--                                         only while that offer is pending
--   • a leader approves / rejects      → updates any row of their team
--   • a player leaves / withdraws      → deletes their OWN row
--   • a leader removes someone         → deletes a row of their team
-- The invite link and the handover are security definer functions and the
-- server uses the service key, so neither is affected. The money columns and
-- the co-captain flag keep their own triggers on top of this.

create or replace function public.has_pending_offer(p_team_id uuid, p_player_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.player_offers o
     where o.team_id = p_team_id and o.player_id = p_player_id and o.status = 'pending'
  );
$fn$;
grant execute on function public.has_pending_offer(uuid, uuid) to authenticated, service_role;

drop policy if exists "Anyone can manage team members"            on public.team_members;
drop policy if exists "Players ask to join or take an offer"       on public.team_members;
drop policy if exists "Leaders decide, players re-ask"             on public.team_members;
drop policy if exists "Players leave, leaders remove"              on public.team_members;

create policy "Players ask to join or take an offer" on public.team_members
  for insert with check (
    auth.uid() = player_id
    and (coalesce(status, 'pending') = 'pending'
         or (status = 'approved' and public.has_pending_offer(team_id, player_id)))
  );

create policy "Leaders decide, players re-ask" on public.team_members
  for update
  using (public.uniter_leads_team(team_id, auth.uid()) or auth.uid() = player_id)
  with check (
    public.uniter_leads_team(team_id, auth.uid())
    or (auth.uid() = player_id
        and (status = 'pending'
             or (status = 'approved' and public.has_pending_offer(team_id, player_id))))
  );

create policy "Players leave, leaders remove" on public.team_members
  for delete using (auth.uid() = player_id or public.uniter_leads_team(team_id, auth.uid()));


-- ── 2. Team money is readable by the team ───────────────────────────────
-- A balance or ledger row is visible to that team's squad (captain included),
-- to admins, and — for the ledger only — to the venue whose pitch the row
-- paid for (lib/venue-payments.ts marks bookings paid from it). The server
-- reads with the service key and is unaffected.

create or replace function public.uniter_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles p where p.id = p_user_id and p.account_type = 'admin');
$fn$;
grant execute on function public.uniter_is_admin(uuid) to authenticated, service_role;

-- The venue that owns the pitch a ledger row paid for: a direct booking
-- (booking_id), or a match whose post was booked there (match_id).
create or replace function public.uniter_venue_of_ledger_row(
  p_booking_id uuid, p_match_id uuid, p_user_id uuid
) returns boolean language sql stable security definer set search_path = public as $fn$
  select p_user_id is not null and (
    exists (select 1 from public.pitch_bookings b
              join public.pitches p on p.id = b.pitch_id
             where b.id = p_booking_id and p.venue_owner_id = p_user_id)
    or exists (select 1 from public.matches m
                 join public.pitch_bookings b on b.post_id = m.post_id
                 join public.pitches p on p.id = b.pitch_id
                where m.id = p_match_id and p.venue_owner_id = p_user_id)
  );
$fn$;
grant execute on function public.uniter_venue_of_ledger_row(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists "Anyone can view team credits"     on public.team_credits;
drop policy if exists "The team can view its credit"     on public.team_credits;
create policy "The team can view its credit" on public.team_credits
  for select using (
    public.is_team_squad_member(team_id, auth.uid()) or public.uniter_is_admin(auth.uid())
  );

drop policy if exists "Anyone can view credit tx"         on public.team_credit_transactions;
drop policy if exists "The team can view its ledger"      on public.team_credit_transactions;
create policy "The team can view its ledger" on public.team_credit_transactions
  for select using (
    public.is_team_squad_member(team_id, auth.uid())
    or public.uniter_is_admin(auth.uid())
    or public.uniter_venue_of_ledger_row(booking_id, match_id, auth.uid())
  );

-- A view runs as its owner, past the ledger's row security, so the policy
-- above doesn't cover it. Only the refund route reads it, with the service key.
revoke all on public.team_card_contributions from anon, authenticated;
grant select on public.team_card_contributions to service_role;


-- ── 3. Card details on profiles are the owner's alone ───────────────────
-- Row security can't hide columns, so this uses column privileges: a browser
-- or phone may read every profile column EXCEPT the four below, for anyone's
-- row. Its own card comes from my_saved_card(). The server (service key) and
-- the trigger-guarded client writes that clear a card are unaffected — UPDATE
-- privileges are not touched here.
--
-- Computed from the live column list, so it grants whatever profiles has
-- today. A migration that ADDS a profile column must re-run this section, or
-- clients can't read the new column (CLAUDE.md, Data model).
do $do$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name not in ('stripe_customer_id', 'stripe_payment_method_id', 'card_brand', 'card_last4');
  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to anon, authenticated', v_cols);
end $do$;

create or replace function public.my_saved_card()
returns table (
  stripe_customer_id text,
  stripe_payment_method_id text,
  card_brand text,
  card_last4 text
) language sql stable security definer set search_path = public as $fn$
  select p.stripe_customer_id::text, p.stripe_payment_method_id::text,
         p.card_brand::text, p.card_last4::text
    from public.profiles p
   where p.id = auth.uid();
$fn$;
revoke all on function public.my_saved_card() from public, anon;
grant execute on function public.my_saved_card() to authenticated, service_role;


-- ── 4. Rate limits on the routes that open payments ─────────────────────
-- Serverless functions keep no memory between requests, so the counter lives
-- here. lib/rate-limit.ts asks hit_rate_limit(key, window, max) before a route
-- creates a PaymentIntent, SetupIntent or off-session charge: true means go
-- ahead, false means the caller has made `max` such requests within the last
-- `window` seconds. One row per key per window, so the table stays small; old
-- windows are swept as new ones are opened.
create table if not exists public.api_rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key, window_start)
);
alter table public.api_rate_limits enable row level security;   -- no policies: server only

create or replace function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  integer;
begin
  insert into public.api_rate_limits(key, window_start, hits) values (p_key, v_start, 1)
    on conflict (key, window_start) do update set hits = api_rate_limits.hits + 1
    returning hits into v_hits;
  delete from public.api_rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_max;
end $fn$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant  execute on function public.hit_rate_limit(text, integer, integer) to service_role;


-- ── Verify ──────────────────────────────────────────────────────────────
-- As a signed-in player in the app: your squad, balance and saved card still
-- show; the Transfer Market still lists players. Then, in the SQL editor:
--   select grantee, column_name from information_schema.column_privileges
--    where table_name = 'profiles' and privilege_type = 'SELECT'
--      and grantee = 'authenticated' order by column_name;
--   -- the four card columns must be missing from that list
