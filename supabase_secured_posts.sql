-- ════════════════════════════════════════════════════════════════════════
-- Secured-pitch match posts — created from a direct /book booking (either via
-- "My Bookings → Turn into Match Post", or auto-posted from "lock in a pitch
-- first"). The posting team already paid the pitch fee to the venue in cash,
-- so these posts skip the team-credit hold/capture flow (payment_mode =
-- 'secured') and surface with priority in Play.
--
-- On join, the challenger reimburses their HALF of the pitch fee to the poster
-- via team credit (reimburse_secured_pitch below) — the poster fronted the full
-- fee, so this settles the challenger's share up front. Players still replenish
-- their own team's credit post-match (Phase 3, apply_replenishment).
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

alter table public.match_posts
  add column if not exists pitch_secured boolean not null default false,
  add column if not exists secured_booking_id uuid references public.pitch_bookings(id);


-- On join: challenger reimburses their half of the pitch fee to the poster.
-- The poster fronted the whole fee via a direct booking (paid to the venue in
-- cash), so — unlike split_pitch_fee (debits both) or capture_and_settle
-- (debits the poster from credit) — this is a pure challenger→poster transfer.
-- p_fee_pence = full pitch fee P. Challenger pays floor(P/2); poster receives it
-- (poster keeps the odd-penny benefit, matching split_pitch_fee's division).
create or replace function public.reimburse_secured_pitch(
  p_match_id uuid, p_posting_team uuid, p_challenging_team uuid, p_fee_pence integer
) returns void language plpgsql security definer as $$
declare
  v_half integer := p_fee_pence / 2;   -- integer division = floor = challenger's share
  v_chal_balance integer; v_chal_reserved integer;
  v_first uuid; v_second uuid;
begin
  -- Lock both rows in a stable order to avoid deadlocks.
  v_first  := least(p_posting_team, p_challenging_team);
  v_second := greatest(p_posting_team, p_challenging_team);
  perform 1 from public.team_credits where team_id = v_first  for update;
  perform 1 from public.team_credits where team_id = v_second for update;

  -- Challenger must be able to cover their half.
  select balance_pence, reserved_pence into v_chal_balance, v_chal_reserved
    from public.team_credits where team_id = p_challenging_team;
  if v_chal_balance is null then
    raise exception 'No credit account for challenging team %', p_challenging_team;
  end if;
  if (v_chal_balance - v_chal_reserved) < v_half then
    raise exception 'INSUFFICIENT_CREDIT: challenger available %, need %', (v_chal_balance - v_chal_reserved), v_half;
  end if;

  -- Debit the challenger's half.
  update public.team_credits set balance_pence = balance_pence - v_half, updated_at = now()
    where team_id = p_challenging_team;
  insert into public.team_credit_transactions(team_id, type, amount_pence, match_id, related_team_id)
    values (p_challenging_team, 'opponent_settlement', -v_half, p_match_id, p_posting_team);

  -- Top up the poster — their credit row may not exist yet (they paid by card),
  -- so upsert.
  insert into public.team_credits(team_id, balance_pence) values (p_posting_team, v_half)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + v_half, updated_at = now();
  insert into public.team_credit_transactions(team_id, type, amount_pence, match_id, related_team_id)
    values (p_posting_team, 'opponent_settlement', v_half, p_match_id, p_challenging_team);
end $$;
