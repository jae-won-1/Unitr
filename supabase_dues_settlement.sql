-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Dues Settlement migration
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Lets a player's team-credit top-up pay down their own outstanding match
-- fees (set up via the captain's "Collect Payment" flow), partially or in
-- full, instead of only being all-or-nothing via the captain's toggle.
-- ════════════════════════════════════════════════════════════════════════

alter table public.payment_collection_status
  add column if not exists credited_pence integer not null default 0;

-- Backfill: rows already marked received (e.g. via the captain's manual
-- toggle, before this column existed) should count as fully credited too,
-- so the player's "amount owed" total doesn't still count them.
update public.payment_collection_status
  set credited_pence = share_pence
  where received = true and credited_pence < share_pence;
