# First store release — launch plan

Scope decided by the user on 23 Oct 2026; **revised 10 Nov 2026: the store
release now comes after the payment pivot** (`docs/PAYMENT_PIVOT.md`). This
file says what is in the first App Store / Play Store release (v1), what is
switched off and why, and what must be done before submitting. Product detail
for every feature stays in `CLAUDE.md`.

## The one-line version

**v1 is a team app for entering Uniter-hosted events, paid for by card.**
Uniter holds no money for teams: a team pays an entry with its team card, and
collects from its squad into its own linked bank account.

## What changed on 10 Nov

The 23 Oct plan kept team credit and framed it as a non-refundable prepayment
for Uniter's own events, to stay clear of e-money rules. That framing only
ever described the phone app — on the web, credit still paid venues and moved
between teams. The user has decided to remove team credit instead, so the
store release waits until it is gone. Until then the code, and the live app,
still run on credit as `CLAUDE.md` describes.

## Paying in v1

- **Entering a Uniter-hosted event:** the team card is charged the buy-in plus
  the fee. It is an ordinary sale by Uniter of its own event.
- **Collecting from the squad:** payment requests (joining fee, match and
  event shares) paid by card, Apple Pay or Google Pay into the team's linked
  account. The player pays the fee on top.
- **If Uniter cancels an event or removes a team:** the buy-in is refunded to
  the card that paid it.
- **No balance, no top-up, nothing to withdraw.** Tell reviewers the app takes
  payment for real-world football events and lets a team collect its own fees,
  both outside the stores' in-app billing rules.

Get a payments lawyer or Stripe to confirm the structure before launch.

## In v1

- Accounts, sign-up (email and Google), profiles, saved cards
- Teams: create, invite link, join requests, co-captains, Team Settings,
  leaving a squad
- Squad tools: team chat, announcements, availability polls, tactics, the
  Transfer Market (finding players and teams — no money involved)
- **Uniter-hosted events:** browse, enter (paid by team card), the schedule
  and fixtures, results entered by staff
- Team money: linked account, team card, payment requests, Settle Payments /
  Payment Status, the team finance tab
- Calendar and notifications for all of the above
- Admin: create events, take one down, remove a team, finance view (web)

## Switched off in v1 (kept in the code)

| Feature | Where it lives |
|---|---|
| Booking a pitch | `/book`, `/api/book/pitch`, `/api/book/post` |
| Posting matches / challenges (friendlies) | `/play/create`, `/play/edit`, `/api/challenges/accept` |
| Secured posts | `/api/book/post` |
| Team-hosted tournaments | `/play/create-tournament` |
| Venue-hosted events and venue payouts | `/api/tournaments/join` (venue branch), `lib/venue-payout.ts` |
| Ringers / fill-in games | `/api/ringer/*` |
| Venue portal, pitch registration | `/venue/*`, `/pitches/register` |

**These were switched off because each one moved credit to a venue or between
teams. That reason goes with credit.** Whether the phone stays this narrow for
its first release is the user's call once the pivot is built; until they say
otherwise the scope above stands.

**Switched off in the phone app only** (user, 26 Oct). The web keeps every
feature, and since both apps call the same API routes, the server refuses
nothing. `lib/launch-scope.ts` reads `lib/app-scope.ts` ("full") on the web
and `lib/app-scope.native.ts` ("v1") on the phone; the phone leaves the entry
points out. Turning the phone into the full app is a one-line change to
`app-scope.native.ts`.

**Hidden, not greyed, in the store build.** This is a deliberate exception to
the house "greyed rather than hidden" rule: Apple and Google reject apps that
show unfinished or "coming soon" features, so v1 shows only what works.

## Before submitting

Work items, roughly in order. None are done unless marked.

0. **The payment pivot** — steps 1–4 of `docs/PAYMENT_PIVOT.md`, on both apps.
   **Built on both apps 16 Nov, behind switches that are off:** Team Finance
   (requests, joining fee, match fees, linked bank account) and entering an
   event by card with refunds to the card — everything v1's scope pays for.
   Entries are charged to a **team card** a leader saves (19 Nov).
   **Left before the switch goes on:** run `supabase_team_card.sql`; try
   each flow in Stripe test mode (nothing has been run signed in); rewrite
   the terms and privacy policy (item 3) — the privacy policy must say a team
   card is stored with Stripe; then follow "Switching on" in the pivot doc.
   Removing credit (step 4) and rebuilding pitch booking and friendlies on
   cards can follow the release — the phone's v1 scope has neither.
1. **Scope switch** — **Done 26 Oct, phone only.** `lib/launch-scope.ts` +
   `lib/app-scope(.native).ts`. The phone hides Post a Match, Book a Pitch,
   Matches and Fill In in the feed, non-Uniter events, the Calendar chips for
   off kinds, Turn into Match Post, the ringer panel, and the venue account
   choice at sign-up. The web is unchanged.
2. **Account deletion in the app** — **Done 26 Oct, both apps**; detail in
   `CLAUDE.md`, Deleting an account. **Revisit after the pivot:** a lone
   captain's deletion forfeits the team's credit today, and there will be no
   credit — decide instead what happens to the team's linked Stripe account
   and saved team card.
3. **Privacy policy and terms** — **live 10 Nov** (`/privacy`, `/terms`,
   linked from sign-up and Profile on both apps; accounts are 18+).
   **Rewrite after the pivot:** the terms' team-credit section (prepayment,
   not refundable) becomes how payment requests, fees and refunds work; the
   privacy policy must add that a leader linking a bank account gives Stripe
   their identity and bank details. Both still want review by someone
   qualified.
4. **Security fixes** from the 20 Oct review — **done** (`supabase_launch_security.sql`
   run 28 Oct; dispute events confirmed on the live webhook 10 Nov).
   The £1,000 credit cap and credit reversal on disputes go with credit; the
   new payment routes need the same caller checks and rate limit.
5. **Live payments** — follow `GO_LIVE.md`. A store build taking test-mode
   payments reads as a demo and is rejected.
6. **Clean the live database** — remove `[TEST]` pitches and test fixtures,
   and the test teams' leftover credit. No real team holds credit (user,
   11 Nov), so there is nothing to refund (`docs/PAYMENT_PIVOT.md`).
7. **Developer accounts as an organisation** (Apple and Google), not personal.
   The Play Console account is personal: production needs a 12-tester, 14-day
   closed test first. Apple still to do.
8. **Store paperwork** — App Store privacy labels, Play data safety form,
   Play financial features declaration (no stored balance: card payments for
   real-world events, and a team collecting its own fees), a demo account and
   review notes explaining how paying works.
9. **Fix `npm run update` in `mobile/`** — it fails on the web export; publish
   with `--platform android` and `--platform ios` until it's changed.

## Later builds

Bring back whatever the first release leaves off: booking pitches, teams
posting matches, team- and venue-hosted events, ringers. After the pivot each
of these is a card payment to a venue or to another team's linked account, so
none needs the legal check that moving credit between teams did.
