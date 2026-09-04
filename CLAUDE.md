# Unitr — Project Brief

A football platform providing: player-team matching, matchmaking, pitch booking, and a
stats/video social space.

This file has two halves. **Vision** is the original brief — the thing being built towards,
unchanged. **As Built** is what actually exists in the repo today, which has drifted from the
brief in several deliberate ways. When they disagree, As Built wins for describing the code;
Vision wins for describing intent.

---

# Vision

## Core Concept

Users create a profile and create teams or join existing teams. Existing teams can register
on the platform and find players. Once registered, teams gather availabilities within their
team and post a game so other teams with matching availability can find it and match
together. The posting team uses a booking.com-style pitch booking platform to choose a pitch.
Once a match is fixed, Stripe takes split payments from each player for the pitch fee. A
stats/video social space lets teams and players track each other's performance, feeding
better matchmaking and player-team matching, and eventually leagues.

## Guiding constraints

- For payment and pitch booking features that need real APIs and customers, **dummy/test data**
  is fine — the point is to show how it would work.
- The goal is **an iteration that visualises the idea**, not a production platform. A large
  part of the value is identifying which functions need real technical expertise.

## Still unbuilt (from the original brief)

- **Social feed** — the scrollable stats/video feed on Home, and posting highlights to it.
- **Leagues** — tables, standings, a fixture generator.
- **Group chats** — team chat and match chat between captains. Messages is 1:1 only today.
- **Video ingestion** — upload/processing/playback of match footage.
- **Availability-based matchmaking** — availability is collected and shown, but no algorithm
  ranks opponents by it. Only a per-post "matches availability" badge exists.

---

# As Built

## Navigation

Bottom nav has **three** tabs, not five:

| Tab | Route | What it is |
|---|---|---|
| Home | `/` | Role-specific dashboard + the game discovery feed |
| Calendar | `/calendar` | Every commitment, upcoming and past |
| My Team | `/my-team` | Squad, tactics, money, management |

Messages (`/messages`) and Profile (`/profile`) moved to the **TopBar** — a message icon and
an avatar menu, alongside a notification bell. Search lives at `/search`, reached from the
Transfer Market rather than Home.

Venue managers never see this nav at all; they're redirected into `/venue/*` (see below).

### The Play page no longer exists

`/play` was removed. Its two jobs were split:

- **Discovery** (browse matches / tournaments / fill-in games) moved onto **Home**, as
  `components/GameFeed.tsx`.
- **"What am I booked into"** became the **Calendar**.

The `/play/*` **sub-routes still exist and are still used** — `/play/create`,
`/play/create-tournament`, `/play/tournament/[id]`, `/play/edit/[postId]`. Only the index
page was deleted. Don't "clean these up" without a reason; ~15 call sites point at them.

## Roles

`contexts/RoleContext.tsx` derives one of four roles, checked in this order:

- `venue_manager` — `profiles.account_type`; skips all player logic
- `captain` — captains a row in `teams`
- `player` — has an approved `team_members` row
- `new_user` — signed in but teamless, or signed out

Role decides which Home renders, whether the "Your posts" filter appears on the Calendar,
and whether an action is a real button or a greyed slot. **Greyed rather than hidden** is the
house convention — a missing element shifts everything around it and breaks muscle memory
(see `components/QuickNav.tsx`).

## Pages

### Home (`app/page.tsx`)

Three variants keyed off role, all sharing the same skeleton: quick-nav row → status strips
→ feed.

- **new_user** — register-a-team CTA, `TeamsPanel` (teams to join), pending join-request
  status, and the Fill In feed with Matches/Tournaments greyed to show what a team unlocks.
  Signed-out users get the same shape behind a landing hero; tapping anything raises the
  sign-up gate.
- **player** — `PlayerActionStrip` (what the captain needs from you), **next fixture only**,
  then `GameFeed` where the action is "Suggest to team" rather than entering directly.
- **captain** — join-request strip, `SuggestionsStrip` (squad suggestions to review),
  `TeamCreditsBar`, `PollStatusTile` (poll progress **and** availability for games already
  committed to), next fixture with a
  "Manage match" CTA, then `GameFeed` with real actions (Challenge / Enter) and the captain's
  own live post pinned above.

Home deliberately shows **only the next fixture** — everything else is the Calendar's job.

### Calendar (`app/calendar/page.tsx`)

Owns every commitment the viewer has. **Upcoming always renders above Past**, and both
sections stay on screen when empty so the page keeps a fixed shape.

Filter chips: **All · Friendlies · Tournaments · Your posts · Ringer · Pitch bookings**.
"Your posts" only renders for captains.

A 📅 pill opens `components/CalendarSheet.tsx`, a month grid with a coloured dot per entry
type on each date; picking a date scopes both sections to it.

Tapping any entry opens `components/FixtureDetailSheet.tsx` — basic detail for everyone, plus
the management CTA the viewer is entitled to: **Manage match** → `/my-team/match/[matchId]`,
**Submit result**, **Manage tournament**, **Edit / Take down post**, or **Turn into Match
Post** on a booking. A tournament entry also lists the team's own games in it, each opening
`/my-team/tournament-match/[fixtureId]`.

`lib/calendar-entries.ts` merges five sources into one `CalendarEntry` shape: confirmed
friendlies (`match_posts` + `challenges` + `matches`), tournaments (`open_matches`), the
captain's still-open posts, ringer games the viewer paid into, and direct pitch bookings.

Upcoming friendlies and **entered tournaments** carry Available / Unavailable buttons on the
card and in the sheet — see Availability below. A tournament the team only *hosts* doesn't:
organising isn't entering, and an organiser buys into its own tournament like anyone else.

### My Team (`app/my-team/page.tsx`)

Squad, stats, upcoming fixtures, and the captain's control panel. Sub-pages:

| Route | Purpose |
|---|---|
| `/my-team/players` | Squad list → individual profiles |
| `/my-team/transfer` | Transfer Market — two-sided player/team discovery, offers, join requests, friend requests |
| `/my-team/tactics` | Team default formation + tactics board |
| `/my-team/settings` | **Team Settings** — team history, play style, photo, joining fee, invite link (was `/my-team/team-profile`) |
| `/my-team/announcements`, `/my-team/announcement/create` | Team-wide announcements (also DM'd to the squad) |
| `/my-team/collect-availability` | Captain creates an availability poll |
| `/my-team/history` | **Settle Payments** — per-fixture payment collection, not a results archive |
| `/my-team/match/[matchId]` | Manage Match — overview / squad / payment / tactics / result tabs, plus ringer requests |
| `/my-team/match/[matchId]/result` | Submit the final score, scorers, and participating squad |
| `/my-team/tournament-match/[fixtureId]` | Manage Tournament Fixture — the same info / attendance / lineup / tactics surface for one game inside a tournament |

#### Tournament fixtures

A tournament is **one commitment but several games**. The commitment is the `open_matches`
row — one buy-in, one Calendar entry, one availability answer. The games are
`tournament_matches` rows, drawn up by the organiser on `/play/tournament/[id]`.

`/my-team/tournament-match/[fixtureId]` is the per-game surface, deliberately the same shape
as `/my-team/match/[matchId]`: the captain picks a formation and lineup, everyone else reads
it, and both see the kickoff slot, referee and score. Two things it does **not** duplicate:

- **Availability is per tournament, not per fixture.** The squad answers once for the day
  against `open_match_id`; the page shows that tally and lets the viewer change their own
  answer, but never asks a second question.
- **Results belong to the organiser.** Scores go in on `/play/tournament/[id]` and nowhere
  else, so there's no Submit Result here — only the score once it exists.

Reached from all three places a friendly's manage page is: the tournament's schedule rows,
the Calendar (`FixtureDetailSheet` lists the team's own games under the tournament entry),
and My Team's Manage Match tab — all through `components/TournamentFixtureList.tsx`.
`lib/tournament-match.ts` is the only place a fixture, its team-side test, or its saved plan
is read or written.

#### Invite links

A captain's team has one invite link, `/join/<code>`, minted on first view of Team Settings
and rotatable from there. Opening it **joins the squad directly** — no join request to
approve, because handing over the link *is* the approval. The code is a bearer token, which
is why it's a secret rather than the team uuid and why resetting exists.

`app/join/[code]/page.tsx` serves two arrivals from the same URL: signed out gets a team
preview plus Create account / Sign in (the code rides on `?invite=`, with a localStorage
backstop for an email-confirmation round trip); signed in redeems on mount and the page is
the receipt. Auth pages never join — they redirect back to `/join/<code>`, so one screen
decides what an invite means.

A link join writes the same approved `team_members` row the Approve button writes, so the
joining-fee snapshot and welcome DM fire unchanged — the new member still owes the fee.
Refused cases (captains, players already in a squad, venue accounts) are plain sentences,
not errors; one approved membership per player is an invariant `RoleContext` depends on.

### Book (`app/book/page.tsx`)

Booking a pitch outright, no opponent needed. Purely the browser (`BookPitchPanel`) — the
resulting bookings are listed on the Calendar, not here. A booked pitch can be turned into a
**secured match post** that any team can join immediately, with no credit hold.

### Messages / Profile

- `/messages` — **1:1 direct messages only**. Payment reminders and announcements arrive here
  as DMs. Group and match chats are not built.
- `/profile` — profile info, saved payment method (Stripe SetupIntent), season stats, badges,
  highlights. The stats are display-level; there's no ingestion pipeline behind them.

### Venue portal (`app/venue/*`)

A separate app for pitch owners with its own layout and nav — calendar, bookings, customers,
open matches, academy, store, reports, settings. Venue managers are hard-redirected here from
any player route.

### Admin

`/admin/finance` — reconciliation view over the credit ledger and Stripe transfers.

## Availability

Two records, one question — "am I playing?". `lib/event-availability.ts` is the only place
that reads or writes either.

- **The poll** (`availability_requests` / `availability_responses`) asks which of several
  **proposed** dates a player could make. A captain creates one from `PollStatusTile` or
  `/my-team/collect-availability`. A team has exactly one live poll; posting new dates
  replaces it.
- **The fixture answer** (`match_confirmations`, status `confirmed | declined | pending`)
  is per game and stays editable up to kickoff. A friendly keys off `match_id`, a tournament
  entry off `open_match_id` (`supabase_event_availability.sql`) — a tournament has no
  `matches` row.

**The poll is optional.** A captain who takes a match off the feed or enters a tournament
outright never runs one, so committing the team is what raises the question:

- Accepting a challenge writes a pending row per squad member on both sides
  (`ChallengePanel`).
- Entering a tournament does the same (`/api/tournaments/join`), as does creating one and
  entering your own team (`/play/create-tournament`).
- Both then call `seedAvailabilityFromPoll`: if a live poll proposed **that same date**, its
  answers carry straight over — a yes becomes Available, an answer that skipped the date
  becomes Unavailable, a non-reply stays pending. Nobody is asked the same question twice.

Everyone in the squad sees the same list, wherever they are: `AvailabilityList` on Home
(inside `PlayerActionStrip` for players, `PollStatusTile` for the captain, who is a squad
member too), and `AvailabilityButtons` on each Calendar card and in `FixtureDetailSheet`.
The captain's copy carries the squad's tally per game (`loadSquadAnswerCounts`), and
`/my-team/tournament-match/[fixtureId]` shows the same tally as a named list when the captain
is picking a lineup for one of the tournament's games.

Settle Payments reads the fixture's own answers first and falls back to the poll only when
nobody answered the fixture (`SettlePaymentsModal`).

## Payment model

This is the area that diverged **most** from the brief. The brief says "split payments from
each player at match confirmation". What's built is a **two-phase credit model**, because
collecting from 10–22 people is far too slow and failure-prone to gate a booking on.

**Booking runs on team credit. Settlement runs on individual payments.**

1. **Hold** — the posting team's full pitch fee is earmarked from `team_credits`
   (`balance_pence` / `reserved_pence`) when the post goes live.
2. **Capture & settle** — on match confirmation the hold is captured and the challenging
   team's half is transferred team-to-team.
3. **Replenish** — each player who actually played refills their own team's credit. Either
   they top up manually, or their **saved card is charged off-session** at roster lock
   (`supabase_card_on_file.sql`).
4. **Venue payout** — Unitr transfers the pitch fee to the venue's **Stripe Connect** account
   (`supabase_venue_payouts.sql`). One connected account per venue. Test mode only; real
   payouts need KYC/onboarding and a fintech review.

Everything is in **pence**, everywhere. Unitr's fee is **5%**, added on top of the split.

Variants:
- **Secured posts** — the poster already paid the venue in cash via `/book`, so the flow skips
  hold/capture; the challenger simply reimburses their half on join
  (`reimburse_secured_pitch`).
- **Tournaments** — a flat per-team buy-in comes out of team credit at join; the squad settles
  their shares afterwards. Invitations can carry a per-team discount. Entry is written in
  exactly two places (`supabase_tournament_entry_lockdown.sql`): `/api/tournaments/join` for
  anything paid, and the `enter_own_tournament` RPC for an organiser fielding a team in their
  own tournament, where there is no buy-in to take. `open_match_teams` takes no client
  inserts — an open policy there meant a team could enter a paid event for free.
- **Ringers** — a guest pays Unitr a **flat £5 by card**. It never touches team credit or the
  pitch split, and a ringer is excluded from settlement via `match_confirmations.is_ringer`.
- **Refunds** — money can go back out, two ways, both through `refund_credit`
  (`supabase_refunds.sql`), idempotent on the Stripe refund id. **Cash-out**:
  `/api/credit/refund` + `CashOutModal` hands leftover team credit back to the cards
  that funded it — an equal amount each, capped at what that player personally paid,
  with the remainder re-shared (`allocateEqually` in `lib/team-refunds.ts`). Cash the
  captain recorded by hand has no card behind it and stays in the balance. **Reversal**:
  `charge.refunded` at the webhook takes back the credit any refunded payment granted,
  including one made by hand in the Stripe dashboard — this one is allowed to drive the
  balance negative, because the money has already gone and the team owes it. Joining-fee
  `paid` figures are deliberately never reversed.
- **Joining fees** — a captain can set a one-off fee (`teams.joining_fee_pence`) asked of each
  new member. It is not a separate pot: paying it is a top-up into team credit. The fee owed is
  snapshotted onto `team_members.joining_fee_due_pence` at approval (trigger), and
  `joining_fee_paid_pence` is advanced **only inside** `credit_from_payment` /
  `record_cash_credit` — deposits pay the joining fee down first. A member with an unpaid fee
  can't join or vote available for games (`AvailabilityButtons`, `AvailabilityModal`); the
  captain sees per-member fee status in Settle Payments.

`payment_collection_status` is a **bookkeeping checklist** the captain ticks off — it does not
move money or call Stripe. The real settlement is the credit ledger.

## Data model

Migrations live as `supabase_*.sql` at the repo root. All are **idempotent — safe to re-run**,
and are applied by hand in the Supabase SQL editor. RLS is permissive throughout, matching the
prototype's threat model.

Core chain: `match_posts → challenges → matches → match_confirmations`.

| File | Adds |
|---|---|
| `supabase_credit_ledger.sql` | `team_credits`, signed `team_credit_transactions`, hold/capture/settle/replenish functions |
| `supabase_card_on_file.sql` | Saved cards on `profiles`, roster-lock settlement |
| `supabase_payment_collection.sql` | `payment_collection_status`, `messages` (DMs) |
| `supabase_dues_settlement.sql` | Partial dues credit via top-up |
| `supabase_venue_payouts.sql` | `venue_transfers`, Connect account on `pitches` |
| `supabase_secured_posts.sql` | `pitch_secured` posts + reimbursement |
| `supabase_open_matches.sql`, `supabase_tournament_*.sql` | Tournaments, schedules, referees, invitations, notifications |
| `supabase_ringers.sql` | `ringer_requests`, `ringer_signups`, `is_ringer` |
| `supabase_transfer_market.sql` | `player_offers`, `friend_requests` |
| `supabase_tournament_entry_lockdown.sql` | Closes client inserts/deletes on `open_match_teams`; `enter_own_tournament` RPC for the organiser's own free entry; run after `supabase_open_matches.sql` |
| `supabase_refunds.sql` | `refund_credit`, `team_card_contributions`, refund columns on the ledger; run after `supabase_joining_fees.sql` |
| `supabase_joining_fees.sql` | `teams.joining_fee_pence`, fee snapshot + paid tracking on `team_members`, approval-time DM, deposits applied to fee first (redefines `credit_from_payment` / `record_cash_credit`; run after `supabase_payment_integrity.sql`) |
| `supabase_team_invites.sql` | `teams.invite_code` + the four invite-link RPCs (`ensure_`/`rotate_team_invite_code`, `team_by_invite_code`, `join_team_by_invite`); run after `supabase_joining_fees.sql` |
| `supabase_event_availability.sql` | `match_confirmations.open_match_id` — a confirmation targets a match **or** a tournament entry; run after `supabase_open_matches.sql` |
| `supabase_match_results.sql`, `supabase_match_result_verification.sql` | Results, cross-team score verification |
| `supabase_match_suggestions.sql` | Squad players suggesting games to the captain |
| `supabase_match_tactics.sql`, `supabase_team_profile.sql`, `supabase_team_announcements.sql` | Per-match tactics, team profile fields, announcements |
| `supabase_tournament_match_tactics.sql` | `match_tactics.tournament_match_id` — a lineup targets a friendly **or** a tournament fixture; run after `supabase_match_tactics.sql` and `supabase_tournament_schedule.sql` |
| `supabase_pitches.sql`, `supabase_venue.sql` | Pitches, weekly availability |

## Conventions worth knowing

- **Dates are two shapes.** Newer rows store ISO `"2026-07-30"`; older ones store the display
  string the picker produced, `"Wed, 03 JUN 2026"`. Compared raw, `"W" > "2"`, so every legacy
  row sorts as if it were in the future — forever. **Always** normalise through
  `lib/match-dates.ts` (`toDateKey`, `isUpcomingDate`, `sortKey`, `fmtKickoff`,
  `isKickoffPast`). Kickoff comparisons use Europe/London wall-clock strings so the answer
  never depends on the viewer's device timezone.
- **No Supabase embedded selects across unregistered FKs.** `teams.captain_id → profiles` and
  several others have no relationship in the schema cache; embedding them fails the *whole*
  query with PGRST200. Fetch separately and merge.
- **Missing migrations degrade, they don't crash.** Selecting from a table that isn't there
  fails the query — features guard for it and disable the button with an explanation
  (see `useSuggestions` in `GameFeed.tsx`, `RingerRequestPanel`).
- **z-index floor.** TopBar and BottomNav are `z-40` chrome; every sheet/modal is `z-[60]`,
  above them. At equal z the nav silently paints over the bottom of a sheet.
- **Money is pence, integers, everywhere.** Never floats, never pounds in the DB.
- **PaymentIntents pin `allow_redirects: "never"`.** Every confirm in the app is
  `confirmPayment({ redirect: "if_required" })` with no `return_url`, so a redirect-based
  method (Klarna, iDEAL) would error instead of paying. Test mode hides this — a live
  account offers whatever is enabled on it.
- **Every API route authenticates its caller.** RLS is `using (true)` and the anon key is
  public, so the API routes are where authorisation actually happens. A route identifies the
  caller with `getCallerId` / `getCaller` from `lib/api-auth.ts` (the Supabase JWT in the
  `Authorization` header — never an id from the body) and checks entitlement with
  `isTeamCaptain`, `isTeamMember`, `ownsPitch` or `isAdmin` from the same file. The browser
  side is `authedPost` / `authedDelete` / `authedGet` in `lib/authed-fetch.ts` — a plain
  `fetch("/api/…")` from a component is a bug, it will 401.
- **Amounts are derived server-side, never believed.** The payer, their Stripe customer and
  the amount all come from the session and the database. `/api/connect/venue-transfer` is the
  sharp end: it moves real money out of the platform balance, so it caps every transfer at
  `payoutCeilingPence` — what the referenced booking or tournament actually costs — and
  refuses callers with no stake in the fixture. The transfer itself lives in
  `lib/venue-payout.ts` so `/api/tournaments/join` can pay a venue by calling the function
  rather than forging an HTTP request to a route that now demands a session.

## Technical areas still requiring real expertise

- **Stripe Connect at scale** — per-venue KYC/onboarding, live payouts, dispute handling.
  Currently test mode with one connected account per venue.
- **Pitch booking API** — real venue inventory and reservation, rather than platform-owned rows.
- **Real-time messaging** — group chats, match chats, presence, push.
- **Stats/video ingestion** — upload, transcode, storage, playback.
- **Matchmaking algorithm** — ranking opponents by stats + availability overlap.
- **League engine** — tables, fixture generation, standings.
