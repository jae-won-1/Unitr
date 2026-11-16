-- Linked finance: let a team exempt its captain from the joining fee.
--
-- The joining fee is asked of the whole squad, captain included, because the
-- captain plays in the games it pays for. Some teams don't charge whoever runs
-- the team; this flag records that choice on the team's one joining-fee
-- request. With it set, /api/finance/requests leaves the captain off the
-- request — and keeps them off when the fee is changed — instead of adding
-- them back every time it is saved.
--
-- It names the captain as a role, not a person: after a hand-over, the next
-- save of the fee exempts the new captain and asks the old one, now a member.
--
-- Additive and idempotent. Run after supabase_team_finance.sql. Without it the
-- app still works; the exemption switch is simply refused when saved.

alter table public.payment_requests
  add column if not exists captain_exempt boolean not null default false;
