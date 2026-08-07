-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Venue payment sync
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- `pitch_bookings.payment_status` is only ever written when the row is created,
-- so everything that pays for a pitch AFTERWARDS left the venue portal showing
-- "Unpaid" forever:
--   • a match being confirmed  → split_pitch_fee debits both teams' credit
--   • a tournament filling up  → each team's buy-in leaves its credit on join
--   • a secured pitch          → paid upfront, then converted to a match post
--
-- The portal now reconstructs the truth on read (lib/venue-payments.ts). This
-- file makes the stored column agree, so exports, Reports and anything else
-- reading payment_status directly see the same thing.
-- ════════════════════════════════════════════════════════════════════════

-- ── Columns the portal relies on ─────────────────────────────────────────
-- These were added by hand as the venue portal grew; pin them down here so a
-- fresh database matches a long-lived one.
alter table public.pitch_bookings
  add column if not exists booking_type   text not null default 'platform',  -- 'platform' | 'manual' | 'open_match'
  add column if not exists payment_status text not null default 'unpaid',    -- 'unpaid' | 'reception' | 'after_match' | 'paid'
  add column if not exists booker_name    text,
  add column if not exists end_time       text,
  add column if not exists notes          text;

-- The credit ledger gained these later than match_id; a direct booking and a
-- tournament buy-in have no match to hang off.
alter table public.team_credit_transactions
  add column if not exists booking_id     uuid references public.pitch_bookings(id),
  add column if not exists open_match_id  uuid references public.open_matches(id);

create index if not exists team_credit_transactions_booking_idx
  on public.team_credit_transactions(booking_id);


-- ── Backfill: a booking is paid if the money actually moved ──────────────
-- Each clause is independent evidence; any one of them is enough.

-- 1. A card charge against the booking. 'replenish' rows are players refilling
--    their own team's credit after the fact — that never reaches the venue.
update public.pitch_bookings b set payment_status = 'paid'
where b.payment_status is distinct from 'paid'
  and exists (
    select 1 from public.player_payments p
    where p.booking_id = b.id and p.status = 'paid'
      and coalesce(p.purpose, 'individual') <> 'replenish'
  );

-- 2. A Stripe intent recorded on the booking itself.
update public.pitch_bookings set payment_status = 'paid'
where payment_status is distinct from 'paid' and stripe_payment_intent_id is not null;

-- 3. A completed payout to the venue — Unitr only sends one once it has been paid.
update public.pitch_bookings b set payment_status = 'paid'
where b.payment_status is distinct from 'paid'
  and exists (select 1 from public.venue_transfers t where t.booking_id = b.id and t.status = 'paid');

-- 4. Team credit spent directly on the booking (the /book credit path).
update public.pitch_bookings b set payment_status = 'paid'
where b.payment_status is distinct from 'paid'
  and exists (
    select 1 from public.team_credit_transactions c
    where c.booking_id = b.id and c.type = 'booking_capture'
  );

-- 5. Team credit split between both teams at match confirmation. The booking
--    points at the post; the match points at the same post.
update public.pitch_bookings b set payment_status = 'paid'
where b.payment_status is distinct from 'paid'
  and b.post_id is not null
  and exists (
    select 1
    from public.matches m
    join public.team_credit_transactions c on c.match_id = m.id
    where m.post_id = b.post_id and c.type = 'booking_capture'
  );

-- 6. A listing (tournament / open match) whose spots are all sold. A partly
--    filled one stays as it is — the portal shows it as "part paid" with the
--    entry count, which is more useful than a single flag.
update public.pitch_bookings b set payment_status = 'paid'
where b.payment_status is distinct from 'paid'
  and exists (
    select 1 from public.open_matches om
    where om.booking_id = b.id
      and om.max_teams > 0
      and (select count(*) from public.open_match_teams t where t.open_match_id = om.id) >= om.max_teams
  );
