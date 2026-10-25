# First store release — launch plan

Decided by the user on 23 Oct 2026. This is the scope of the **first App Store /
Play Store release** (v1). Later builds bring the full feature set back; this
file says what is in, what is switched off and why, and what must be done
before submitting. Product detail for every feature stays in `CLAUDE.md`.

## The one-line version

**v1 is a team app for entering Uniter-hosted events.** Team credit is the way
a team pays for them. It is a prepayment to Uniter, spent only on Uniter-hosted
events, and it is not refundable.

## Team credit in v1

Team credit is essential to every current and future feature, so it stays. In
v1 it is **only a tool to make paying easy**:

- **What it is:** a team's prepayment to Uniter. Real money sits in Uniter's
  account; the balance shows how much of it the team has left to spend.
- **What it pays for:** buy-ins to **Uniter-hosted events** (`open_matches`
  with `organiser_admin_id` set). Nothing else.
- **How it gets in:** players pay by card for something named — their joining
  fee, their share of an event buy-in, or the shortfall when the captain enters
  an event. No free-amount "top up a balance" in the store build
  (`TEST_TOP_UP` in `mobile/src/store-review.ts` stays dev-only).
- **Not refundable to players.** Shown before every payment
  (`lib/team-credit-terms.ts`); `/api/credit/refund` is staff-only. Done
  22 Oct.
- **Exceptions handled by Uniter:** if Uniter cancels an event or removes a
  team, the buy-in returns to the team's **credit** (`/api/events/take-down`,
  `/api/events/kick-team`). A mistaken charge is refunded by staff from the
  Stripe dashboard; the webhook takes the matching credit back.
- **Never moves between teams.** With only Uniter-hosted events, no team's
  payment can become another team's balance.

Why this shape: credit that can only be spent with one business, on that
business's own services, is a prepayment (like a gym account balance), not
money held for customers to spend anywhere or withdraw. That keeps v1 clear of
e-money / payment-services questions and of the "money management" category
in Apple's and Google's review rules. Get a payments lawyer or Stripe to
confirm before launch.

## In v1

- Accounts, sign-up (email and Google), profiles, saved cards
- Teams: create, invite link, join requests, co-captains, Team Settings,
  leaving a squad
- Squad tools: team chat, announcements, availability polls, tactics, the
  Transfer Market (finding players and teams — no money involved)
- **Uniter-hosted events:** browse, enter (paid from team credit), the
  schedule and fixtures, results entered by staff
- Team money for those events: joining fee, Settle Payments / Payment Status
  for event buy-ins, the non-refundable team credit balance
- Calendar and notifications for all of the above
- Admin: create events, take one down, remove a team, finance view (web)

## Switched off in v1 (kept in the code)

| Feature | Why it's off | Where it lives |
|---|---|---|
| Booking a pitch | Money goes to a venue, not a Uniter event | `/book`, `/api/book/pitch`, `/api/book/post` |
| Posting matches / challenges (friendlies) | Splits a fee between two teams | `/play/create`, `/play/edit`, `/api/challenges/accept` |
| Secured posts | Moves one team's payment into another's credit | `/api/book/post`, `reimburse_secured_pitch` |
| Team-hosted tournaments | Entrants' buy-ins become the host team's credit | `/play/create-tournament`, `reimburse_team` |
| Venue-hosted events and venue payouts | Credit paying a venue, not Uniter | `/api/tournaments/join` (venue branch), `lib/venue-payout.ts` |
| Ringers / fill-in games | Belong to friendlies | `/api/ringer/*` |
| Venue portal, pitch registration | No venue features in v1 | `/venue/*`, `/pitches/register` |

**Switched off means refused by the server, not just hidden.** The API routes
can be called directly with the public anon key, so a hidden button changes
nothing. Plan: one setting (`lib/launch-scope.ts`) that every route above
checks first and refuses with a plain sentence, and that the apps read to
leave those entry points out. Turning v1 back into the full app is then a
one-line change, not a rebuild. (Built 25 Oct — see item 1.)

**Hidden, not greyed, in the store build.** This is a deliberate exception to
the house "greyed rather than hidden" rule: Apple and Google reject apps that
show unfinished or "coming soon" features, so v1 shows only what works.

## Before submitting

Work items, roughly in order. None are done unless marked.

1. **Scope switch** — `lib/launch-scope.ts`; server refusals on every route in
   the table; store build hides the entry points (web and phone). **Done
   25 Oct** (`main` 0292bb8, `mobile` 8051318) — not yet deployed. Refused:
   `/api/book/pitch` (except finishing a card payment already taken),
   `/api/book/post`, `/api/challenges/accept`, `/api/ringer/create-intent`,
   `/api/connect/create-venue-account` + `account-status`, and
   `/api/tournaments/join` for any event without `organiser_admin_id`.
   Left open on purpose: `/api/ringer/join` (completes a paid spot),
   `/api/settle-match` and `/api/create-payment-intent` (players paying debts
   from friendlies already played). Not closed: the browser can still insert
   `match_posts` / team `open_matches` rows through PostgREST — harmless, as
   nothing can accept or enter them, but a SQL guard would make it airtight.
2. **Account deletion in the app** — required by both stores. Decide what
   happens to a captain's team and its credit when the captain deletes their
   account (hand the team to a co-captain, or block deletion until they do).
3. **Privacy policy and terms**, linked in the app and the store listings.
   The terms say: credit is a prepayment for Uniter events, not refundable,
   what happens when Uniter cancels, and how mistaken charges are handled.
4. **Remaining security fixes** from the 20 Oct review:
   - `team_members` is writable by anyone (`for all using (true)`);
   - ledger tables, `team_card_contributions` and card brand/last4 are
     readable by anyone — fix, or the privacy labels can't be accurate;
   - handle `charge.dispute.*` in the webhook;
   - rate-limit the routes that create payments; cap a team's balance.
5. **Live payments** — follow `GO_LIVE.md`. A store build taking test-mode
   payments reads as a demo and is rejected.
6. **Clean the live database** — remove `[TEST]` pitches and test fixtures.
7. **Developer accounts as an organisation** (Apple and Google), not personal.
   Google Play Console account created by the user (25 Oct); confirm it is an
   organisation account. Apple still to do.
8. **Store paperwork** — App Store privacy labels, Play data safety form,
   Play financial features declaration (team credit is a prepayment for the
   developer's own services), a demo account and review notes explaining how
   paying works.
9. **Fix `npm run update` in `mobile/`** — it fails on the web export; publish
   with `--platform android` and `--platform ios` until it's changed.

## Later builds

Bring back the full feature set: booking pitches, teams posting matches,
team- and venue-hosted events, and splitting a match fee between two teams
through team credit. How the split works — today's mechanism (each team pays
its own half; secured posts reimburse the poster) or the holding mechanism
(Uniter fronts the second half, held against the posting team's credit until
an opponent pays) — is decided then. Anything that lets one team's payment
become another team's balance needs the legal check again first.
