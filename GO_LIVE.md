# Going live on Stripe

The cutover from test keys to live keys, in order. Written 2026-09-04, after the
refund path was built and proven in test mode.

**Do the steps in order and don't skip the gates.** Most of what can go wrong here
is silent: the payer's card is charged and the app credits nobody.

---

## Why step 1 exists

Supabase is shared between test and live. Stripe is not.

Every Stripe id currently in the database — PaymentIntents on the credit ledger,
customers and payment methods on profiles — was minted in **test mode** and does
not exist to a live key. Leaving them there produces two failures that look like
app bugs:

- a cash-out refund fails with *No such payment_intent*
- `/api/settle-match` fails with *No such customer* for anyone who saved a card
  during testing

Both are unfixable after the fact for those rows. Clear them while still on test
keys.

---

## 1. Wipe test-mode Stripe data — while still on test keys

Look before deleting:

```sql
select count(*) from public.team_credit_transactions;
select count(*) from public.profiles where stripe_customer_id is not null;
```

Then:

```sql
-- Credit ledger: every row points at a test-mode PaymentIntent.
delete from public.team_credit_transactions;
update public.team_credits set balance_pence = 0, reserved_pence = 0;

-- Saved cards: test-mode customers/payment methods a live key cannot see.
update public.profiles
   set stripe_customer_id = null,
       stripe_payment_method_id = null,
       card_brand = null,
       card_last4 = null;

-- Joining-fee progress was recorded against those payments. Both copies of the
-- figure: the squad's on team_members, and the captain's own on teams (they
-- have no team_members row — see supabase_captain_joining_fee.sql).
update public.team_members set joining_fee_paid_pence = 0;
update public.teams set captain_joining_fee_paid_pence = 0;
```

Optional, for a clean slate — check what's there first:

```sql
delete from public.payment_collection_status;
delete from public.player_payments;
```

Also worth clearing: any balances seeded by `supabase_seed_test_credits.sql`,
which writes `balance_pence = 10000` with **no ledger rows at all**. The `update
team_credits` above already handles it.

**Verify** with the reconciliation query — every team should read `0` for both
`balance_pence` and `ledger_sum`:

```sql
select t.name, c.balance_pence, c.reserved_pence,
       coalesce(sum(x.amount_pence) filter (where x.type <> 'booking_hold'), 0) as ledger_sum,
       c.balance_pence - coalesce(sum(x.amount_pence) filter (where x.type <> 'booking_hold'), 0) as drift
from public.team_credits c
join public.teams t on t.id = c.team_id
left join public.team_credit_transactions x on x.team_id = c.team_id
group by t.name, c.balance_pence, c.reserved_pence
order by drift desc;
```

## 1b. Only if going live on a DIFFERENT Stripe account

Everything in step 1 applies to any cutover, because test ids don't exist to a
live key. Changing *account* breaks one more class of id that survives the
test→live boundary in the same account: **Connect account ids**.

`pitches.stripe_account_id` holds `acct_…` values minted by the old platform
account. A connected account belongs to the platform that created it, so the
new account cannot see them, and `payouts_enabled = true` alongside them is a
claim about an account that is no longer yours.

```sql
update public.pitches set stripe_account_id = null, payouts_enabled = false;
delete from public.venue_transfers;
```

Admin-hosted events never reach this code — `/api/tournaments/join`
short-circuits on `isAdminHosted` — so the pilot flow is unaffected either way.
But a **team-vs-team friendly still fires a venue transfer** on confirmation
(`ChallengePanel` → `/api/connect/venue-transfer`). It is fire-and-forget, so a
stale id doesn't block the match; it just fails against Stripe on every
confirmation and leaves failed `venue_transfers` rows. Cleared, `payVenue`
returns its honest *"venue has not connected a payout account yet"* instead,
which is the true state until a venue onboards to the new account.

Also check the **old** account for a live webhook endpoint pointing at the
Vercel domain and delete it. Two accounts delivering to one endpoint means
half the events fail signature verification against whichever secret is set.

## 2. Activate the live Stripe account

Toggle the dashboard out of test mode. Finish activation if it's incomplete —
business details and a payout bank account. **Live charges fail outright until
the account is activated**, so confirm this before touching Vercel.

On a new account this is the long pole: activation is a fresh KYC review, not a
toggle, and it can sit pending for a day or more. Nothing below works until it
clears.

## 3. Create the live webhook endpoint

Developers → Webhooks, **in live mode** → Add endpoint.

- URL: `https://<vercel-domain>/api/webhooks/stripe`
- Events — all three:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`

Copy the `whsec_…`. It is a **different secret from the test endpoint's**, and
mixing them up is the most common way this goes wrong — every event fails
signature verification and no credit is ever granted.

`charge.refunded` is easy to forget. Without it, refunds leave Stripe and the
team's credit is never reversed — the exact drift `supabase_refunds.sql` exists
to prevent.

## 4. Vercel environment variables

Settings → Environment Variables, **Production** scope:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | the **live** endpoint's secret from step 3 |

All three must come from the **same** account. A `sk_live_` from one account
with a `whsec_` from another is the silent failure this whole document is
written around, and having two accounts open in two tabs is how it happens.

Leave `.env.local` on test keys — local stays a sandbox.

### The two `whsec_` secrets are different things

There are two webhook secrets in play and they are not interchangeable:

- **Production** (`STRIPE_WEBHOOK_SECRET` in Vercel) — the secret shown once
  when you create the dashboard endpoint in step 3. It signs events Stripe
  sends to the deployed URL.
- **Local** (`STRIPE_WEBHOOK_SECRET` in `.env.local`) — the secret
  `stripe listen` prints in your terminal when you start it. It signs events
  the CLI forwards to `localhost`. It is issued per CLI session and belongs to
  whichever account the CLI is logged into.

So: dashboard secret → Vercel. Terminal secret → `.env.local`. Putting the
production secret in `.env.local` makes every locally forwarded event fail
signature verification, and nothing is credited locally.

## 5. Redeploy

Deployments → latest → Redeploy. Env changes don't reach an existing build.

## 6. 🚦 Gate — one £1 top-up on a real card

Sign in as a captain, top up **£1**. Check in this order:

- Stripe (live) → the endpoint's event log: `payment_intent.succeeded` → **200**
- the balance reads £1.00

**If the balance stays £0, stop.** It's the webhook secret, and every further
payment would charge someone and credit nobody. Vercel → Logs will show
`Invalid signature`.

## 7. One live loop

Host a £1 admin event, enter it with a team, cash out the change. Costs pence
and proves the live refund path, which until now has only run in test mode.

---

## Local development after the switch

The Stripe CLI stays authenticated to whatever account you last logged it into,
so after changing accounts it is pointing at the old one until told otherwise.

```powershell
stripe login          # pick the NEW account in the browser prompt
stripe config --list  # confirm which account the CLI is on
```

Then, to work on payments locally, run the forwarder and take the secret it
prints:

```powershell
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

It prints `Ready! Your webhook signing secret is whsec_…`. Put **that** value in
`.env.local` as `STRIPE_WEBHOOK_SECRET`, alongside the new account's **test**
keys (`sk_test_…` / `pk_test_…`). Restart `next dev` — env is read at boot.

Keep `stripe listen` running the whole time you are testing payments. Without
it nothing reaches the local webhook, so a local top-up charges the test card
and credits nobody — the same symptom as a wrong secret, from a different
cause.

Never point the CLI at production, and never put a `sk_live_` key in
`.env.local`.

---

## Expected after go-live — not bugs

- **The admin finance page's Stripe balance panel goes blank.**
  `/api/dev/fund-test-balance` refuses on a live key by design.
- **Stripe does not return processing fees on refunds** (UK). Refunding £3 of a
  £5 charge returns £3 to the player; the original ~20p fee stays spent. A fully
  cashed-out team costs you its fees.
- **Payouts to your bank run on Stripe's schedule** — typically 7 days for a new
  account. Buy-ins won't be in your bank the same day, so pay the venue from
  your own float for the first events.

## Out of scope for the pilot

Stripe Connect and venue payouts. Admin-hosted events set `organiser_admin_id`,
and `/api/tournaments/join` short-circuits on `isAdminHosted` — no transfer to a
venue ever fires. Unitr collects the buy-ins and pays the venue in cash outside
the app.
