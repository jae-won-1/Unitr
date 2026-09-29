# Port ledger

The web app keeps evolving while this port is built. Shared code (`lib/`, `contexts/`,
`app/api/`, the SQL migrations) stays in sync for free — both clients read the same files and
the same deployed API. **The UI does not.** A Next.js `div` tree cannot be merged into a React
Native `View` tree, so every web screen that changes after it was ported has to be re-ported
by hand.

This file is what stops that drift being invisible.

## How to use it

Every ported screen records the `main` commit it was ported from. To find out what has drifted
since:

```bash
# Everything that changed in the web UI since a screen was ported
git diff <sha>..main --stat -- app components

# One screen specifically
git log <sha>..main --oneline -- app/calendar components/CalendarSheet.tsx
```

An empty diff means the port is current. A non-empty one is the re-port list — exact, not a
guess. Update the SHA in the table below whenever a screen is brought back into line.

**Rules that keep this honest:**

- Record the SHA you *actually ported from*, not the SHA at the time you write the row.
- Re-porting a screen means updating its row, not adding a second one.
- Renaming or moving files under `components/` makes these diffs unreadable. Don't, unless
  there's a real reason.

## Baseline

| | |
|---|---|
| Web fallback tag | `web-fallback` |
| Baseline commit | `667f757` |
| Expo SDK | 57 (RN 0.86, React 19) |
| Web app | Next.js 14.2.5, React 18 |

## Screens

Scope for v1 is player-facing only — `/admin/*` and `/venue/*` stay on the web app.

| Screen | Web source | Ported from | Status |
|---|---|---|---|
| Sign in | `app/login` | `008f735` | Phase 1 — email + password |
| Create an account | `app/register/page.tsx`, `components/RegistrationFields.tsx`, `lib/register-profile.ts` | `ea826c8` | done — every question the web asks, written by the shared `insertNewProfile`. Replaces Phase 1's email-and-password-only sign-up, which made accounts with no profile |
| Finish setting up (profile gate) | `app/welcome/page.tsx`, `components/ProfileGate.tsx` | `ea826c8` | done — the root Gate sends a session with no profile to `welcome.tsx`, skipping the sign-up screens, as ProfileGate does |
| Root gate + venue notice | `contexts/RoleContext.tsx` | `008f735` | Phase 1 — done. Venue portal deliberately out of v1 |
| Tab shell (Home/Calendar/My Team) | `components/BottomNav.tsx` | `008f735` | Phase 1 — done |
| Theme (colors, radii, shadow, font) | `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx` | `008f735` | Phase 1 — done. See `src/theme.ts`; dark mode is an addition, the web app has none |
| Home — next fixture + status strips | `app/page.tsx`, `components/PlayerActionStrip.tsx`, `PollStatusTile.tsx` | `008f735` | Phase 2 — done. Team credit read-only until Phase 3 |
| Fixture detail sheet | `components/FixtureDetailSheet.tsx` | `008f735` | Phase 2 — done. Management CTAs greyed until their screens land |
| Month grid | `components/CalendarSheet.tsx` | `008f735` | Phase 2 — done |
| Availability answer | `components/AvailabilityButtons.tsx` | `008f735` | Phase 2 — done, gate included |
| Fill In / ringer feed | `components/RingerFeed.tsx`, `lib/ringer-feed.ts` | `da0090e` | **Phase 3 — done, including payment.** Join calls the same `/api/ringer/create-intent` + `/api/ringer/join` pair the web app does, confirmed with Stripe's PaymentSheet instead of the Payment Element. Only real-device 3DS testing is outstanding — see the Phase 3 note below |
| Home — GameFeed (discovery) | `components/GameFeed.tsx`, `lib/game-feed.ts` | `9ba8b59` | Phase 2 — done. `lib/game-feed.ts`'s hooks are shared, so this stays current for free; Challenge/Enter greyed until Phase 3 |
| Calendar | `app/calendar/page.tsx`, `lib/calendar-entries.ts` | `008f735` | Phase 2 — **done**, incl. month grid + detail sheet |
| My Team — squad + details | `app/my-team/page.tsx` | `fe97d03` | Phase 2 — done; Phase 4 adds the captain's Invite / Team Settings / Post announcement buttons, join requests, and Team chat for everyone. Tactics, settle payments and match management still to come |
| Leave team | `components/my-team/LeaveTeamPanel.tsx` | `fe97d03` | done — shares `lib/leave-team.ts`, `lib/availability-gate.ts`, `lib/hard-navigate.native.ts` unchanged |
| Pay what you owe (joining fee, match shares) | `components/DuesTopUpModal.tsx`, `lib/dues.ts` | `9ceac25` | **Phase 3 — done.** `pay-sheet.tsx`, opened from a "You owe" strip on Home and from "Pay now" under a greyed Available. Saved card → `/api/settle-match` (confirmed first); otherwise `/api/create-credits-intent` + PaymentSheet. Worded around what's paid for — the web's free-amount top-up is deliberately not ported (App Store, see the Phase 3 note) |
| Profile | `app/profile/page.tsx`, `components/EditProfileSheet.tsx` | `48aca6e` | done — details, Edit Profile, card on file (SetupIntent + PaymentSheet setup mode), sign out. Reached from the avatar at the top of every tab. Not ported: Connect Google (needs dashboard redirect setup), Friends (waits for Messages) |
| Messages inbox | `app/messages/page.tsx` | `2c0990c` | Phase 5 — done. Team chat pinned above one-to-one threads, search, unread counts. Opened from the chat icon (with unread dot) beside the avatar |
| Team chat | `app/messages/team/page.tsx`, `lib/team-chat.ts` | `2c0990c` | Phase 5 — done, on `lib/team-chat.ts` unchanged. Polls every 5s while the app is in the foreground (`use-poll.ts`, AppState in place of `document.hidden`); mute / leave / rejoin via the platform's action sheet |
| One-to-one thread | `app/messages/[otherId]/page.tsx`, `lib/direct-messages.ts` | `2c0990c` | Phase 5 — done. Also polls for replies, which the web thread doesn't |
| Join requests (captain) | `JoinRequests` in `app/my-team/page.tsx` | `2c0990c` | Phase 4 — done, on My Team above the squad. Approve writes the same row, so the fee snapshot and welcome DM triggers fire |
| Team Settings | `app/my-team/settings/page.tsx` + Details / InviteLink / CoCaptains panels | `2c0990c` | Phase 4 — done. Invite link built from the website's address (`EXPO_PUBLIC_WEB_URL`, default the Vercel URL) and shared via the share sheet |
| Post announcement | `app/my-team/announcement/create/page.tsx` | `2c0990c` | Phase 4 — done, incl. @-mention suggestions. Its two queries are a copy of the web page's inline ones — keep in step. The announcements list page isn't ported (players get each one as a message) |
| Answer the availability poll | `components/AvailabilityModal.tsx`, `lib/availability-poll.ts` | `4a4e7e7` | done — a "Proposed dates" card on Home opens `poll-sheet.tsx`; same upsert, same gate (a player who owes can only unpick or send "none of these"), with Pay now linking to the pay sheet |
| Run the availability poll (captain) | `app/my-team/collect-availability/page.tsx`, `AvailabilityPollForm.tsx` | `ea826c8` | done — `poll.tsx` from My Team: answers per slot (count, Best, who's in), New poll, Close poll. Creates through the shared `createAvailabilityPoll`. Not ported: "pick dates → post matches" (match posting isn't on mobile) |
| Date + hour picker | `components/DateTimePickers.tsx` | — | `slot-picker.tsx`: next six weeks as a strip, 07:00–22:00 as a grid, whole hours only (the web convention), past hours today disabled |
| _(bridge spike)_ | `lib/match-dates.ts` | `667f757` | Phase 0 passed 12/12 on device — kept at `/spike` |

<!-- Add a row per screen as Phase 1+ lands. Suggested shape:
| Home (captain) | app/page.tsx, components/GameFeed.tsx | abc1234 | done |
| Calendar | app/calendar/page.tsx, components/CalendarSheet.tsx | abc1234 | drifted — 3 commits behind |
-->

## Phase 3 status (started 2026-09-29)

`@stripe/stripe-react-native` is installed, `StripeProvider` wraps the app in
`_layout.tsx` (test-mode key from `mobile/.env`, `urlScheme="uniter"` matching
`app.json`'s scheme), and Fill In's Join button is wired end to end with
PaymentSheet — see the table row above.

**Challenge and Enter turned out not to need any of this.** They don't run a
card payment at the moment they're pressed — the web app moves a credit hold
(Challenge) or a buy-in (Enter) out of `team_credits`, a balance the captain
tops up separately, beforehand, on its own screen
(`DuesTopUpModal`/`TeamCreditsBar`). Un-greying them is wiring two
`authedPost` calls to existing routes, not a Stripe integration — the caveat
is what happens on insufficient credit, which the web app answers by sending
the captain to a top-up sheet that isn't ported (Phase 4, the captain control
panel). **Decided 2026-09-29: they stay greyed until Phase 4**, and land
together with the top-up sheet, so the insufficient-credit case always has
somewhere real to send the captain.

**Real-device testing is still outstanding for Fill In**, and is the one thing
that can't be done from a simulator: the migration plan is explicit that both
mobile 3D Secure bugs `lib/confirm-payment.ts` exists for on the web were only
ever reproduced on a real card on a real phone. Test with a
[Stripe test card](https://docs.stripe.com/testing) that triggers 3DS
(`4000 0027 6000 3184`) before trusting this on a live key.

**How to run that test.** The deployed API runs live Stripe keys, which a
`pk_test_` key on the phone can't confirm, so payments are tested against the
web app running locally in test mode:

1. `.env.development.local` (repo root, gitignored) holds `sk_test_` /
   `pk_test_` and overrides `.env.local` for `npm run dev` only.
2. `mobile/.env` points `EXPO_PUBLIC_API_BASE_URL` at this PC's Wi-Fi address
   on port 3000. Switch it back to the Vercel URL afterwards.
3. `node mobile/scripts/ringer-test-fixture.mjs seed` — a Test-vs-Test friendly
   and one £5 ringer request, payer `testcaptain@gmail.com` (its live Stripe
   customer id is saved and cleared). **This writes to the live database** and
   the request is visible on the live Fill In feed while it exists.
4. Pay on the phone with `4000 0027 6000 3184`.
5. `node mobile/scripts/ringer-test-fixture.mjs undo` straight away.

**Testing the pay sheet is different, and messier.** A Fill In payment goes to
Uniter and never touches team credit, but a joining fee or match share is
recorded by the **Stripe webhook** (`credit_from_payment`), not by the app. A
local server gets no webhook unless the Stripe CLI forwards one
(`stripe listen --forward-to localhost:3000/api/webhooks/stripe`, with the
`whsec_` it prints as `STRIPE_WEBHOOK_SECRET` in `.env.development.local`).
Without it the payment succeeds and the sheet says it can take a minute, but
nothing is ever marked paid. With it, a test-mode payment writes real rows to
the **live** ledger (`team_credit_transactions`, `team_credits`, the
joining-fee paid column), so only test with an account in the Test team and
expect to remove those rows afterwards. There is no undo script for that yet.

**Wording (decided 2026-09-29):** every mobile payment screen names what the
money is for — "Joining fee", "vs X · your share of the pitch" — never "top
up", "credit" or "balance". The money still lands in `team_credits`. A stored
balance you add money to is what an App Store reviewer reads as a digital
wallet (Apple's own 30% payment system); a real-world pitch is exempt.

## Shared, so never listed here

These need no row because they are not copied — both apps use the same file or the same
deployed endpoint:

- `lib/` (38 files) — reached as `@/lib/*`, the same specifier the web app uses
- `contexts/` — `AuthContext` and `RoleContext` are imported and run **unchanged**, so role
  resolution cannot drift between the two clients
- `lib/*.native.ts` — platform variants (`supabase`, `hard-navigate`). Metro prefers these on a
  phone; Next's bundler does not know the convention and keeps the plain `.ts`. One import
  specifier, right implementation per platform, no web changes
- `app/api/` (20 routes) — called over HTTPS against the Vercel deployment
- `supabase_*.sql` — one database, one set of RLS policies
