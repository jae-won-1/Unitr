# Uniter — Project Brief

## Working with Codex and Claude Code

Before making changes, read `AGENTS.md` for shared development and collaboration
instructions and `docs/HANDOFF.md` for current progress and validation. This file
remains the shared product and architecture reference for both tools. Update it
when behaviour changes; record session state in the handoff. See `README.md` for
local setup. Historical plans may be superseded by the implementation.

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
- **Match chats** — the chat between two captains around a fixture. The **team** group chat
  is built (see Messages below); a match chat is not.
- **Video ingestion** — upload/processing/playback of match footage.
- **Availability-based matchmaking** — availability is collected and shown, but no algorithm
  ranks opponents by it. Only a per-post "matches availability" badge exists.

---

# As Built

## Home-screen icon

The installed web app uses the selected U and football artwork in the previous
home-screen icon's bright `#00E676` green (the UI remains `#008000`).
`assets/icons/` holds the source PNGs and edit prompts;
`node scripts/generate-icons.mjs` exports the committed Apple touch icon (180 px),
browser icon (512 px), and manifest icons (actual 192/512 px files). Android has a
separate padded maskable export; `app/manifest.ts` selects it. `app/apple-icon.png`
and `app/icon.png` supply Next.js metadata links automatically. The manifest keeps
standalone launch mode. Icon generation is a manual development step, not a build
dependency; changing a local icon requires deployment before users receive it.

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

`contexts/RoleContext.tsx` derives one of five roles, checked in this order:

- `venue_manager` — `profiles.account_type`; skips all player logic
- `admin` — `profiles.account_type`; takes precedence over team leadership
- `captain` — captains a row in `teams`, **or** is an approved member with
  `team_members.is_co_captain`
- `player` — has an approved `team_members` row
- `new_user` — signed in but teamless, or signed out

Role decides which Home renders, whether the "Your posts" filter appears on the Calendar,
and whether an action is a real button or a greyed slot. **Greyed rather than hidden** is the
house convention — a missing element shifts everything around it and breaks muscle memory
(see `components/QuickNav.tsx`).

### Co-captains

A captain can promote approved squad members to co-captain from Team Settings
(`components/my-team/CoCaptainsPanel.tsx` → the `set_co_captain` RPC). A co-captain has the
captain's authority **everywhere except appointing other co-captains** — that stays with the
person who was handed the team. They reach the `captain` role, so every captain screen and
CTA is theirs; `useRole().isCoCaptain` is the only place the two are told apart, and the only
thing it changes is that panel.

Two rules make that work without rewriting every query, both living in
**`lib/team-leadership.ts`**:

1. **"The team I run" is resolved there**, never by `.eq("captain_id", user.id)` at the call
   site — a co-captain captains no team, so that lookup finds nothing for them. Use
   `loadLedTeam(userId, cols)` (drop-in for that query) or `loadLeadership(userId)`, which
   returns `{ teamId, captainId, isCaptain, isCoCaptain, canManage }`.
2. **Anything filed under a captain's id is filed under the TEAM'S captain** — a match post,
   a challenge (`challenger_captain_id`), an availability poll, an announcement, a player
   offer — even when a co-captain pressed the button. The fixture belongs to the team either
   way, and every existing `.eq("captain_id", …)` read keeps finding it. `actingCaptainId()`
   is that lookup.

The database enforces the split independently (`supabase_co_captains.sql`): `is_team_leader()`
gates the captain-only RPCs (`record_cash_credit`, the two invite-code functions,
`enter_own_tournament`), `isTeamLeader` in `lib/api-auth.ts` gates the API routes, and a
trigger refuses any write to `is_co_captain` that doesn't come from the captain's own session
— necessary because RLS on `team_members` is `using (true)`.

A co-captain is a squad member, so they still owe their joining fee, and losing the
membership row loses the promotion with it.

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

The Calendar empty-state **Find a game** button links to `/#find-matches`,
opening Home at the Find Matches section after role loading, with space for
the fixed header. Every player-facing Home variant exposes this anchor.

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
| `/my-team/tactics` | Saved setups — shape, instructions, and optionally the players in them |
| `/my-team/settings` | **Team Settings** — team details (name, location, level, players per side, description), joining fee, invite link, co-captains (was `/my-team/team-profile`) |
| `/my-team/announcements`, `/my-team/announcement/create` | Team-wide announcements (also DM'd to the squad) |
| `/my-team/collect-availability` | Captain creates an availability poll |
| `/my-team/history` | **Settle Payments** — issuing what the squad owes, not a results archive |
| `/my-team/match/[matchId]` | Manage Match — overview / squad / payment / tactics / result tabs, plus ringer requests |
| `/my-team/match/[matchId]/result` | Submit the final score, scorers, and participating squad |
| `/my-team/tournament-match/[fixtureId]` | Manage Tournament Fixture — the same info / attendance / lineup / tactics surface for one game inside a tournament |

#### Team details, and the two multi-select answers

Everything `/my-team/create` asks at registration is editable afterwards in Team Settings
(`components/my-team/TeamDetailsPanel.tsx`) — name, location, level, players per side,
description. The equivalent for a player is the **Edit Profile** sheet on `/profile`
(`components/EditProfileSheet.tsx`), which edits every answer registration collects: name,
positions, experience, age group, gender, games per month, preferred type of football. Both
are reached by people who already answered these questions once, in a hurry.

Two of those answers are **several answers**, and both follow the same shape
(`supabase_multi_select_preferences.sql`):

| | Scalar (unchanged) | Array (the full answer) |
|---|---|---|
| Team | `teams.format` | `teams.formats` |
| Player | `profiles.position` | `profiles.positions` |

The scalar is the **primary** value and is always `array[1]`, written on every save. That is
what keeps the change cheap: `teamSizeFromFormat` still sizes a tactics board from
`teams.format`, a card with one line of room still prints one position, and nothing that
never heard of the array had to be rewritten. `lib/team-options.ts` and
`lib/profile-options.ts` are the only places either pair is read or written — they also hold
the option lists the registration forms use, so the two forms can't drift — and both fall
back to the scalar, so the app works before the migration is run and simply offers one
choice. The filters that used to compare the scalar (Transfer Market, `/my-team/players`,
`TeamsPanel`) now ask "does this row include the filter", so a CM/CAM player shows under
both. `MembersTab` and `StatsTab` still read the primary only.

`lib/optional-column.ts` is how a query or update names a column that may not exist yet:
it runs the statement, and re-runs it without that column if Postgres objected to it by
name. That is the house "missing migrations degrade" rule made reusable.

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

- `/messages` — the inbox: **one team group chat pinned above the 1:1 threads**. Payment
  reminders and announcements still arrive as DMs. Match chats are not built.
- `/messages/team` — the **team group chat**. Its membership is *derived*, never stored: the
  captain plus every approved `team_members` row, so approving a squad member or a join
  through the invite link puts them in the chat with nothing to write, and losing the
  membership row takes them out. `lib/team-chat.ts` is the only place
  `team_chat_messages` / `team_chat_members` are read or written.
  `team_chat_members` holds only what the derivation can't know — **muted**, **left**, and
  how far this person has read — and the row is created lazily, so most of a squad never has
  one. **Muting** stops the chat contributing to the inbox count and the TopBar dot; it does
  not hide the chat. **Leaving** freezes it: the leaver keeps the history up to `left_at`,
  receives nothing after it, and the database refuses their posts (`can_post_team_chat`).
  Their inbox row is greyed with a Rejoin rather than removed, per the house convention, and
  rejoining is theirs to do for as long as they're in the squad.
  New messages arrive by **polling every 5s while the tab is visible** — Supabase realtime
  isn't enabled on this project.
  RLS here is deliberately stricter than the rest of the prototype's `using (true)`: only
  the squad can read a team's chat, and only a squad member who hasn't left can post.
- `/profile` — profile info, **Edit Profile** (every answer sign-up collected — see Team
  details above), saved payment method (Stripe SetupIntent), season stats, badges,
  highlights. The stats are display-level; there's no ingestion pipeline behind them.

### Venue portal (`app/venue/*`)

A separate app for pitch owners with its own layout and nav — calendar, bookings, customers,
open matches, academy, store, reports, settings. Venue managers are hard-redirected here from
any player route.

### Admin

`/admin/finance` — reconciliation view over the credit ledger and Stripe transfers.
`/admin` is the hub of every event this admin hosts, `/admin/create` posts one, and
`/admin/posts` moderates the teams' match posts (take-down via `/api/posts/take-down`).

`/admin/create` uses the app's own `DatePicker` / `TimePicker` for the date and the
block's start and end, not the browser's native `date`/`time` inputs — staff post these
from a phone like everyone else, and the native controls read differently on every
browser. The two clocks run with `minuteStep={5}`, because a booked block is not always
a whole hour.

### Generating a schedule

The organiser of an event (`/play/tournament/[id]`) is asked **how long a match runs**
and **how long the break between matches is** before generating one. Kickoffs are laid
out as `start + i × (match + break)` — the booked block is no longer divided by the
number of fixtures, which produced slots nobody had agreed with the venue. The panel
shows what the settings would produce (`n games · 18:00 – 20:25`) before anything is
written, and if that runs past the booked end time it says by how much and offers the
longest match length that still fits.

The **break** only decides where kickoffs land and isn't stored. The **match length**
is a fact about each game, so it is written to `tournament_matches.duration_minutes`
(`supabase_tournament_fixture_duration.sql`) and every viewer's schedule shows a finish
time under the kickoff. A fixture added by hand takes the same length, and its kickoff
is picked on the same clock dial as everywhere else. Without the migration the schedule
still generates — the finish time is simply absent.

**Taking Uniter's own event down.** An admin-hosted event is cancelled from the event page
itself (`/play/tournament/[id]`), where staff see a take-down box under the organiser
controls. It goes through `/api/events/take-down`, which flips `open_matches.status` to
`cancelled` — every feed and calendar query already filters that out — and then refunds
every buy-in with the `refund_event_buyin` RPC, which reads what each team **actually**
paid off the ledger (an invitation discount never reaches the listing) and is idempotent, so
a repeated take-down cannot pay twice. Pending invitations are cancelled and each entered
captain gets a bell notification carrying the reason and their refund. The route refuses
anything without `organiser_admin_id` — a team's or a venue's event is their fixture and
their money — and the button hides once kickoff has passed, since football that happened
can't be refunded.

**Removing one unwanted team from it.** The narrow version of the same thing, for an event
that should still go ahead without a particular entrant. On the same page, staff see the
entered teams as a row each with a **Remove** button, behind the same three conditions as the
take-down box (staff, `organiser_admin_id`, before kickoff). `/api/events/kick-team` refunds
that team's buy-in with the same `refund_event_buyin` RPC **before** deleting its
`open_match_teams` row, so a failure leaves the team still entered and the removal retryable
rather than out of the event and out of pocket; a `full` listing goes back to `open`, freeing
the spot. Undoing an entry is more than the row: it also withdraws the squad's availability
answers for the event, deletes the fixtures that team was drawn into and un-assigns referees
drawn from its squad, cancels its pending invitation, and deletes the money the squad had yet
to be asked for (pending `replenish` `player_payments`, unreceived `payment_collection_status`
rows). Anything already paid stays where it is. The captain gets a bell notification carrying
the reason and the refund. The organiser regenerates the schedule afterwards.

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
The captain's copy carries the squad's tally per game (`loadSquadAnswers`), and
`/my-team/tournament-match/[fixtureId]` shows the same tally as a named list when the captain
is picking a lineup for one of the tournament's games. The tally on Home **is** the named
list: `loadSquadAnswers` returns who answered, not just how many, and tapping
"*n* available · *n* out" expands the two groups of names in place. It's one query per
surface either way — the names ride along with the count rather than being fetched on the
tap — and the line is inert until somebody has actually answered.

Settle Payments reads the fixture's own answers first and falls back to the poll only when
nobody answered the fixture (`SettlePaymentsModal`).

### Voting available is gated; voting unavailable never is

A player who owes the team money can't put themselves forward for a game. Two debts count,
and `lib/availability-gate.ts` is the only place either is weighed:

1. their **joining fee** (`lib/joining-fee.ts`), and
2. their **share of games already played** — outstanding `payment_collection_status` rows
   (`included`, not `received`) for that team. Settle Payments only issues a request for who
   *did* play, so every open row is a past game and no date filter is needed.

Both are the same charge in the end — paying either is a top-up into team credit — so they're
asked for in one breath and paid through the same Top Up button. `owedSummary()` names
whichever apply, so no two surfaces describe the debt differently.

**Only the "available" half is gated.** Ruling yourself out claims no place and costs the team
nothing, and blocking it turned a real "I can't play" into a silence the captain read as
"hasn't replied" and chased. So Available greys out with the reason under it while Unavailable
stays live (`AvailabilityButtons`); on the poll, picking dates is the gated half and
"unavailable for any of these" always sends (`AvailabilityModal`). A blocked player can still
**deselect** a date they'd already picked, because the "none of these" answer is only reachable
with nothing selected — leaving it disabled trapped them with an answer they could neither send
nor clear.

The gate is **client-side only**: nothing in RLS or an API route enforces it, exactly as before.
Every card in a list asks the same question at the same moment, so `loadAvailabilityGate`
shares the **in-flight** promise per `teamId:playerId`. Never a settled one — the answer
changes the instant the player pays, and a cached "still owes" would leave the buttons greyed
after they had.

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
4. **Venue payout** — Uniter transfers the pitch fee to the venue's **Stripe Connect** account
   (`supabase_venue_payouts.sql`). One connected account per venue. Test mode only; real
   payouts need KYC/onboarding and a fintech review.

Everything is in **pence**, everywhere. Uniter's per-transaction fee lives in
`lib/uniter-fee.ts` and is currently **0** — the rate is being agreed with partners. It was a
bare `0.05`/`1.05` literal at nineteen sites; the constant is now the only place it exists,
and at 0 the fee lines hide themselves rather than printing "£0.00 (0%)". `unitr_fee_pence`
on `player_payments` / `pitch_bookings` is a snapshot, never recomputed, so changing the rate
cannot rewrite what someone already paid.

Uniter's actual revenue in the pilot is the **buy-in on admin-hosted events**: the ledger's
`booking_capture` row carries `open_match_id`, so a capture against an `open_matches` row with
`organiser_admin_id` set is money that stayed with the platform. `/admin/finance` reads it
that way rather than inferring it as a residual. Cancelling such an event writes the money
back as a positive `buyin_refund` row against the same listing, and both `/admin/finance`
and `lib/event-revenue.ts` net the two per team — a fully refunded team stops counting as a
paying entry rather than leaving the cancelled event still claiming revenue.

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
- **Ringers** — a guest pays Uniter a **flat £5 by card**. It never touches team credit or the
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
  can't join, and can't vote **available** for games — see Voting available below. The fee
  splits across the money row like every other charge: the **amount** is set in Settle
  Payments → Joining fee (and still in Team Settings and at registration), **who has paid it**
  is Payment Status → Joining fee. Both panels live in `components/JoiningFeePanels.tsx`.
  **The captain owes it too.** They play in the games the fee pays for, and they have no
  `team_members` row, so their copy of the same two numbers sits on `teams`
  (`captain_joining_fee_due_pence` / `_paid_pence`, `supabase_captain_joining_fee.sql`).
  Setting a non-zero fee — at registration or later in Team Settings — snapshots it and fires
  a bell notification telling the captain to top up that much; the snapshot is taken once, so
  raising the fee later never re-charges them, exactly as it never re-charges the squad.
  `lib/joining-fee.ts` falls back to those columns when there's no membership row, so every
  gate the squad lives under applies to the captain unchanged.

`payment_collection_status` is a **bookkeeping checklist** the captain ticks off — it does not
move money or call Stripe. The real settlement is the credit ledger.

### Settle Payments vs Payment Status

Two chips in the money row (`components/TeamCreditsBar.tsx`), and the split between them is
**issuing** vs **chasing**. They were blurred before — the joining-fee tracker sat inside
Settle Payments, and the Payment Status sheet opened titled "Collect Payment".

| | Settle Payments (`SettlePaymentsModal`) | Payment Status (the sheet in `TeamCreditsBar`) |
|---|---|---|
| Question | Who owes what, and say so | Who has actually paid |
| Fixtures tab | Pick who played, send the request, then a read-only receipt of what was charged | Every fixture a request was issued for → mark paid / unpaid, remind, drop a player |
| Joining fee tab | Set `teams.joining_fee_pence` — permanent, so there's somewhere to set it when there isn't one yet | Per-member paid/due off the snapshots, with a nudge |

Consequences worth knowing:

- **`payment_collection_status.received` is written in exactly one place now** — `markReceived`
  in `TeamCreditsBar`. It moves `credited_pence` with it and rolls the fixture's
  `fees_settled` (`matches` for a game, `open_match_teams` for a tournament entry).
- **Payment Status keeps fully-paid fixtures listed** rather than filtering to what's still
  owed, because a tick has to be undoable. The chip's red badge counts only fixtures still
  owed, so the number still means "needs you".
- Settle Payments' fixture panel disappears once `fees_settled` is true, exactly as before —
  a settled fixture has nothing left to issue.

## Data model

Schema updates live as `supabase_*.sql` at the repo root and are applied by hand in
the Supabase SQL editor. Many are designed to be idempotent, but check each file's
dependencies and effects before running it; test/seed scripts also live here, and
some core tables were created manually before these files existed.

Nothing in the repo records which of them a given database has seen, so
**`node scripts/check-migrations.mjs`** asks the database instead: it parses every
`supabase_*.sql` for the tables, columns and functions it creates and checks them
against the live schema, which PostgREST serves in full from a single request. It
sees **objects only** — RLS policies, grants and triggers are invisible to it, so a
file that only tightens policies reports `?` rather than a verdict. RLS is permissive
on many prototype tables, with stricter policies for areas such as profiles, team
chat and tournament entry. Inspect the relevant SQL rather than assuming uniform access.

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
| `supabase_event_takedown.sql` | Take-down provenance on `open_matches` + `refund_event_buyin` (returns a team's net buy-in to its credit as a `buyin_refund` ledger row); run after `supabase_admin_hosting.sql` |
| `supabase_tournament_entry_lockdown.sql` | Closes client inserts/deletes on `open_match_teams`; `enter_own_tournament` RPC for the organiser's own free entry; run after `supabase_open_matches.sql` |
| `supabase_refunds.sql` | `refund_credit`, `team_card_contributions`, refund columns on the ledger; run after `supabase_joining_fees.sql` |
| `supabase_joining_fees.sql` | `teams.joining_fee_pence`, fee snapshot + paid tracking on `team_members`, approval-time DM, deposits applied to fee first (redefines `credit_from_payment` / `record_cash_credit`; run after `supabase_payment_integrity.sql`) |
| `supabase_team_chat.sql` | `team_chat_messages` + per-person `team_chat_members` (muted / left / last read), `is_team_squad_member()`, `can_post_team_chat()`, and squad-only RLS; run after `supabase_joining_fees.sql` |
| `supabase_multi_select_preferences.sql` | `teams.formats` + `profiles.positions` — the array beside each scalar, backfilled from it; the scalar stays the primary value. No dependencies |
| `supabase_team_invites.sql` | `teams.invite_code` + the four invite-link RPCs (`ensure_`/`rotate_team_invite_code`, `team_by_invite_code`, `join_team_by_invite`); run after `supabase_joining_fees.sql` |
| `supabase_captain_joining_fee.sql` | `teams.captain_joining_fee_due_pence` / `_paid_pence`, the snapshot + notify triggers, and the captain branch of `apply_deposit_to_joining_fee`; run after `supabase_joining_fees.sql` |
| `supabase_co_captains.sql` | `team_members.is_co_captain`, `is_team_leader()`, `set_co_captain()`, the write guard on the flag, and leader checks in `record_cash_credit` / the invite RPCs / `enter_own_tournament`; run after `supabase_joining_fees.sql`, `supabase_team_invites.sql` and `supabase_tournament_entry_lockdown.sql` |
| `supabase_event_availability.sql` | `match_confirmations.open_match_id` — a confirmation targets a match **or** a tournament entry; run after `supabase_open_matches.sql` |
| `supabase_match_results.sql`, `supabase_match_result_verification.sql` | Results, cross-team score verification |
| `supabase_match_suggestions.sql` | Squad players suggesting games to the captain |
| `supabase_match_tactics.sql`, `supabase_team_profile.sql`, `supabase_team_announcements.sql` | Per-match tactics, team profile fields, announcements |
| `supabase_tournament_match_tactics.sql` | `match_tactics.tournament_match_id` — a lineup targets a friendly **or** a tournament fixture; run after `supabase_match_tactics.sql` and `supabase_tournament_schedule.sql` |
| `supabase_tournament_fixture_duration.sql` | `tournament_matches.duration_minutes` — how long one fixture runs, from the organiser's match length; run after `supabase_tournament_schedule.sql` |
| `supabase_pitches.sql`, `supabase_venue.sql` | Pitches, weekly availability |
| `supabase_pilot_security.sql` | Closes the holes a browser could reach past the API routes: `refund_event_buyin` and `apply_replenishment` become service-role only, `profiles.account_type` and `teams.captain_id` become immutable from a client session, joining-fee columns move only by payment, `open_matches` / `tournament_invitations` writes belong to the organiser, and `messages` becomes readable only by its two correspondents. Run after `supabase_core_tables_rls.sql`, `supabase_payment_integrity.sql`, `supabase_joining_fees.sql`, `supabase_event_takedown.sql`, `supabase_admin_hosting.sql` and `supabase_team_tournaments.sql` |

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
- **Lineups follow the match size.** Selectable formats are 5 / 7 / 8 / 11-a-side, and
  `lib/formations.ts` groups formations by players-per-side. A friendly reads its size off
  `confirmed_pitch.format` (falling back to the posting team's `teams.format`), a tournament
  fixture off `open_matches.format`, and a saved team preset off the formation key itself —
  keys are unique across sizes, so a stored string still names exactly one layout. A
  formation belonging to another size renders as that size's default (`resolveFormation`)
  rather than drawing eleven dots on a 5-a-side board; saves write the resolved key. Slot
  order inside a formation is still history — adding formations is safe, reordering is not.
- **A saved setup can name players, and names are resolved late.** `team_tactics.lineup` is
  the same `{ slotIndex: player_id }` shape as `match_tactics.lineup`, so loading a preset
  into a fixture copies its players straight onto that game's board — filtered to who can
  actually play it, so anybody who declined or left the squad lands nowhere. Everywhere a
  preset is *displayed*, an id is looked up in the current squad and an unknown one renders
  as an empty slot: a transfer leaves a hole in the plan, never a ghost name. Re-saving the
  preset drops those ids. Changing a preset's match size clears its lineup outright, because
  slot indexes mean different positions on a different board.
- **Times are picked on the app's dial, never a native `<input type="time">`.**
  `components/DateTimePickers.tsx` is the only time control, and by default it returns a
  **whole hour** — pitch slots, poll dates and venue opening rules all are one, and every
  caller relies on it. Pass `minuteStep` (5 is the only value used) to ask for minutes as
  well: the dial then runs hours-first, minutes-second like a phone's clock picker, with a
  tappable `9:30 AM` read-out to go back. Off by default, so nothing that wants an hour can
  be handed `:37`.
- **z-index floor.** TopBar and BottomNav are `z-40` chrome; every sheet/modal is `z-[60]`,
  above them. At equal z the nav silently paints over the bottom of a sheet.
- **Money is pence, integers, everywhere.** Never floats, never pounds in the DB.
- **PaymentIntents pin `allow_redirects: "never"`.** It keeps the Payment Element to methods
  that finish in place. Left on, Stripe offers whatever the live account has enabled —
  Klarna, Revolut Pay, iDEAL — and those finish by sending the payer to the provider's own
  site. Test mode hides this: fewer methods are enabled there.
- **Never call `stripe.confirmPayment` directly — use `confirmCardPayment`**
  (`lib/confirm-payment.ts`). It is the only place a card payment is confirmed, and it exists
  because 3D Secure on mobile breaks the plain call in two different ways. Both were hit on a
  live card; neither shows up in test mode, where cards skip SCA.
  1. **The tab survives but the promise hangs.** `confirmPayment` resolves from a polling loop
     inside Stripe's 3DS iframe. "Approve in your banking app" backgrounds the tab by
     definition, and a backgrounded tab has its timers throttled and network suspended — so
     the loop freezes exactly when the bank approves, and returning does not restart it.
     Nothing reloads, so the on-mount recovery below never runs either. `confirmCardPayment`
     races the promise against the **server**: on every return to the foreground it retrieves
     the intent, resolves on `succeeded`/`processing`, and on `requires_action` re-drives the
     challenge once with `handleNextAction`, which finds the approval already waiting.
     Failures are deliberately not watched for — a fresh intent sits at
     `requires_payment_method`, and treating that as terminal would fail every payment on
     sight.
  2. **The tab is evicted entirely.** The client secret is written to localStorage *before*
     confirming (`lib/pending-payment.ts`), because it has to outlive the page.
     `ResumePaymentBanner`, mounted app-wide in `app/layout.tsx`, reads it on the next load,
     asks Stripe what happened, and either resumes or reports. The entry's `kind` bounds what
     it may claim: `credit` is safe to resume outright because the webhook grants the credit
     off the intent's metadata, while `booking` had a client-side write after the charge that
     no resume recovers — so the banner says the money moved and the booking may not have,
     rather than reporting a success the payer disproves later.
  Every confirm also carries a `return_url` of `/payment-return` (`paymentReturnUrl()`). The
  redirect is still only taken when a bank insists, but supplying it removes the failure where
  Stripe needs to redirect, finds nowhere to go, and errors instead of taking the payment.
- **Saving a card is the same problem — use `confirmCardSetup`, never `stripe.confirmSetup`.**
  A SetupIntent runs the identical 3D Secure challenge; the bank does not care that no money is
  moving. So it goes through the same file, the same server-side race and the same `return_url`.
  Three things differ. Its pending entry's `kind` is **`"card"`** with an amount of 0 — nothing
  is charged, and the banner never prints a figure. Its follow-up write (the payment method onto
  the profile) **can** be replayed from the intent alone, so `ResumePaymentBanner` finishes it
  rather than reporting an orphan; that write lives once in `lib/save-card.ts` so a recovered
  card is saved identically to a normal one. And `/api/create-setup-intent` writes
  `stripe_customer_id` to the profile when it mints the customer, not after the card saves —
  otherwise a challenge that costs the payer their tab loses the id and the next attempt creates
  a second customer. `/payment-return` reads **`setup_intent_client_secret`** as well as
  `payment_intent_client_secret`; reading only the latter told someone who had just authorised
  a card that we couldn't find their payment.
- **Resuming a payment always asks the server first, and is always bounded**
  (`resumeIntent` in `lib/confirm-payment.ts`). `ResumePaymentBanner` used to call
  `handleNextAction` straight out, which is fine for an intent that still has a challenge
  left and catastrophic for one that doesn't: Stripe mounts a 3D Secure frame that polls for
  an answer nobody will ever send, the promise never settles, and "Finishing your payment…"
  becomes the end of the road — on a payment that had, in fact, already succeeded. So the
  intent's real status is retrieved before anything is driven, only `requires_action` /
  `requires_confirmation` are driven at all, and the drive races the same server watcher the
  confirm path uses against a 45s timeout. A timeout keeps the pending entry and offers
  **Check again** rather than a verdict — the bank may still be deciding.
- **One Stripe customer per player, written when it is created**
  (`ensureStripeCustomer` in `lib/stripe-customer.ts`). Every intent route needs the payer's
  customer, because `setup_future_usage: "off_session"` only attaches a card to one, and
  off-session settlement charges `stripe_customer_id` + `stripe_payment_method_id` as a
  **pair**. Three of the four routes used to mint a customer when the profile had none and
  then throw the id away, so a player who paid four times had four customers holding one card
  each and a profile pointing at none of them — which is how a saved card fails off-session
  with "no such payment method for this customer". All four routes now go through the one
  helper, which persists the id before the intent is created.
- **"Save this card" is a tick box in the card form, not a prompt after the charge**
  (`useSaveCardTickbox` in `components/SaveCardPrompt.tsx`). Unticked by default — it is
  consent to store a card. The old popup only appeared for a player the profile lookup said
  had no card yet, so a half-written customer id meant it never appeared at all and there was
  no way to save a card while paying. Ticking it costs no second authentication: the card is
  copied off the intent that just paid, via `commit(paymentIntent.id)` on the success path.
  Every card surface renders `saveCard.checkbox` under its `PaymentElement` — the top-up
  sheet, dues top-up, ringer checkout, pitch booking and `/pay/[matchId]`.
- **Every API route authenticates its caller.** RLS is `using (true)` and the anon key is
  public, so the API routes are where authorisation actually happens. A route identifies the
  caller with `getCallerId` / `getCaller` from `lib/api-auth.ts` (the Supabase JWT in the
  `Authorization` header — never an id from the body) and checks entitlement with
  `isTeamLeader` (captain or co-captain — the usual one), `isTeamCaptain`, `isTeamMember`,
  `ownsPitch` or `isAdmin` from the same file. The browser side is `authedPost` /
  `authedDelete` / `authedGet` in `lib/authed-fetch.ts` — a plain `fetch("/api/…")` from a
  component is a bug, it will 401.
- **The API routes are not the only door.** The anon key ships in the bundle, so anything the
  browser can reach through PostgREST — every table with a permissive policy, every function
  still granted to `authenticated` — is reachable without touching a route at all. A new
  `security definer` function is granted to PUBLIC the moment it is created: **revoke it**
  unless it checks its own caller, or the route guarding it is decoration. `refund_event_buyin`
  and `apply_replenishment` were both reachable that way, and both minted money
  (`supabase_pilot_security.sql`). The matching rule for tables: if a column decides who may
  act (`profiles.account_type`, `teams.captain_id`) or how much is owed
  (`price_per_team_pence`, the joining-fee snapshots), a server route reading it is trusting
  something the client can write.
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
