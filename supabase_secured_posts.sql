-- ════════════════════════════════════════════════════════════════════════
-- Secured-pitch match posts — created from a direct /book booking via
-- "My Bookings → Turn into Match Post". The pitch is already paid for by
-- whoever booked it, so these posts skip the team-credit hold/capture flow
-- entirely (payment_mode = 'secured') and surface with priority in Play.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

alter table public.match_posts
  add column if not exists pitch_secured boolean not null default false,
  add column if not exists secured_booking_id uuid references public.pitch_bookings(id);
