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
  `TeamCreditsBar`, `PollStatusTile` (availability poll progress), next fixture with a
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
Post** on a booking.

`lib/calendar-entries.ts` merges five sources into one `CalendarEntry` shape: confirmed
friendlies (`match_posts` + `challenges` + `matches`), tournaments (`open_matches`), the
captain's still-open posts, ringer games the viewer paid into, and direct pitch bookings.

### My Team (`app/my-team/page.tsx`)

Squad, stats, upcoming fixtures, and the captain's control panel. Sub-pages:

| Route | Purpose |
|---|---|
| `/my-team/players` | Squad list → individual profiles |
| `/my-team/transfer` | Transfer Market — two-sided player/team discovery, offers, join requests, friend requests |
| `/my-team/tactics` | Team default formation + tactics board |
| `/my-team/team-profile` | Team history, play style, photo |
| `/my-team/announcements`, `/my-team/announcement/create` | Team-wide announcements (also DM'd to the squad) |
| `/my-team/collect-availability` | Captain creates an availability poll |
| `/my-team/history` | **Settle Payments** — per-fixture payment collection, not a results archive |
| `/my-team/match/[matchId]` | Manage Match — overview / squad / payment / tactics / result tabs, plus ringer requests |
| `/my-team/match/[matchId]/result` | Submit the final score, scorers, and participating squad |

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
  their shares afterwards. Invitations can carry a per-team discount.
- **Ringers** — a guest pays Unitr a **flat £5 by card**. It never touches team credit or the
  pitch split, and a ringer is excluded from settlement via `match_confirmations.is_ringer`.

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
| `supabase_match_results.sql`, `supabase_match_result_verification.sql` | Results, cross-team score verification |
| `supabase_match_suggestions.sql` | Squad players suggesting games to the captain |
| `supabase_match_tactics.sql`, `supabase_team_profile.sql`, `supabase_team_announcements.sql` | Per-match tactics, team profile fields, announcements |
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

## Technical areas still requiring real expertise

- **Stripe Connect at scale** — per-venue KYC/onboarding, live payouts, dispute handling.
  Currently test mode with one connected account per venue.
- **Pitch booking API** — real venue inventory and reservation, rather than platform-owned rows.
- **Real-time messaging** — group chats, match chats, presence, push.
- **Stats/video ingestion** — upload, transcode, storage, playback.
- **Matchmaking algorithm** — ranking opponents by stats + availability overlap.
- **League engine** — tables, fixture generation, standings.
