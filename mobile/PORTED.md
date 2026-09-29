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
| Sign in / create account | `app/login`, `app/register` | `008f735` | Phase 1 — email+password only; the registration questionnaire lands with the profile screens |
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
| My Team — squad + details | `app/my-team/page.tsx` | `fe97d03` | Phase 2 — done. Captain control panel is Phase 4 |
| Leave team | `components/my-team/LeaveTeamPanel.tsx` | `fe97d03` | done — shares `lib/leave-team.ts`, `lib/availability-gate.ts`, `lib/hard-navigate.native.ts` unchanged |
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
