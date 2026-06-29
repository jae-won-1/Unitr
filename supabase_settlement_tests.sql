-- ════════════════════════════════════════════════════════════════════════
-- UNITR — Settlement RPC tests (in-app CREDIT movement only)
-- Run in the Supabase SQL editor AFTER supabase_credit_ledger.sql.
--
-- Verifies the two match-settlement mechanics the product needs:
--   A) split_pitch_fee     — each team's credit is debited its OWN half,
--                            simultaneously, with no transfer between them.
--   B) capture_and_settle  — poster fronts the full fee; challenger sends
--                            its half into the poster's credit.
--
-- Uses two EXISTING teams (avoids NOT NULL columns on `teams`) and runs the
-- whole thing inside ONE transaction that ROLLS BACK at the end — so real
-- team balances are restored and no test rows are left behind. Watch the
-- RAISE NOTICE output and the final result set; every check raises on failure.
-- Money is in PENCE. Test fee P = 8000 (£80).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ── Pick two existing teams and pre-load each with £100 credit ────────────
-- Held in a temp table so every DO block / query below shares the same ids.
create temp table __test_cfg on commit drop as
  select
    (array_agg(id order by id))[1] as post_team,
    (array_agg(id order by id))[2] as chal_team
  from (select id from public.teams limit 2) t;

do $$
declare v_post uuid; v_chal uuid;
begin
  select post_team, chal_team into v_post, v_chal from __test_cfg;
  if v_post is null or v_chal is null then
    raise exception 'Need at least 2 teams in public.teams to run these tests';
  end if;

  insert into public.team_credits (team_id, balance_pence, reserved_pence)
    values (v_post, 10000, 0), (v_chal, 10000, 0)
    on conflict (team_id) do update set balance_pence = 10000, reserved_pence = 0;
end $$;


-- ════════════════════════════════════════════════════════════════════════
-- TEST A — split_pitch_fee: each team debited its own half, simultaneously
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v_post uuid; v_chal uuid;
  v_match uuid := '33333333-3333-3333-3333-333333333333';
  v_fee integer := 8000;            -- £80
  v_post_bal integer; v_chal_bal integer;
  v_post_half integer := ceil(8000 / 2.0);   -- 4000 (poster absorbs odd penny)
  v_chal_half integer := 8000 - ceil(8000 / 2.0);  -- 4000
begin
  select post_team, chal_team into v_post, v_chal from __test_cfg;

  perform public.split_pitch_fee(v_match, v_post, v_chal, v_fee);

  select balance_pence into v_post_bal from public.team_credits where team_id = v_post;
  select balance_pence into v_chal_bal from public.team_credits where team_id = v_chal;

  -- Each team down exactly its own half — no money crossed between them.
  if v_post_bal <> 10000 - v_post_half then
    raise exception 'TEST A FAIL: poster balance % expected %', v_post_bal, 10000 - v_post_half;
  end if;
  if v_chal_bal <> 10000 - v_chal_half then
    raise exception 'TEST A FAIL: challenger balance % expected %', v_chal_bal, 10000 - v_chal_half;
  end if;

  -- Ledger: exactly one booking_capture debit per team for this match.
  if (select coalesce(sum(amount_pence), 0) from public.team_credit_transactions
        where match_id = v_match and team_id = v_post and type = 'booking_capture') <> -v_post_half then
    raise exception 'TEST A FAIL: poster ledger row wrong';
  end if;
  if (select coalesce(sum(amount_pence), 0) from public.team_credit_transactions
        where match_id = v_match and team_id = v_chal and type = 'booking_capture') <> -v_chal_half then
    raise exception 'TEST A FAIL: challenger ledger row wrong';
  end if;

  raise notice 'TEST A PASS — split_pitch_fee: poster % (-%), challenger % (-%), total moved out %',
    v_post_bal, v_post_half, v_chal_bal, v_chal_half, v_post_half + v_chal_half;
end $$;


-- ════════════════════════════════════════════════════════════════════════
-- TEST B — capture_and_settle: poster fronts full fee, challenger reimburses half
-- (reset balances first so the two tests don't interfere)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v_post uuid; v_chal uuid;
  v_match uuid := '44444444-4444-4444-4444-444444444444';
  v_fee integer := 8000;
  v_half integer := 8000 / 2;       -- 4000 (integer; odd remainder stays with poster)
  v_post_bal integer; v_chal_bal integer;
begin
  select post_team, chal_team into v_post, v_chal from __test_cfg;

  update public.team_credits set balance_pence = 10000, reserved_pence = 0
    where team_id in (v_post, v_chal);

  perform public.capture_and_settle(v_match, v_post, v_chal, v_fee);

  select balance_pence into v_post_bal from public.team_credits where team_id = v_post;
  select balance_pence into v_chal_bal from public.team_credits where team_id = v_chal;

  -- Net effect must match split (each ends ~half down), but via front+reimburse:
  --   poster: -P (capture) +half (reimbursement) = -half
  --   challenger: -half (reimbursement)
  if v_post_bal <> 10000 - (v_fee - v_half) then
    raise exception 'TEST B FAIL: poster net balance % expected %', v_post_bal, 10000 - (v_fee - v_half);
  end if;
  if v_chal_bal <> 10000 - v_half then
    raise exception 'TEST B FAIL: challenger balance % expected %', v_chal_bal, 10000 - v_half;
  end if;

  -- Challenger's half must land as an opponent_settlement credit on the poster.
  if (select coalesce(sum(amount_pence), 0) from public.team_credit_transactions
        where match_id = v_match and team_id = v_post and type = 'opponent_settlement') <> v_half then
    raise exception 'TEST B FAIL: poster did not receive challenger half';
  end if;
  if (select coalesce(sum(amount_pence), 0) from public.team_credit_transactions
        where match_id = v_match and team_id = v_chal and type = 'opponent_settlement') <> -v_half then
    raise exception 'TEST B FAIL: challenger settlement row wrong';
  end if;

  raise notice 'TEST B PASS — capture_and_settle: poster % (net -%), challenger % (-%), half transferred %',
    v_post_bal, v_fee - v_half, v_chal_bal, v_half, v_half;
end $$;


-- ── Inspect the resulting ledger rows for both tests, then undo everything ──
select
  case when ct.team_id = cfg.post_team then 'Posters' else 'Challengers' end as team,
  ct.type, ct.amount_pence, ct.match_id
from public.team_credit_transactions ct, __test_cfg cfg
where ct.match_id in (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
)
order by ct.match_id, ct.team_id, ct.id;

rollback;   -- restores all balances; temp table is dropped on rollback
