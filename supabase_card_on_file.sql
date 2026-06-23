-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Card-on-file + roster-lock settlement migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Implements PAYMENT_PLAN.md §10:
--   • Players save a card at registration/profile (Stripe SetupIntent) →
--     stripe_customer_id + stripe_payment_method_id stored on the profile.
--   • A match secures the pitch with team credit at confirm (roster still fluid).
--   • At roster-lock the captain freezes the squad; each actual participant's
--     saved card is charged off-session, refilling the team's credit.
--
-- Money is in PENCE everywhere.
-- ════════════════════════════════════════════════════════════════════════


-- ── profiles: saved card (card-on-file) ─────────────────────────────────
alter table public.profiles
  add column if not exists stripe_customer_id       text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists card_brand               text,
  add column if not exists card_last4               text;


-- ── matches: roster-lock + settlement state ─────────────────────────────
alter table public.matches
  add column if not exists roster_locked_at timestamptz,  -- when a team froze its squad
  add column if not exists settled_at       timestamptz;  -- when settlement last ran


-- ── player_payments: record off-session charge outcomes ─────────────────
-- (purpose / team_id / applied / stripe_payment_intent_id / paid_at already
--  exist from supabase_credit_ledger.sql; add failure tracking + a flag for
--  charges that were taken automatically off a saved card.)
alter table public.player_payments
  add column if not exists failure_reason text,
  add column if not exists off_session    boolean not null default false;


-- ════════════════════════════════════════════════════════════════════════
-- Notes
-- ════════════════════════════════════════════════════════════════════════
-- • Settlement charges happen server-side in /api/settle-match (off_session,
--   confirm:true). On success the client writes a paid player_payments row and
--   calls apply_replenishment(id) (from supabase_credit_ledger.sql) to refill
--   the team's credit. Declines are stored status='failed' + failure_reason and
--   fall back to the manual /pay screen.
-- • status values used: 'pending' | 'paid' | 'failed'.
