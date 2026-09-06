-- Admin take-down of Unitr's own hosted events.
--
-- supabase_post_takedown.sql gave staff a way to pull a team's match post off
-- the feed. An admin-hosted event (an open_matches row with organiser_admin_id
-- set — a tournament, league or friendly Unitr put up itself) had no equivalent:
-- once posted, the only way it left the feed was its kickoff passing, and the
-- teams that had already bought in stayed bought in.
--
-- Two things are needed for that, and both are here:
--
--  1. The provenance of the take-down, exactly as match_posts records it. The
--     take-down itself is still the status flip to 'cancelled' — every feed and
--     calendar query already filters that out (GameFeed, lib/tournament-fixtures.ts).
--  2. A way to give the buy-ins back. A team bought in from its credit pot
--     (/api/tournaments/join debits it and writes one negative 'booking_capture'
--     row against the listing), so a cancelled event has to put that same money
--     back into the same pot. add_credit() can't do it: it books the money as a
--     'deposit', which is what a card top-up or recorded cash looks like, and
--     /admin/finance would then read a cancelled event's refunds as fresh money
--     coming in.
--
-- Idempotent — safe to re-run. Run after supabase_admin_hosting.sql.

alter table public.open_matches
  add column if not exists taken_down_by uuid references auth.users(id),
  add column if not exists taken_down_at timestamptz,
  -- What the entered teams are told. Mandatory in /api/events/take-down — an
  -- event vanishing with the money back and no explanation reads as a bug.
  add column if not exists taken_down_reason text;

-- Give one team its buy-in back for one cancelled event.
--
-- Returns the amount actually refunded, in pence: the net of everything the
-- ledger records for this team against this listing, which is what the team
-- really paid (an invitation discount was applied at join and never written
-- back to the listing, so price_per_team_pence is not that number).
--
-- Idempotent by construction: the refund it writes is itself a row against the
-- listing, so a second call nets to zero and returns 0. Taking the same event
-- down twice, or retrying a half-finished take-down, cannot pay a team twice.
create or replace function public.refund_event_buyin(
  p_team_id uuid, p_open_match_id uuid, p_actor_id uuid default null
) returns integer language plpgsql security definer as $$
declare v_owed integer;
begin
  -- Captures are negative, refunds positive: the sum is what is still out.
  select coalesce(-sum(amount_pence), 0) into v_owed
    from public.team_credit_transactions
    where team_id = p_team_id
      and open_match_id = p_open_match_id
      and type in ('booking_capture', 'buyin_refund');

  if v_owed is null or v_owed <= 0 then
    return 0;
  end if;

  insert into public.team_credits(team_id, balance_pence) values (p_team_id, v_owed)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + v_owed, updated_at = now();

  -- Its own type, not 'deposit' and not 'refund': money that never left the
  -- platform going back to the pot it came from. /admin/finance nets these off
  -- the event's revenue; 'refund' there means a card refund out to a player.
  insert into public.team_credit_transactions(team_id, player_id, type, amount_pence, open_match_id)
    values (p_team_id, p_actor_id, 'buyin_refund', v_owed, p_open_match_id);

  return v_owed;
end $$;

-- No RLS change. open_matches writes are `using (true)` like the rest of the
-- prototype, so who may take an event down is decided in code —
-- /api/events/take-down checks isAdmin against the caller's session token and
-- refuses anything that isn't admin-hosted.
