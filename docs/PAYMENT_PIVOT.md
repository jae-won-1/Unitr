# Payment pivot — from team credit to linked team accounts

Decided by the user on 10 Nov 2026. **Partly built, behind a switch that is
off** — see "What is built" below. The live app still runs on team credit, as
`CLAUDE.md` describes. The store release waits for this work
(`docs/LAUNCH_PLAN.md`).

## Why

Team credit is money Uniter holds for teams, spent on venues and moved between
teams. That risks e-money regulation and is the most complicated part of the
app. The new model follows Spond: **Uniter holds no money and keeps no
balance.** Money moves between cards and bank accounts through Stripe.

## The model

- **Linked team account.** A team leader links a bank account to the team
  through Stripe (a Connect account, as venues already have). Money the squad
  pays in lands there and is paid out to that bank. Ideally it is a club
  account, or a personal account used only for the team — the pool legally
  belongs to whoever owns it.
- **Team card.** A leader saves a card for the team, ideally the debit card of
  that same bank account. It is what pays for pitches and event entries. A
  linked bank account cannot be charged; only a card can.
- **Payment requests.** A leader asks chosen squad members for money: title,
  amount, who. Members pay by card, Apple Pay or Google Pay; the money goes to
  the linked account. Three kinds share one mechanism:
  - **Joining fee** — builds the float that covers a pitch while later
    collections are still on their way to the bank.
  - **Match fees** — Settle Payments stays, and stays only for match fees.
  - **Anything else** — kit, a team dinner. Uniter only collects; the leader
    pays for the thing elsewhere.
- **Payment status.** Who has paid each request, mark paid by hand (cash),
  remind. As today.
- **Team finance tab.** A statement: collected through Uniter, spent through
  Uniter, plus spending the leader logs by hand. It is a *tracked* balance —
  Uniter cannot see the bank account.

## The Team Finance screen (user, 10 Nov)

The **team credits** button becomes **Team finance**. Inside:

- **Dashboard** — the current balance, then recent transactions as posts.
  Each payment request is a post; opening it shows who has paid. A filter
  sheet: Active / Completed / All; sort by due date or send date; oldest or
  newest first.
- **+** — a leader creates a payment request or sets the joining fee: title,
  description, a screenshot, who it goes to, amount and due date. The
  screenshot is the app's first image upload and needs a line in the privacy
  policy before the switch goes on.
- **Settle match fees** — a sub-tab listing recent matches not yet settled
  (games the team account paid for up front). Works as Settle Payments does
  today; the requests it issues appear on the dashboard like any other.
- **Members** see what they owe on the dashboard and pay from there.

**Only the joining fee and match fees block voting Available** (user, 10 Nov).
Kit, dinner and other requests never do.

## Who pays the fees (user, 10 Nov)

- **Collecting from players:** the fee is added on top and the player pays it,
  so the team receives the amount it asked for.
- **Paying for a pitch or an entry:** the fee is added on top and the team
  card pays it, so the venue receives its list price.

The rate lives in `lib/uniter-fee.ts` (currently 0) and must at least cover
what Stripe charges Uniter.

## How today's flows carry over

| Today (team credit) | After the pivot |
|---|---|
| Secured post: poster pays the venue, opponent reimburses half into the poster's credit | Poster's team card pays the venue. On matching, the opponent's team card pays its half to the poster's linked account |
| Hold on posting, split on matching | No hold. On matching both team cards are authorised for half each, to the venue, and captured only if both succeed |
| Top-ups, joining fee, replenish after a game | Payment requests paid into the linked account |
| Tournament buy-in from credit | Team card. A Uniter-hosted event is an ordinary sale by Uniter; a venue's or team's event pays that host's linked account |
| Venue paid by a transfer out of Uniter's balance (`lib/venue-payout.ts`) | The venue is the destination of the charge itself; nothing rests with Uniter |
| Take-down / kick-team return the buy-in to credit | Refund to the card that paid |
| Availability gate on money owed | Same gate, reading unpaid requests |

A team needs a **card** to pay and a **linked account** only to collect or be
reimbursed, so split-pay friendlies need no Stripe onboarding.

## Built behind a switch, changed over once (user, 10 Nov)

The new system is built complete and the app changes over in one go, rather
than running credit and linked accounts side by side for live teams.
`lib/finance-mode.ts` is the switch: `NEXT_PUBLIC_FINANCE_MODE=linked`. Off,
the app is exactly as it was and every `/api/finance/*` route answers 503.

## Order of work

1. **Team Finance: requests, joining fee, match fees — built 10 Nov, web
   only, not run against a database.** See "What is built".
2. **Pitch, match and event payments by card** — `/api/book/pitch`,
   `/api/challenges/accept`, `/api/tournaments/join`, the take-down and
   kick-team refunds, venue payment as the charge's destination; each writes a
   `spend` row to `team_finance_entries`. **Event entry and its refunds built
   16 Nov** (see "What is built (step 2, events)"). **Pitch booking and
   friendlies not started** — they still spend credit, so the switch can only
   go on where they are off (the phone's v1 scope) or once they are rebuilt.
3. **Port to the phone** (`mobile` branch) — **done 16 Nov** for everything
   built so far: Team Finance and event entry by card (`mobile/PORTED.md`).
4. **Change over, then remove credit** — top-ups, the ledger functions, the
   cap, the staff cash-out, credit reversal on disputes, the credit terms;
   rebuild `/admin/finance`. The ledger is referenced in 25 TypeScript files;
   the webhook is the heaviest.
5. **Store release** (`docs/LAUNCH_PLAN.md`).

## What is built (step 1)

- **`supabase_team_finance.sql`** — run on the live database 11 Nov. Additive and safe to run on
  the live database while it is on credit. Five server-only tables (RLS on, no
  policies): `team_finance_accounts`, `payment_requests`,
  `payment_request_members`, `payment_request_payments`,
  `team_finance_entries`; `apply_request_payment` / `reverse_request_payment`
  (service role only); a trigger that puts a newly approved member on the
  team's joining-fee request; a private `payment-requests` storage bucket.
- **Routes**, all under `/api/finance/`: `dashboard` and `owed` (reads),
  `requests` (create a request / set the joining fee, with the screenshot),
  `request-action` (mark paid, untick, remind, drop a member, cancel),
  `pay-intent` and `confirm-payment` (a member paying by card), `account`
  (link the bank account, refresh, payouts page), `balance` (set the tracked
  balance). The Stripe webhook records `payment_request` payments and refunds.
- **Screen** `/my-team/finance` and `components/finance/*`. On Home the four
  credit pills become one Team finance button; a player's Top Up tile becomes
  a Team finance tile.
- **Joining fee** is a payment request of kind `joining_fee`: one per team,
  the whole squad on it, changed in place. The captain owes it too unless
  the leader switches on **Exempt the captain** (user, 13 Nov;
  `supabase_team_finance_captain_exempt.sql`, not yet run). Team Settings and Register Team
  point to Team Finance instead of writing `teams.joining_fee_pence`.
- **Match fees** are requests of kind `match_fee`, one per fixture, issued
  from the Settle match fees sub-tab. A fixture leaves that list once it has a
  request.
- **Availability gate** reads `/api/finance/owed`: unpaid `joining_fee` and
  `match_fee` requests block voting Available; nothing else does.
- **How the money moves:** the charge is made on Uniter's Stripe account with
  the team's linked account as its destination, and the fee
  (`lib/payment-fee.ts`) is Uniter's application fee. Linked accounts are
  Express accounts with the transfers capability, as venues are.
- **Linking happens inside Uniter** (user, 14 Nov): Stripe's embedded
  onboarding form in a sheet, not a redirect. Stripe still asks its questions
  (identity and bank account — legally required); the hosted page is a
  fallback. Web only so far; the phone needs a WebView or the hosted page.
- **Without a linked account** requests still work as bookkeeping: members
  pay the leader directly and the leader ticks them off. Pay buttons are
  greyed with the reason.
- **Balance:** paid requests plus `team_finance_entries`. A leader can **Set
  balance** to what the bank shows; the difference is stored as an adjustment.

## What is built (step 2, events) — 16 Nov, untested

- **Entering an event** on linked finance: `/api/tournaments/join` prices the
  entry and opens a card payment (buy-in + fee), then records the entry once
  it has paid. `lib/event-entry-server.ts`. Uniter's own event is an ordinary
  sale; a venue's event pays the venue's Stripe account and a team's event the
  host team's linked account, as the charge's destination. The webhook
  finishes an entry whose app never came back, and the card is refunded if the
  event filled or was cancelled while the leader was paying.
- **No stored team card.** The leader entering pays on the spot, with their
  own saved card if they have one. This differs from "a leader saves a card
  for the team" above — it needs no new table or card-management screen, and
  works with 3D Secure. **User to confirm**, or ask for a saved team card.
- **Refunds:** taking an event down, or removing a team, refunds the entry to
  the card that paid (Uniter's own events, the only ones those routes act on).
- **Settle match fees** shares what the card was charged for an entry.
- **On both apps.** No new SQL.

### Switching on

1. Publish the phone update (OTA) with `EXPO_PUBLIC_FINANCE_MODE` **unset** —
   it carries the new entry sheet but stays on credit.
2. Set `NEXT_PUBLIC_FINANCE_MODE=linked` in Vercel and
   `EXPO_PUBLIC_FINANCE_MODE=linked` in `mobile/eas.json`; redeploy and
   publish a second OTA.

The order matters: an older phone build reads the join route's "now pay"
answer as "entered". On the web, pitch booking and friendlies must be hidden
or rebuilt first — they still spend credit.

### To try it

0. **Sign Uniter's Stripe account up for Connect**
   (dashboard.stripe.com/connect) — once in test mode, and again in live mode
   before launch. Until then Stripe refuses to create any connected account,
   so Link bank account fails (found 11 Nov). Venue onboarding needs it too.
   Then **allow Accounts v1** (Settings → Developers → API policies →
   Accounts v1 support; dashboard.stripe.com/settings/developers/api-policies/feat_accounts_v1_support),
   again per mode: a platform new to Connect is refused v1 account creation,
   which both the team and venue routes use (found 12 Nov). Moving both to
   Stripe's Accounts v2 is a later job.
1. Run `supabase_team_finance.sql` in the Supabase SQL editor (done 11 Nov).
2. Add `NEXT_PUBLIC_FINANCE_MODE=linked` to `.env.development.local` and
   restart `npm run dev`.
3. As a captain: Home → Team finance. Link a bank account (Stripe test
   onboarding), tap + to send a request, pay it as a squad member with
   4242 4242 4242 4242.

### Known gaps in step 1

- The fee rate in `lib/payment-fee.ts` is 1.5% + 20p — kept as it is for now
  (user, 11 Nov); revisit before launch.
- A team's joining fee is no longer shown to someone about to join (the join
  page, the teams list and My Team read `teams.joining_fee_pence`, which
  linked finance leaves at 0).
- A player who has left a squad can't open Team Finance to pay what they
  still owe; the leader can still tick them off.
- No way to replace or unlink a linked account, and nothing happens to it on
  a team hand-over or account deletion.
- A refund made in the Stripe dashboard takes the money from Uniter unless
  "reverse transfer" is ticked; the member's row is unticked either way.
- No expense logging yet (`expense` entries have no screen).
- `/admin/finance` and `lib/event-revenue.ts` read the credit ledger, so an
  entry paid by card shows no revenue there (rebuilt in step 4).
- A request's screenshot can't be attached from the phone (needs an
  image-picker module, so a new build rather than an OTA).
- The phone links the bank account on Stripe's hosted page; the embedded form
  is web only.

## Credit to wind down

Live balances on 10 Nov 2026: Regent Legend FC £2.00, which the user refunded
in person and said to ignore; 72s fc and Young Boys FC £0. Five other teams
hold credit — Test, Nomoney, Ballers United, Test2 and
`[RN-PORT TEST] Opponents` — and the user confirmed on 11 Nov that all five
are test teams. **No real team has credit to return**, so removing credit
needs no refunds; the test balances go with the database clean-up
(`docs/LAUNCH_PLAN.md`, item 6).

## Still open

- **How Stripe is told to move the money.** Recommended: Uniter charges on the
  team's behalf with the team (or venue) as destination, and sets one flat fee.
  Existing saved cards and wallets keep working; Uniter pays Stripe's fee and
  carries disputes. Confirm with Stripe.
- **Legal check** of the whole structure, and of the fee wording: UK law bans
  charging a consumer extra for paying by card, so the fee has to be a service
  fee on every payment.
- **Matching the balance to the bank automatically.** Today a leader sets it
  by hand. A read-only bank feed (open banking, through a licensed provider
  such as TrueLayer, Plaid or GoCardless) would show the real balance and
  transactions; it is a separate integration with its own consent screen and
  privacy wording. Not planned yet.
- **Handing the team over.** The linked account and its money stay with the
  person who owns it. The new captain links their own; a club account avoids
  the problem.
- ~~**The poster's card fails at matching**~~ — decided 11 Nov: the match
  waits for that captain to pay, with a deadline, then falls through.
- **Refund after payout.** A refund once the money has reached a bank pulls it
  back from the team or venue.
- **Abuse.** A general collection tool attracts stolen cards: requests only to
  approved squad members, and a cap per request.
- **Does the phone stay narrowed?** The legal reason for limiting the first
  store build to Uniter-hosted events goes with credit.
