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

-- Joining-fee progress was recorded against those payments.
update public.team_members set joining_fee_paid_pence = 0;
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

## 2. Activate the live Stripe account

Toggle the dashboard out of test mode. Finish activation if it's incomplete —
business details and a payout bank account. **Live charges fail outright until
the account is activated**, so confirm this before touching Vercel.

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

Leave `.env.local` on test keys — local stays a sandbox.

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
