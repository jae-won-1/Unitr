# Uniter — React Native migration plan

## Decision (context for whoever starts this)

Discussed and settled 2026-09-21: **React Native, not Capacitor.** Capacitor wraps the
existing Next.js app in a native WebView shell — fast, low-risk, but still renders through
a browser layout engine, so it can't get past that ceiling. React Native renders with actual
native views, so it's the only path to a genuinely smooth, native-feeling app. This is an
end state for the client layer, not a stepping stone to something else later — companies at
real commercial scale (Shopify, Discord, Coinbase) ship RN permanently.

Recommended stack: **Expo (managed) + Expo Router + NativeWind + EAS Build.**
- Expo Router's file-based routing mirrors the Next.js App Router closely, which shortens
  the mental-model gap when porting `app/*`.
- NativeWind lets most existing Tailwind class strings work close to as-is on RN primitives,
  cutting rewrite cost on the styling side.
- EAS Build means iOS builds don't require a local Mac — build in the cloud, which matters
  since this project's dev machine is Windows.

Settled alongside it, same day:

- **Layout:** same repo, new `mobile/` folder. Not a copy, not a monorepo restructure.
- **v1 store scope:** player-facing only. `/admin/*` and `/venue/*` stay on web.
- **Platform:** build both from day one; Play internal testing gets testers first
  (review in hours) with TestFlight following.

## Coexistence and sync strategy

The web app must stay live and developable throughout — it runs real tournaments. It is the
fallback, and it stays the fallback by *not being touched*, not by being duplicated.

```
unitr/                  ← Vercel still builds this, unchanged
├── app/                ← web UI           (web only)
├── components/         ← web UI           (web only)
├── app/api/            ← stays here; mobile calls it over HTTPS
├── lib/                ← SHARED — both apps import the same files
├── contexts/           ← SHARED
├── supabase_*.sql      ← shared backend
└── mobile/             ← Expo app. Own package.json. Next never compiles it.
```

**Why not a filesystem copy.** A copy is what *creates* the drift problem it appears to
solve: every joining-fee or availability-gate fix would have to be hand-carried across
forever. The two apps share no build, no bundler and no `node_modules`, so RN work cannot
break the web app — the isolation a copy would buy already exists.

`mobile/` resolves `@/lib/...` up to the same file on disk via Metro's `watchFolders`, so
shared logic is shared by identity, not by synchronisation.

**Branch discipline that keeps merges conflict-free:**

1. Portability shims to `lib/` land on **`main`** first — small, web-safe, proven by the web
   build. Never on the mobile branch.
2. The `mobile` branch only ever **adds** `mobile/`. It never edits a web file.
3. `git merge main` into `mobile` therefore never conflicts. Run it weekly.

**What syncing costs, by layer:**

| Layer | Lines | Sync cost |
|---|---|---|
| `app/api/` (20 routes) | 2,154 | **Zero** — mobile calls the deployed Vercel API |
| `supabase_*.sql` | — | **Zero** — same database, same RLS |
| `lib/` (38 files) | 4,787 | **Zero** — literally the same files |
| `contexts/` | 174 | Near-zero |
| `app/` pages + `components/` | **30,160** | **Manual re-port** — the only real drift |

**Tracking the UI drift.** There is no automatic sync for UI — a `div` tree cannot merge into
a `View` tree. Instead every ported screen records the `main` SHA it was ported from, in
`mobile/PORTED.md`. `git diff <sha>..main -- app components` then prints the exact re-port
list at any moment. Drift becomes a checklist, not a fear.

**The lever the user controls:** during the port, work that lands in `lib/`, `app/api/` or
SQL is free — both apps get it. Brand-new *screens* on web are the expensive kind, and each
one lengthens the re-port tail. Gratuitous renames or moves inside `components/` are worse
than they look: they make the drift diff unreadable.

## What does NOT change

The backend stays exactly as it is. The RN app is a new client hitting the same server:

- All 20 routes in `app/api/` stay on Vercel, untouched. The RN app calls them the same way
  the web app does today, via `authedPost`/`authedGet`/`authedDelete`-equivalents.
- Supabase schema, RLS, and every `supabase_*.sql` migration are backend-only and unaffected.
- `lib/` (~4,800 lines across 38 files) is mostly portable — it's business logic, not UI:
  `lib/team-leadership.ts`, `lib/event-availability.ts`, `lib/joining-fee.ts`,
  `lib/availability-gate.ts`, `lib/match-dates.ts`, `lib/uniter-fee.ts`, etc. carry over with
  light adjustment. The exceptions are anything that assumes a browser: `localStorage` calls
  (`lib/pending-payment.ts` uses this for the Stripe resume-banner flow) need an
  `AsyncStorage`-backed equivalent, and `lib/confirm-payment.ts` /
  `lib/stripe-customer.ts` need their Stripe Elements calls swapped for the RN SDK (see below).

## What has to be rewritten

`app/` (74 files) + `components/` (45 files) — roughly 32,000 lines — is the UI layer and
essentially all of it needs porting screen-by-screen: no `div`/`span`, no CSS/Tailwind engine,
no DOM APIs, no Next.js file router, no `react-leaflet`. This is the bulk of the work, but
it's a systematic port, not a redesign — the same screens, same data flow, same Supabase
queries, rendered with `View`/`Text`/`Image` + NativeWind classes instead of JSX-to-DOM.

### Known trouble spots (flag these before starting each one)

- **Payments** — `lib/confirm-payment.ts`, `lib/save-card.ts`, and every screen using
  `PaymentElement` (`components/SaveCardPrompt.tsx`, the top-up sheet, dues top-up, ringer
  checkout, pitch booking, `/pay/[matchId]`) currently go through `@stripe/stripe-js` +
  `confirmCardPayment`/`confirmCardSetup` — the hand-built wrappers exist because of two
  real 3D-Secure bugs on mobile web (see CLAUDE.md's Payment model section). RN uses
  `@stripe/stripe-react-native` instead, with different components and its own
  3DS/off-session behavior — re-verify those two bugs don't reappear in a different form
  under the native SDK; don't assume the web fix transfers as-is.
- **`components/DateTimePickers.tsx`** — the custom hour/minute dial every screen relies on
  (booking, polls, venue opening rules, admin event creation) needs a native equivalent;
  don't reach for a native `<input type="time">` analog since there isn't one, and the
  existing convention (whole-hour default, `minuteStep={5}` opt-in) should carry over
  behaviorally even though the widget is rebuilt.
- **Maps** — `react-leaflet` (pitch location display/picking) has no RN equivalent; replace
  with `react-native-maps` or Expo's location/map modules.
- **Supabase auth session storage** — `@supabase/supabase-js` defaults to browser
  `localStorage` for session persistence; RN needs it configured with
  `@react-native-async-storage/async-storage` or Expo SecureStore instead, done once at
  client init.
- **Icons/splash** — the existing PWA icon pipeline (`scripts/generate-icons.mjs`,
  `assets/icons/`, `app/manifest.ts`, `app/apple-icon.png`, `app/icon.png`) becomes native
  app icon + splash screen config in Expo's `app.json`/`app.config.ts`. The source art
  carries over; the export pipeline doesn't.
- **Push notifications** — the app currently has none in the web build (see the bell
  notification system, which is in-app only). Native push (APNs/FCM via Expo Notifications)
  is new capability, not a port — decide scope (which events page: refunds, match
  confirmations, chat?) before building it.
- **Navigation shape** — the three-tab bottom nav (Home/Calendar/My Team) + TopBar
  (Messages/Profile/notifications) described in CLAUDE.md's Navigation section maps
  reasonably directly to Expo Router's tab + stack navigators, but the venue-manager
  hard-redirect (`RoleContext` sending venue accounts into `/venue/*`) and the admin routes
  need an equivalent role-gated navigator setup, not just copied route strings.
- **Polling-based team chat** — `lib/team-chat.ts` polls every 5s while the tab is visible.
  On native there's no "tab visibility" API in the same sense; use `AppState` to pause/resume
  polling when backgrounded, or consider this the natural point to revisit whether Supabase
  realtime gets turned on instead of polling.

## Suggested phase order

0. **Foundation — no RN screens yet.** Create `mobile/` with the Expo scaffold; **prove
   shared-`lib` resolution actually works across Metro before anything is built on it**
   (import `lib/match-dates.ts` from a mobile screen and run it — this is the spike the whole
   layout rests on). Add the storage shim the three browser-API `lib` files need, on `main`.
   Exclude `mobile` from the web `tsconfig.json` `include` glob — it currently sweeps
   `**/*.ts` and would typecheck RN files against the web config. Tag the current state
   `web-fallback`. Small and entirely reversible.
1. **Scaffold** — new Expo Router project, Supabase client with AsyncStorage session
   persistence, auth screens (sign in/up, the `/join/[code]` invite flow), role resolution
   (`RoleContext` equivalent).
2. **Read-heavy core** — Home feed, Calendar, My Team squad view — validates data fetching
   and navigation shape before touching money.
3. **Payments** — top-up, joining fee, settle payments, booking checkout. Do this as its own
   phase because of the native Stripe SDK swap above; test on real devices/cards before
   moving on, the same way the web 3DS bugs were only ever caught on real cards.
4. **Team management surfaces** — Team Settings, tactics, announcements, tournament fixture
   management, ringers.
5. **Messages** — 1:1 threads + team group chat (polling → `AppState`-aware).
6. **Admin + venue portal** — **out of v1 scope.** These stay on the web app, where the
   operators who use them already work. Revisit after the first release.
7. **Store submission** — Play internal testing track first (review in hours), TestFlight
   second (review in days), then public release.

## Phase 0 outcome (done — 2026-09-21)

Scaffolded `mobile/` on Expo SDK 57 (RN 0.86, React 19; the web app stays on React 18 in its
own dependency tree). `web-fallback` tag cut and pushed at `667f757`. Root `tsconfig.json`
now excludes `mobile` — its `include` was `**/*.ts`, which would otherwise typecheck RN files
against the web's DOM config. Web app re-typechecked clean after that change.

**The bridge works.** `mobile/src/app/index.tsx` imports `@shared/lib/match-dates` — the same
file `app/calendar/page.tsx` uses — and Metro bundles it: 11/11 checks pass, executed from the
shared module. Shared logic is confirmed shared by identity, not copied.

Three things worth keeping:

- **Metro must use `resolver.blockList`, not `disableHierarchicalLookup`.** The goal is to
  stop Metro walking up into the web app's React 18. `disableHierarchicalLookup: true` does
  that but is too blunt — it also breaks *nested* resolution inside `mobile/node_modules`.
  Concretely: npm hoists `semver@6` to the top while `react-native-reanimated` needs `semver@7`
  from its own nested copy; with hierarchical lookup off, reanimated gets v6, finds no
  `semver/functions/satisfies` (a v7-only path) and the bundle dies with an error that looks
  nothing like its cause. Blocking the one parent directory keeps nested resolution intact.
- **Never assert exact formatted date strings.** `toLocaleDateString` with `weekday: "short"`
  renders `"Sat 13 Jun"` on Node 24 and `"Sat, 13 Jun"` in browsers — the separator moves with
  the engine's ICU version, and Hermes is a third data point. `fmtKickoff` output is therefore
  matched on its meaningful parts, not character-for-character. Any later UI test over dates
  should do the same.
- **Hermes `Intl` — VERIFIED on device, 12/12.** The desk run only proved Node (Expo's static
  web render) has full ICU, which says nothing about the phone; only `hermesc` (the compiler)
  ships in `node_modules`, so it could not be settled off-device. Run through Expo Go on a
  real handset, **all 12 checks pass** — including both Intl checks below. Hermes on SDK 57
  therefore has the ICU support `lib/match-dates.ts` needs, and the date logic is correct on
  device no matter which timezone a player opens the app from.

  Kept here because the reasoning is what makes the result meaningful, and because a future
  SDK bump or a switch to a slimmer Hermes build could reintroduce either failure. There is
  exactly one `timeZone` usage in the whole codebase — `lib/match-dates.ts:60` — and it leans
  on Intl twice, with very different stakes:

  1. **The `sv-SE` locale — blocking, and unaffected by where the app is used.** Swedish
     formatting is chosen because it yields a sortable `"YYYY-MM-DD HH:mm:ss"`. If Hermes
     lacks the locale and falls back to en-US (`"1/15/2026, 12:00:00 PM"`), the string
     comparison in `isKickoffPast` inverts — `"2026-…" < "1/15/…"` is false — and **nothing is
     ever past**. `GameFeed` stops filtering played games, `event-availability` keeps every
     finished fixture in Upcoming, `SuggestionsStrip` suggests games that already happened,
     and the event take-down button never hides after kickoff, which is a refund path. This
     fails in London exactly as badly as anywhere else.
  2. **The `timeZone` option — not blocking while the app is UK-only.** If Hermes ignores it,
     the fallback is device-local time, and for players in London on UK-set phones that *is*
     Europe/London. Checked anyway because it costs nothing and becomes load-bearing the
     moment anyone opens the app from another timezone.

  Minor, same family: `lib/event-revenue.ts:102` formats money with
  `toLocaleString(undefined, { minimumFractionDigits: 2 })`. If Hermes ignores those options,
  £12.50 renders as "£12.5" — cosmetic, but on money, so worth a look on device.

## Non-coding prerequisites (the user's side, not Claude Code's)

- **Apple Developer Program** ($99/yr) — start immediately, longest lead time in the whole
  project. Enrolling as a company requires a D-U-N-S number, which can take weeks, and this
  blocks TestFlight entirely.
- **Google Play Console** ($25 one-time).
- EAS account for cloud iOS builds (no local Mac needed).
- Physical device testing, especially for payments/3DS, push, and camera/location permissions
  if those get used — simulators don't reproduce real-card 3DS behavior, per the existing
  web experience.
- Apple/Google store listing assets (screenshots, description, privacy labels — the app
  handles payment data and location, both must be declared) and review cycle iteration —
  budget for at least one rejection-and-resubmit round.

## The in-app-purchase trap — the biggest release risk

Apple takes 30% on **digital** goods bought in-app and forces them through its own payment
system. Pitch bookings and tournament buy-ins are **real-world services** and are exempt, the
same way Uber and Airbnb are — Stripe stays. But this is the most common rejection reason for
booking apps, and whether a reviewer sees a real-world service or a digital currency depends
on **how the app words what money buys**.

The current model is the risky shape: "team credit", "top up", a balance in `team_credits`
that is spent later. Read cold by a reviewer, a stored balance spent inside the app looks
exactly like a digital wallet. The mechanism can stay — the framing has to make the
real-world pitch the thing being paid for, at every surface a reviewer touches, plus the
store listing.

Decide this **before** building the payment phase, not at submission: rewording screens is
cheap, restructuring the credit model after a rejection is not.

## Starting this later

When asked to start: confirm Expo + Expo Router + NativeWind is still the intended stack
(this doc doesn't re-derive that decision), then begin at Phase 0. Re-read this file and the
current state of `app/`, `components/`, and `lib/` first — the web app will keep evolving in
the meantime and file/line references elsewhere in the repo's other planning docs won't hold,
but the phase order and trouble-spot list here should still apply.
