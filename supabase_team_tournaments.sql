-- Team-hosted tournaments: a captain books & pays for a pitch upfront from team
-- credit, then posts a tournament other teams buy into. Each buy-in reimburses
-- the organiser team's credit (instead of paying a venue, as with venue-hosted
-- tournaments). Run in the Supabase SQL editor. Idempotent - safe to re-run.

-- 1. Tag open_matches with the organising team (null = venue-hosted, as before).
alter table public.open_matches
  add column if not exists organiser_team_id uuid references public.teams(id),
  add column if not exists organiser_team_name text;

-- 2. Reimburse the organiser team's credit when a team buys into their
--    tournament. Logged as 'opponent_settlement' (+ve, with related_team_id)
--    so it surfaces in the My Team credit log "Reimbursed" tab, same as a
--    secured-post reimbursement. Atomic increment; creates the credit row if
--    the organiser somehow has none yet.
create or replace function public.reimburse_team(
  p_team_id uuid, p_amount_pence integer, p_related_team_id uuid
) returns void language plpgsql security definer as $$
begin
  insert into public.team_credits(team_id, balance_pence) values (p_team_id, p_amount_pence)
    on conflict (team_id) do update
      set balance_pence = public.team_credits.balance_pence + p_amount_pence, updated_at = now();

  insert into public.team_credit_transactions(team_id, type, amount_pence, related_team_id)
    values (p_team_id, 'opponent_settlement', p_amount_pence, p_related_team_id);
end $$;
