# Unitr — Payment System Restructure: Credit Ledger + Replenish

**Goal:** Use team credit as the *booking mechanism* (fast, reliable, decouples booking
from collecting money) and individual split payment as the *settlement mechanism* (fair —
only players who played pay). Keep a pure individual-split path for Ringers.

**Decision locked in:** Pitch is **held at post time** (Phase 1) and **captured at match
time** (Phase 2). This requires a cancellation → release path if no opponent shows.

---

## 1. Current State (as of this plan)

**Tables**
- `team_credits` (team_id, **balance** — stored in £, float)
- `team_credit_transactions` (team_id, player_id, **amount** — unsigned, deposits only)
- `pitch_bookings` (pitch_id, post_id, booked_by, total_price_pence, per_player_pence,
  unitr_fee_pence, status, booking_type, …)
- `player_payments` (booking_id, player_id, amount_pence, unitr_fee_pence, total_pence,
  status, stripe_payment_intent_id)
- `match_posts → challenges → matches → match_confirmations`
- `open_matches` / `open_match_teams` (venue-hosted games, buy-in per team)

**Current flow**
1. Captain picks `"credit"` | `"individual"` → stored in **localStorage**
   (`unitr_payment_mode`), never persisted to DB.
2. Captain ranks up to 3 pitches → saved as `pitch_options` on the post.
3. Opponent challenges + picks a pitch → `handleConfirm` (app/play/page.tsx:140):
   inserts challenge, inserts `pitch_bookings`, locks post, creates `matches` +
   `match_confirmations`.
4. Players pay individual Stripe split at app/pay/[matchId]/page.tsx.

**Three problems to fix as part of this work**
1. **"Pay with Team Credit" is cosmetic** — `handleConfirm` never deducts `team_credits`.
   Credit only ever goes up (top-ups). The booking happens regardless; real money always
   comes from the individual `/pay` flow.
2. **Unit mismatch (bug)** — `team_credits.balance` is in **pounds**; everything else
   (`pitch_bookings`, `player_payments`, Stripe routes) is in **pence**.
3. **No earmarking, no signed ledger** — `team_credit_transactions` logs only deposits
   with an unsigned amount. Cannot represent a booking, hold, transfer, or refund.

---

## 2. Schema Changes

```sql
-- 1. Fix units + add earmarking
alter table team_credits
  rename column balance to balance_pence;            -- migrate £ → pence (×100)
alter table team_credits
  add column reserved_pence integer not null default 0;
-- available = balance_pence - reserved_pence

-- 2. Turn the log into a real signed ledger
alter table team_credit_transactions
  rename column amount to amount_pence;              -- ×100, now SIGNED (+/-)
alter table team_credit_transactions
  add column type text not null default 'deposit',
  add column match_id uuid references matches(id),
  add column related_team_id uuid references teams(id);
-- type: 'deposit' | 'booking_hold' | 'booking_capture'
--     | 'opponent_settlement' | 'player_replenish' | 'refund'

-- 3. Tag player payments by purpose + destination
alter table player_payments
  add column purpose text not null default 'replenish',  -- 'replenish' | 'ringer_direct'
  add column team_id uuid references teams(id);

-- 4. Persist payment mode on the post (replaces localStorage)
alter table match_posts
  add column payment_mode text not null default 'credit';
```

**Migration note:** `balance_pence` must be back-filled from the old £ values (×100) in
the same migration. Audit any existing `team_credit_transactions.amount` rows similarly.

---

## 3. The Flow (team vs team)

Let `P` = pitch fee in pence.

### Phase 1 — Post (Team 1 secures the pitch)
- Validate `available ≥ P` (`available = balance_pence - reserved_pence`).
  If not → block and prompt top-up, or fall back to `payment_mode='individual'`.
- **Earmark, don't spend:** `reserved_pence += P`; write `booking_hold` tx.
- Create `pitch_bookings` with `status='held'`.
- → Pitch is locked, backed by a credit hold. No money has moved yet.

### Phase 2 — Match (Team 2 joins)
- Validate Team 2 has `P/2` available — earmark it when they open the challenge panel.
- **Capture Team 1's hold:** `balance_pence -= P`, `reserved_pence -= P`
  (`booking_capture` −P). Booking → `status='confirmed'`.
- **Settle opponent half:** `Team2.balance -= P/2`, `Team1.balance += P/2`
  (paired `opponent_settlement` rows, `related_team_id` set).
- Net: each team down `P/2`. ✓
- Create `matches` + `match_confirmations` (as today).

### Phase 3 — Replenish (players pay)
- Generate `player_payments` for every confirmed player on **both** teams:
  `(P/2 ÷ team_players) + 5% Unitr fee`, `purpose='replenish'`, `team_id` set.
- On each Stripe success: pitch-share portion flows **into that player's own team
  credit** (`player_replenish` +share); the 5% goes to Unitr.
- When a team's players have all paid, its credit returns to baseline. ✓
  Only players who actually played paid.

### Money check (nets out)
- Team 1 fronts `P` → −P. Opponent settlement +`P/2` → net −`P/2`.
  Players replenish +`P/2` → back to baseline.
- Team 2: opponent settlement −`P/2`. Players replenish +`P/2` → back to baseline.
- Venue receives `P`. Every credit balance returns to its starting level. ✓

### Ringer path (pure individual split — survives)
- Ringers have no team credit → pay **direct** at join time
  (`purpose='ringer_direct'`, discounted rate). Nothing routes through credit.
  This is why both mechanisms are kept.

---

## 4. Edge Cases

- **Earmarking / concurrency:** `reserved_pence` stops a team with £100 backing two
  simultaneous £80 posts. Enforce `available ≥ amount` at post time AND challenge time.
- **No opponent shows (post cancelled):** release the hold (`reserved_pence -= P`),
  set `pitch_bookings.status='cancelled'`, write `refund`/release tx. No balance change.
- **Match cancelled after capture:** reverse within the venue's refund window — refund
  txs + refund/credit any player replenishments already taken.
- **Player replenishment fails:** match already booked; the team credit buffer absorbs
  the shortfall temporarily (this is the buffer's purpose). Run retry/dunning. Argues for
  keeping the buffer baseline *above* a single pitch fee.
- **Player leaves team / team disbands:** define joining-fee refund rules from credit.
- **Float / safeguarding:** holding players' joining fees is potentially FCA-regulated
  (e-money/safeguarding) in production. Fine for the dummy-data prototype — flag for later.

---

## 5. Architecture: atomic operations via Postgres RPCs

Each phase touches **multiple balance rows across two teams**. With RLS currently loose
and updates done client-side, browser-side multi-step updates will race (double-spend,
half-applied settlements). Move the three critical operations into **`security definer`
RPCs** so each is atomic; the client calls one RPC:

- `hold_credit(team_id, amount_pence, post_id)` — Phase 1
- `capture_and_settle(match_id, posting_team, challenging_team, P)` — Phase 2
- `apply_replenishment(player_payment_id)` — Phase 3 (on Stripe success)

This is the part of payments genuinely worth doing properly even in a prototype.

---

## 6. Code Touchpoints

| File | Change |
|---|---|
| `supabase_credit_ledger.sql` (new) | schema migration + the 3 RPCs |
| `app/play/create/page.tsx` + pitch select (`app/pitches/page.tsx`) | persist `payment_mode` to the post; call `hold_credit` on post; show available vs reserved |
| `app/play/page.tsx:140` `handleConfirm` | replace "insert booking, no money" with `capture_and_settle` + generate replenish `player_payments` |
| `app/pay/[matchId]/page.tsx` | reframe as "replenish team credit"; call `apply_replenishment` on success; branch Ringer → `ringer_direct` |
| `app/my-team/page.tsx` `TeamCreditsBar` | show available vs reserved; booking log reads new tx types; top-up writes pence |
| `lib/stripe.ts` `calcSplit` | reuse for replenish share; ensure pence throughout |

---

## 7. Suggested Build Order

1. `supabase_credit_ledger.sql` — migration (units fix + new columns) + 3 RPCs. Run in
   Supabase SQL editor, verify balances back-filled correctly.
2. Persist `payment_mode` on the post; wire `hold_credit` into the post/pitch-select flow.
3. Rewrite `handleConfirm` to `capture_and_settle` + generate replenish payments.
4. Generalize `/pay` to replenishment + add the Ringer direct branch.
5. Update `TeamCreditsBar` (available/reserved, new tx log types).
6. Cancellation/refund paths (post cancel release, match cancel reversal).

---

## 8. Implementation status (built in this pass)

**Done**
- `supabase_credit_ledger.sql` — idempotent migration (pence units fix + legacy £
  back-fill, `reserved_pence`, signed `team_credit_transactions`, `player_payments`
  `purpose`/`team_id`/`applied`, `match_posts.payment_mode`/`hold_pence`) and RPCs:
  `add_credit`, `hold_credit`, `release_hold`, `capture_and_settle`, `apply_replenishment`.
- Post flow (`app/play/create/page.tsx`): persists `payment_mode`; earmarks ONE batch
  hold (most expensive option) on an owner post via `hold_credit`; rolls back the posts
  if credit is short.
- Match flow (`app/play/page.tsx` `handleConfirm`): challenger-credit pre-check; captures
  the pitch booking id; calls `capture_and_settle`; releases the poster's earmark; pre-
  creates one pending `replenish` `player_payments` row per player (exact pence split).
- `/pay` (`app/pay/[matchId]/page.tsx`): credit mode pays the pre-created replenishment
  and calls `apply_replenishment`; individual mode keeps the direct split (records
  `purpose='individual'`). Payment-intent route accepts an exact `amountPence`.
- Credit UI: `TeamCreditsBar` shows balance + a reserved/available hint, deposits via
  `add_credit`; all credit reads in `my-team`/`pitches`/`play` use pence + available.

**Deferred (needs follow-up)**
- **Post never matched → credit stuck.** There is currently no manual post-cancel UI, so
  a placed hold is only released on match. Add a cancel/expiry path that calls
  `release_hold` + clears `hold_pence` on the owner post.
- **Match-cancel reversal** after capture (refund txs + refund player replenishments).
- **Ringer direct payment** is modelled (`purpose='ringer_direct'`) but the Ringer cards
  are still static dummy data — no real join/payment flow wired yet.
- **Run `supabase_credit_ledger.sql` in Supabase** before testing; verify the legacy £
  balances back-filled to pence correctly.

---

## 9. Mode rules (finalised — posting constraints per mode)

The two modes are deliberately asymmetric because they trade off *security* vs
*chance of a match*:

**Team credit mode — secure first, one post, one pitch.**
- The admin has already chosen and secured **one specific pitch at one fixed time** from a
  limited team budget, so the post is fully confirmed at creation — there are **no pitch
  rankings/options**. The opponent simply joins; then the payment logic runs.
- Posts **exactly one game for a single date** (the team's best-availability date), with
  the single secured pitch. The earmark holds that pitch's fee. No alt-time splitting.
- Rationale: posting multiple secured pitches would need a large budget, and refunding
  the un-matched holds gets messy. Best for peak slots booked days–weeks ahead.
- UI enforces this: pitch section caps at **1** ("Secured Pitch", "Choose & Secure Pitch");
  poll = single-select; confirmed/manual dates collapse to the first; "Add another date"
  hidden; alt-time "Own post" behaviour disabled.

**Individual mode — nothing held at post, secure at confirm, post widely.**
- No pitch is secured or held until a match is confirmed → low risk, maximises the chance
  of finding an opponent fast.
- Admins can post **multiple** dates/times (poll = multi-select; manual up to 5; alt-time
  pitches still split into their own posts). First challenge on any of them locks the
  match; the siblings auto-cancel.
- **At confirmation, team credit secures the pitch** (capture/settle as in §3). The squad
  is still fluid at this point, so no individual is charged yet.
- **Settlement is deferred to roster-lock** (see §10): only the players who actually played
  replenish their team's credit, charged automatically off saved cards. This is why credit
  + replenish is kept for individual mode — it absorbs a changing roster and late joiners.

_Implemented in `app/play/create/page.tsx` via the derived `isCredit` flag._

---

## 10. Settlement model (finalised — card-on-file + roster-lock replenish)

**Decision:** Team credit + replenish is kept for **both** modes. Card-on-file does *not*
replace it — it makes the *replenish* step automatic. The two solve different problems and
compose:

- **Team credit secures** the pitch at a fixed cost `P` while the roster is still fluid
  (handles late joiners, drop-outs, and acts as a buffer until the squad locks).
- **Saved cards replenish** — once the roster is known, the actual participants' cards are
  charged off-session to refill the credit. No "everyone open the app and pay" step.

### Why plain instant-charge-at-confirm was rejected
Charging each player their split *at confirmation* assumes the final headcount (the split
denominator) is known then. It isn't — matches confirm days/weeks ahead. Charge too early
and late-comers don't pay / early payers overpay; charge the wrong count and you owe
refunds. Securing with credit and settling **after** the roster locks removes the
denominator problem entirely.

### Lifecycle (per match)
1. **Register / profile:** each player saves a card via a Stripe **`SetupIntent`** →
   reusable `PaymentMethod` with off-session consent, stored against the user.
2. **Match confirms:** `capture_and_settle` moves team credit to secure the pitch (§3
   Phase 2). Nobody is charged. Roster open.
3. **Roster lock** (the one operational knob — pick one):
   - fixed cutoff (e.g. **24h before kickoff**), or
   - captain confirms the final XI, or
   - pitch-side check-in.
   At lock, the set of *actual participants* is frozen and the split `P ÷ participants` is
   computed (`splitPence`).
4. **Auto-settle:** for each participant, create a `PaymentIntent`
   (`off_session: true, confirm: true`) against their saved card. On success →
   `apply_replenishment` refills that team's credit (§3 Phase 3). The 5% Unitr fee rides
   on top as today.
5. **Credit returns to baseline**, paid only by who played. ✓

### Failure handling (real-world; no-op for the dummy prototype)
- Off-session charge can **decline** or require **SCA/3DS** (can't complete off-session).
- The **team-credit float is the backstop**: the pitch is already secured, so a failed
  card just leaves that player's share temporarily uncollected. Retry / dunning, or prompt
  that player to re-authenticate in-app. Argues for keeping the baseline float ≥ one fee.
- Ringers fold into this: an individual with a saved card, charged at lock like anyone else.

### Build status (BUILT — this pass)
- **Roster-lock trigger:** captain-confirms-the-squad. The captain hits **"Lock squad &
  charge cards"** on the match page (`app/my-team/match/[matchId]` → Payment tab). No cron
  needed; deterministic for the prototype. A cutoff/check-in can replace this later.
- `SetupIntent` capture lives on the **profile** (`PaymentMethodSection` in
  `app/profile/page.tsx`) → `stripe_customer_id` + `stripe_payment_method_id` (+ card
  brand/last4) persisted on `profiles`. Routes: `app/api/create-setup-intent`,
  `app/api/payment-method`.
- Off-session settlement route: `app/api/settle-match` charges each participant's saved
  card (`off_session:true, confirm:true`) and returns a per-player result.
- `handleSettleSquad` (match page) splits this team's pool (`splitPence` in `lib/money.ts`)
  across actual confirmed participants, skips already-paid players (no double charge),
  writes `player_payments` (paid/failed + `off_session`), and calls `apply_replenishment`
  per success. Stamps `matches.roster_locked_at` / `settled_at`.
- Both modes now **secure with credit at confirm** (`handleConfirm` in `app/play/page.tsx`
  runs `capture_and_settle` for credit AND individual; poster-credit pre-checked for
  individual since it placed no hold). Per-player replenishment is no longer pre-created at
  confirm — it's created at lock from the real roster.
- Manual `/pay` retained as the fallback for declined/no-card players (match page shows
  failures + a "pay manually" link).
- Schema: `supabase_card_on_file.sql` (profile card columns, `matches.roster_locked_at` /
  `settled_at`, `player_payments.failure_reason` / `off_session`).

### Still deferred
- **Run `supabase_card_on_file.sql`** in Supabase before testing.
- Each captain settles their own team independently; `matches.settled_at` is a single
  shared stamp (fine for the prototype, ambiguous for two-sided reconciliation).
- Off-session decline → currently surfaced + manual fallback; no automated retry/dunning.
