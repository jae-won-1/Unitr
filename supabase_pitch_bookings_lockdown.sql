-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Lock down pitch_bookings, pitches and secured match posts
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Run AFTER the web deploy that moves booking onto the server
-- (/api/book/pitch, /api/book/post, the tournament composer and Challenge),
-- and after supabase_pilot_security.sql (uniter_trusted_writer),
-- supabase_co_captains.sql (is_team_leader) and
-- supabase_challenge_lockdown.sql (the match_posts policies rebuilt here).
--
-- What was open (1 Oct 2026):
--   • pitch_bookings — any signed-in user could INSERT a booking as themselves
--     on any pitch, at any price, marked paid; and UPDATE any booking at all
--     (using (true)): cancel someone else's, or change a price the payout and
--     pay-credit routes then trusted.
--   • pitches — INSERT with check (true) and UPDATE using (true): anyone could
--     re-price ANY pitch, and the server routes read their price from there.
--   • match_posts — a team's leaders could write a "secured" post pointing at
--     any booking, and whoever accepted it reimbursed half its price.
--
-- After this file:
--   • pitch_bookings are written by the server, or by the venue that owns the
--     pitch (its calendar, manual bookings, open matches, marking paid).
--     Only the server sets stripe_payment_intent_id or post_id — the first is
--     what lib/secured-booking.ts accepts as proof a booking was paid through
--     Uniter.
--   • pitches are written only by their own venue owner, who can't change
--     the owner, the Connect account, payouts_enabled, is_verified or rating.
--   • a secured post can only be created, or a post made secured, by the
--     server.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. pitch_bookings ───────────────────────────────────────────────────
alter table public.pitch_bookings enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'pitch_bookings'
  loop
    execute format('drop policy %I on public.pitch_bookings', r.policyname);
  end loop;
end $$;

-- Reads stay public: the venue calendar, the Calendar and every availability
-- check read rows the viewer doesn't own.
create policy "Anyone can view bookings" on public.pitch_bookings
  for select using (true);

create or replace function public.uniter_owns_pitch(p_pitch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pitches p where p.id = p_pitch_id and p.venue_owner_id = auth.uid());
$$;
revoke all on function public.uniter_owns_pitch(uuid) from public;
grant execute on function public.uniter_owns_pitch(uuid) to authenticated, anon, service_role;

create policy "Venue owner books their own pitch" on public.pitch_bookings
  for insert with check (booked_by = auth.uid() and public.uniter_owns_pitch(pitch_id));
create policy "Venue owner manages their pitch's bookings" on public.pitch_bookings
  for update using (public.uniter_owns_pitch(pitch_id)) with check (public.uniter_owns_pitch(pitch_id));
create policy "Venue owner deletes their pitch's bookings" on public.pitch_bookings
  for delete using (public.uniter_owns_pitch(pitch_id));

-- Columns only the server writes, whoever the row belongs to.
create or replace function public.guard_pitch_booking_server_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.uniter_trusted_writer() then return new; end if;
  if tg_op = 'INSERT' then
    if new.stripe_payment_intent_id is not null or new.post_id is not null then
      raise exception 'Only Uniter records a booking''s payment or match post' using errcode = '42501';
    end if;
  elsif new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
     or new.post_id is distinct from old.post_id
     or new.pitch_id is distinct from old.pitch_id
     or new.booked_by is distinct from old.booked_by then
    raise exception 'Only Uniter changes who made a booking, its pitch, payment or match post' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_pitch_booking_server_columns on public.pitch_bookings;
create trigger guard_pitch_booking_server_columns
  before insert or update on public.pitch_bookings
  for each row execute function public.guard_pitch_booking_server_columns();


-- ── 2. pitches ──────────────────────────────────────────────────────────
alter table public.pitches enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'pitches'
  loop
    execute format('drop policy %I on public.pitches', r.policyname);
  end loop;
end $$;

create policy "Anyone can view pitches" on public.pitches
  for select using (true);
-- /pitches/register and the venue portal both write venue_owner_id = you.
create policy "Owners register their own pitches" on public.pitches
  for insert with check (venue_owner_id = auth.uid());
create policy "Owners update their own pitches" on public.pitches
  for update using (venue_owner_id = auth.uid()) with check (venue_owner_id = auth.uid());
create policy "Owners delete their own pitches" on public.pitches
  for delete using (venue_owner_id = auth.uid());

-- Columns a venue can't set on its own pitch. Compared as jsonb so a database
-- missing one of them (payouts_enabled is added by a later migration) still
-- accepts writes rather than failing on an unknown column.
create or replace function public.guard_pitch_server_columns()
returns trigger language plpgsql set search_path = public as $$
declare
  col text;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if public.uniter_trusted_writer() then return new; end if;
  if tg_op = 'INSERT' then
    -- A new pitch starts unverified, unrated and without payouts, whatever
    -- the request (or a column default on this database) said.
    n := n || coalesce((
      select jsonb_object_agg(k, v)
        from (values ('is_verified', 'false'::jsonb), ('payouts_enabled', 'false'::jsonb),
                     ('stripe_account_id', 'null'::jsonb), ('rating', '0'::jsonb)) as x(k, v)
       where n ? k), '{}'::jsonb);
    return jsonb_populate_record(new, n);
  end if;
  foreach col in array array['venue_owner_id', 'stripe_account_id', 'payouts_enabled', 'is_verified', 'rating'] loop
    if (n -> col) is distinct from (o -> col) then
      raise exception 'Only Uniter changes a pitch''s %', col using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists guard_pitch_server_columns on public.pitches;
create trigger guard_pitch_server_columns
  before insert or update on public.pitches
  for each row execute function public.guard_pitch_server_columns();


-- ── 3. match_posts: secured posts are the server's ──────────────────────
drop policy if exists "Team leaders insert their posts" on public.match_posts;
create policy "Team leaders insert their posts" on public.match_posts
  for insert with check (
    public.is_team_leader(team_id, auth.uid())
    and coalesce(payment_mode, '') <> 'secured'
    and not coalesce(pitch_secured, false)
    and secured_booking_id is null
  );

create or replace function public.guard_match_post_secured()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.uniter_trusted_writer() then return new; end if;
  if new.payment_mode is distinct from old.payment_mode
     or new.pitch_secured is distinct from old.pitch_secured
     or new.secured_booking_id is distinct from old.secured_booking_id then
    raise exception 'Only Uniter makes a match post secured' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_match_post_secured on public.match_posts;
create trigger guard_match_post_secured
  before update on public.match_posts
  for each row execute function public.guard_match_post_secured();


-- ── Check afterwards ────────────────────────────────────────────────────
-- From a browser console on the live site, signed in as an ordinary player,
-- each of these should fail (an error, or 0 rows changed):
--   await supabase.from('pitch_bookings').insert({ pitch_id: '<a real pitch id>',
--     booked_by: (await supabase.auth.getUser()).data.user.id, match_date: '2026-12-01',
--     start_time: '18:00', end_time: '19:00', total_price_pence: 1, status: 'confirmed',
--     payment_status: 'paid' })
--   await supabase.from('pitch_bookings').update({ status: 'cancelled' }).eq('id', '<someone else''s booking>').select()
--   await supabase.from('pitches').update({ price_per_hour: 0.01 }).eq('id', '<a real pitch id>').select()
-- and, on the web: Book a Pitch, Challenge, host a tournament, the venue
-- calendar's manual booking and "Turn into Match Post" should all still work.
