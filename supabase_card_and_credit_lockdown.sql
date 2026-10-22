-- ════════════════════════════════════════════════════════════════════════
-- UNITER — Saved cards and team credit lock-down
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- ⚠ Deploy the app first. The web (and the phone, once `main` is merged into
-- `mobile`) must be saving cards through /api/payment-method and
-- /api/payment-intent-method before §1 runs, or "Save this card" stops
-- working for anyone still on the old code.
--
-- Run after supabase_pilot_security.sql (uniter_trusted_writer),
-- supabase_card_on_file.sql, supabase_co_captains.sql and
-- supabase_team_tournaments.sql.
--
-- Closes two ways to take money that isn't yours, both reachable with nothing
-- but the public anon key and a browser console — no route involved:
--
--   §1  Anyone could charge a stranger's saved card. profiles is readable by
--       everyone, card columns included, and a player may update their own
--       row — so they could copy someone else's stripe_customer_id +
--       stripe_payment_method_id onto it. /api/settle-match and
--       /api/book/pitch (saved_card) charge whatever pair is on the caller's
--       profile, off-session, and Stripe accepts it: the card really is
--       attached to that customer.
--
--   §2  Team credit could be created with no money behind it. Credit is a
--       team's share of the money Uniter holds, and spending it makes Uniter
--       pay a venue for real (lib/venue-payout.ts) or refund a card
--       (/api/credit/refund). Two functions added to a balance on nobody's
--       payment: record_cash_credit (any amount, no evidence, any leader) and
--       reimburse_team (never revoked — callable by ANYONE, any team, any
--       amount). No screen uses either from the browser: Payment Status'
--       "Mark paid" is bookkeeping only, and reimburse_team's only caller is
--       /api/tournaments/join on the service role.
--
-- The third hole of that kind — /api/settle-match crediting a share figure
-- from the request body that could exceed the charge — is fixed in the route.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- §1  Card columns on profiles — written by the server only
-- ════════════════════════════════════════════════════════════════════════
-- A client may CLEAR a card (Remove card on /profile and on the phone sets
-- the columns to null), never set one. Setting one is the server's job, after
-- it has checked with Stripe that the card belongs to the caller's customer.
-- Registration inserts the profile before there is a session, so the INSERT
-- branch doesn't lean on one: a client insert simply may not carry a card.
create or replace function public.guard_profile_card_columns()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if public.uniter_trusted_writer() then     -- service role / SQL editor
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.stripe_customer_id is not null or new.stripe_payment_method_id is not null
       or new.card_brand is not null or new.card_last4 is not null then
      raise exception 'Card details are saved by the server';
    end if;
    return new;
  end if;

  if (new.stripe_customer_id is distinct from old.stripe_customer_id and new.stripe_customer_id is not null)
     or (new.stripe_payment_method_id is distinct from old.stripe_payment_method_id and new.stripe_payment_method_id is not null)
     or (new.card_brand is distinct from old.card_brand and new.card_brand is not null)
     or (new.card_last4 is distinct from old.card_last4 and new.card_last4 is not null) then
    raise exception 'Card details are saved by the server';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_guard_profile_card_columns on public.profiles;
create trigger trg_guard_profile_card_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_card_columns();


-- ════════════════════════════════════════════════════════════════════════
-- §2  Credit is created only where money arrives
-- ════════════════════════════════════════════════════════════════════════
-- reimburse_team: service role only (/api/tournaments/join).
revoke execute on function public.reimburse_team(uuid, integer, uuid) from public, anon, authenticated;
grant  execute on function public.reimburse_team(uuid, integer, uuid) to service_role;
alter function public.reimburse_team(uuid, integer, uuid) set search_path = public;

-- record_cash_credit: kept for staff, who can still correct a balance from the
-- SQL editor, but no longer callable from a browser. Cash a player hands the
-- captain stays with the captain; it isn't in Uniter's account, so it can't be
-- team credit. To put it in, the captain tops up by card.
revoke execute on function public.record_cash_credit(uuid, integer, uuid) from public, anon, authenticated;
grant  execute on function public.record_cash_credit(uuid, integer, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- Verification
-- ════════════════════════════════════════════════════════════════════════
-- 1. Has anyone already done it? Two profiles sharing a customer or a card
--    means one of them copied the other's — check these by hand in Stripe.
--      select stripe_customer_id, array_agg(id) from public.profiles
--       where stripe_customer_id is not null
--       group by 1 having count(*) > 1;
--      select stripe_payment_method_id, array_agg(id) from public.profiles
--       where stripe_payment_method_id is not null
--       group by 1 having count(*) > 1;
--
-- 2. Credit with no money behind it so far (deposits with no Stripe payment —
--    record_cash_credit's rows, plus reimburse_team rows with no matching
--    buy-in). Review before deciding whether to correct any balance:
--      select team_id, sum(amount_pence) from public.team_credit_transactions
--       where type = 'deposit' and stripe_payment_intent_id is null
--       group by 1 order by 2 desc;
--      select t.team_id, t.amount_pence, t.related_team_id, t.created_at
--        from public.team_credit_transactions t
--       where t.type = 'opponent_settlement' and t.amount_pence > 0
--         and t.match_id is null
--       order by t.created_at desc;
--
-- 3. From a browser console on the live site, signed in, each should now FAIL:
--      await supabase.from('profiles').update({ stripe_customer_id: 'cus_x' }).eq('id', (await supabase.auth.getUser()).data.user.id)
--      await supabase.rpc('record_cash_credit', { p_team_id: crypto.randomUUID(), p_amount_pence: 1, p_player_id: crypto.randomUUID() })
--      await supabase.rpc('reimburse_team', { p_team_id: crypto.randomUUID(), p_amount_pence: 1, p_related_team_id: crypto.randomUUID() })
--    and these should still WORK: saving a card on /profile, ticking "Save
--    this card" while paying, Remove card, entering a team-hosted tournament.


-- ════════════════════════════════════════════════════════════════════════
-- Rollback (only if a legitimate flow broke — this reopens both holes)
-- ════════════════════════════════════════════════════════════════════════
-- drop trigger if exists trg_guard_profile_card_columns on public.profiles;
-- grant execute on function public.record_cash_credit(uuid, integer, uuid) to authenticated;
