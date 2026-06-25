-- ════════════════════════════════════════════════════════════════════════
-- TESTING ONLY — give every registered team £100 (10000 pence) of credit.
-- Safe to re-run: sets balance_pence to exactly 10000 and clears any
-- in-flight reservation so the full £100 is available immediately.
-- ════════════════════════════════════════════════════════════════════════

insert into public.team_credits (team_id, balance_pence, reserved_pence)
select id, 10000, 0 from public.teams
on conflict (team_id) do update
  set balance_pence = 10000,
      reserved_pence = 0,
      updated_at = now();
