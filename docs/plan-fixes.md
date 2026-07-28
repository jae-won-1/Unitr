# Unitr — eight fixes

## Context

Eight independent fixes across the player app and venue portal. Item 8 (tournament payments "failing") was investigated live against the database and Stripe — **root cause is confirmed and is not a wiring bug**; details in §8.

Scope decision: match history gains **upcoming matches only**, not tournaments. `payment_collection_status.match_id` and `messages.match_id` both FK `matches(id)` (`supabase_payment_collection.sql:21-31`), and tournaments have no `matches` row — so payment collection is structurally impossible for them without a schema change. Out of scope here.

---

## 1. Tournaments in Upcoming Fixtures

Fixtures today come only from `match_posts` + `challenges`. Tournaments live in `open_matches` (`match_type='tournament'`) and are joined via `open_match_teams`. A team relates to a tournament two ways — **entered** (`open_match_teams.team_id`) and **hosted** (`open_matches.organiser_team_id`). Include both.

**New shared loader** — add to `lib/` (new file, e.g. `lib/tournament-fixtures.ts`) so Home and My Team share one implementation:

```
loadTournamentFixtures(teamId) →
  entered:  open_match_teams (team_id=teamId) → open_match_id[] → open_matches
  hosted:   open_matches (organiser_team_id=teamId)
  both:     .eq("match_type","tournament").neq("status","cancelled")
            select id, title, match_date, start_time, pitch_name, organiser_team_id
  dedupe by id, filter match_date >= today
```

Model the query on the existing `useHostedTournaments` at [my-team/page.tsx:212-239](../app/my-team/page.tsx#L212-L239).

**Type changes** — add a discriminator to both fixture types so cards can branch:
- [app/page.tsx:9-16](../app/page.tsx#L9-L16) `ConfirmedFixture` → add `kind: "match" | "tournament"` and `title?: string`
- [app/my-team/page.tsx:189-197](../app/my-team/page.tsx#L189-L197) same

Field mapping for tournaments: `title` → headline (instead of `vs {opponent}`), `start_time` → `time`, `pitch_name` → `pitch`, `matchRowId` = `null`.

**Wire in at:**
- [app/page.tsx:36-109](../app/page.tsx#L36-L109) `useConfirmedFixtures` — hook currently takes only `userId`; add a team lookup inside it (`teams.captain_id = userId`, else `team_members.player_id` where `status='approved'`), then merge tournament fixtures before the existing sort at :97-99.
- [app/my-team/page.tsx:318-368](../app/my-team/page.tsx#L318-L368) (`PlayerMyTeam`) and [:773-822](../app/my-team/page.tsx#L773-L822) (`CaptainMyTeam`) — merge into `loadFixtures()` before the upcoming/past split at :385-393 and :846-855.

**Card rendering** — [app/page.tsx:151-176](../app/page.tsx#L151-L176) `ConfirmedFixtureCard`, [my-team/page.tsx:1108-1136](../app/my-team/page.tsx#L1108-L1136). For `kind==="tournament"`: show `title`, add a small "Tournament" pill, and link to `/play/tournament/{id}` instead of `/my-team/match/{matchRowId}`.

Leave the existing "Tournaments You're Hosting" section ([my-team/page.tsx:1149-1182](../app/my-team/page.tsx#L1149-L1182)) in place.

---

## 2. Tournament name on the Play page

Real bug, one line. `TournamentCard` renders `t.title` at [app/play/page.tsx:877](../app/play/page.tsx#L877) and the `Tournament` type declares it at :80, but `title` is **missing from the select list** in `useOpenTournaments` at [app/play/page.tsx:1107](../app/play/page.tsx#L1107) — so it renders empty.

Add `title` to that select. (`EnterTournamentPanel` also shows it at :1030 and :1049, so both fix at once.)

---

## 3. Upcoming games in Match History

**File:** [app/my-team/history/page.tsx](../app/my-team/history/page.tsx)

- `HistoryFixture` (:7-14) → add `isUpcoming: boolean`.
- **Filter** (:377-379) — replace the `f.date < today` cut with a date-validity check only, stamping `isUpcoming = f.date >= today`. Keep the `matches` query at :381-385 (it already keys off `postId`; upcoming matches have a `matches` row from the moment a challenge is accepted, [app/play/page.tsx:326](../app/play/page.tsx#L326)).
- **Sort** (:398-403) — upcoming first ascending (soonest next), then past descending. Keeps "what's next" at the top and history below.
- **Submit Result** (:465-468) — gate on `!f.isUpcoming`. For upcoming rows show a neutral "Upcoming" pill and the existing `View Details` link instead.
- **PaymentCollectionPanel** (:475-486) — leave the gate otherwise unchanged so captains can issue payments on upcoming games exactly as on past ones. `confirmed_pitch.price` and `fees_settled` are both already populated at match confirmation, so the panel works as-is.

Leave the history badge counter at [my-team/page.tsx:1505-1524](../app/my-team/page.tsx#L1505-L1524) unchanged — it counts past matches needing a result, and extending it to every upcoming game would inflate the badge.

---

## 4. Venue bookings ordered most-recent-first

**File:** [app/venue/bookings/page.tsx](../app/venue/bookings/page.tsx). Keep the current Upcoming/Past grouped format.

The DB `.order("match_date", { ascending: false })` at :113 is unreliable — `pitch_bookings.match_date` is `text` and legacy rows hold display strings like `"Fri, 12 Jun 2026"`, which sort lexically. `normalizeMatchDate()` (:11-19) only runs later at :162, after the sort.

Fix: **sort client-side after enrichment**, on the normalized ISO date. Add a descending sort on `${match_date} ${start_time}` to `filtered` (:184-187) before the grouping loop at :191-201. Groups stay Upcoming/Past and render in that order (:248); within each, newest first.

Also flip [app/venue/dashboard/page.tsx:62-66](../app/venue/dashboard/page.tsx#L62-L66) — its `upcoming` slice at :101 is currently oldest-first.

---

## 5. Sign-out in the venue portal

The venue portal has no header at all — `TopBar` explicitly bails on venue routes ([components/TopBar.tsx:133](../components/TopBar.tsx#L133)). Its only sign-out is buried in Settings ([app/venue/settings/page.tsx:971-978](../app/venue/settings/page.tsx#L971-L978)).

Add a profile badge + dropdown to the **sidebar footer** at [app/venue/layout.tsx:129-138](../app/venue/layout.tsx#L129-L138), above the existing "Player app" link. Mirror the user-portal pattern at [components/TopBar.tsx:272-306](../components/TopBar.tsx#L272-L306):

- `const { user, signOut } = useAuth()` (from `contexts/AuthContext` — [:43-45](../contexts/AuthContext.tsx#L43-L45))
- initials from `profiles.full_name`, same derivation as [TopBar.tsx:29-38](../components/TopBar.tsx#L29-L38)
- `profileOpen` state + `profileRef` + the mousedown outside-click closer ([TopBar.tsx:124-131](../components/TopBar.tsx#L124-L131))
- menu items: **Settings** (`/venue/settings`) and **Sign Out** (red, `border-t`)

Two deviations from TopBar, both required by the sidebar geometry: the menu must open **upward** (`bottom-full mb-2`, not `top-14`), and on mobile the rail is `w-16` so the badge shows initials only with the label hidden behind `hidden md:block` — same responsive treatment as the nav links at :121.

`app/venue/layout.tsx` is already `"use client"`; it needs new imports for `useState/useRef/useEffect`, `useAuth`, and `supabase`.

---

## 6. Show which team paid — venue Reports and Bookings

`venue_transfers` has **no team column** ([supabase_venue_payouts.sql:23-35](../supabase_venue_payouts.sql#L23-L35)), and today it can only be joined back to a team through four different fragile paths (`match_id` → `matches`, `booking_id` → `player_payments.team_id`, → `team_credit_transactions.team_id`, or `pitch_bookings.booker_name`). For tournament transfers **all of them are null**.

**Migration** — extend `supabase_venue_payouts.sql` with an idempotent `do $$` block (matching the style already used in `supabase_credit_ledger.sql:68-97`):

```sql
alter table public.venue_transfers
  add column if not exists team_id       uuid references public.teams(id),
  add column if not exists open_match_id uuid references public.open_matches(id);
create index if not exists venue_transfers_open_match_idx
  on public.venue_transfers(open_match_id, team_id);
```

**Route** — [app/api/connect/venue-transfer/route.ts](../app/api/connect/venue-transfer/route.ts): accept `teamId` and `openMatchId` in the body (:16), persist both on the insert (:66-75), and add them to the Stripe `metadata` (:57).

**Populate at every call site** so historical gaps stop growing:
| call site | add |
|---|---|
| [app/play/page.tsx:404-409](../app/play/page.tsx#L404-L409) (match confirm) | `teamId: post.team_id` |
| [components/BookPitchPanel.tsx:598-602](../components/BookPitchPanel.tsx#L598-L602) (direct book) | `teamId` |
| [app/play/create-tournament/page.tsx:192-195](../app/play/create-tournament/page.tsx#L192-L195) | `teamId`, `openMatchId` |
| tournament join | handled in §7 (moves server-side) |

**Venue Reports** — [app/venue/reports/page.tsx](../app/venue/reports/page.tsx): add `team_id, booking_id, match_id` to the transfers select (:60-62), batch-fetch `teams(id, name)` for the distinct `team_id`s, and render the team name in the row subtitle at :159-163. Fall back to `pitch_bookings.booker_name` for legacy rows with a null `team_id` (for matched games that string is already `"Team A vs Team B"` — written at [app/play/page.tsx:287](../app/play/page.tsx#L287)).

**Venue Bookings** — [app/venue/bookings/page.tsx](../app/venue/bookings/page.tsx): the batched-lookup block at :125-135 already fetches `venue_transfers` by `booking_id`; extend that select with `team_id` and add an `open_match_teams` fetch for `open_match` bookings. Render the paying team(s) next to `booker_name` in the card — for a tournament booking that is a list of entered teams, so show e.g. `4 teams · Team A, Team B, …`.

---

## 7. Tournament payment flow — verified root cause

**The flow is wired correctly and does pay the venue.** Verified live against the database and Stripe on 2026-07-28:

- `venue_transfers` shows a **paid** £20 tournament transfer at `2026-07-28T04:24`, and failed £20 attempts at 04:27 and 05:35.
- Every failed row (tournaments *and* matches — £80 and £160 match transfers failed too) carries the identical `failure_reason`: *"You have insufficient available funds in your Stripe account."*
- Live Stripe balance at time of check: **£16.68 available, £840.24 pending.** A £20 buy-in cannot clear. (Check current balance again before assuming this is still the state — it changes as test charges settle.)

So: money *does* reach the pitch account, whenever the platform has available balance. This is test-mode balance exhaustion, not a tournament-specific defect — normal test charges settle to `pending` for days. **The immediate unblock is the existing "Fund test balance" button on [app/admin/finance/page.tsx:51](../app/admin/finance/page.tsx#L51)**, which charges `pm_card_bypassPending` straight into available balance.

Three genuine code defects surfaced by the investigation, all worth fixing:

**(a) No idempotency on tournament joins.** [app/play/page.tsx:1013](../app/play/page.tsx#L1013) is the only call site that omits `bookingId` — deliberately, per the comment at :1006-1008, because every team shares the tournament's single reservation booking. But dropping the key entirely means the guard at [venue-transfer/route.ts:34-43](../app/api/connect/venue-transfer/route.ts#L34-L43) can never fire, so a re-click, retry or remount fires an unguarded `stripe.transfers.create`. Fix with the correct key rather than none: dedupe on `(open_match_id, team_id)` using the columns added in §6.

**(b) The transfer is client-side and fire-and-forget.** :1013-1014 never reads the response and swallows the 502; :1018 shows "You're in!" regardless. Move the call **server-side into [app/api/tournaments/join/route.ts](../app/api/tournaments/join/route.ts)** — it already resolves `pitchId`, `bookingId`, `teamId` and `hostType` (:162-168) — so it cannot be skipped by a user navigating away. Return the transfer outcome in the join response and surface a non-blocking warning in `EnterTournamentPanel` when it failed (the team **is** entered and their credit **was** debited; only the venue payout is outstanding).

**(c) Organiser joining its own tournament double-pays.** [route.ts:110](../app/api/tournaments/join/route.ts#L110) — `isTeamHosted` requires `om.organiser_team_id !== teamId`, so when the organiser enters its own team-hosted tournament the route reports `hostType:'venue'` and a venue transfer fires for a pitch fee already paid at [create-tournament/page.tsx:192-195](../app/play/create-tournament/page.tsx#L192-L195). Split the two conditions: `isTeamHosted = Boolean(om.organiser_team_id)` decides the payout branch; `om.organiser_team_id !== teamId` separately gates the `reimburse_team` call at :111-120.

---

## Verification

**Migrations first** — re-run both in the Supabase SQL editor (both idempotent):
`supabase_venue_payouts.sql` (new `team_id`/`open_match_id`), `supabase_credit_ledger.sql` (the `booking_id`/`open_match_id` columns from an earlier change).

**Then** `npm run dev`, and:

1. **Fund the test balance** — `/admin/finance` → Fund test balance (~£200). Confirm "Available" rises.
2. **Tournaments in fixtures** — enter a tournament as one team, host one as another; both appear under Upcoming Fixtures on Home and My Team, titled, linking to `/play/tournament/{id}`.
3. **Play page** — Tournaments tab cards show a title (currently blank).
4. **Match history** — `/my-team/history` lists an upcoming match with an "Upcoming" pill, no Submit Result button, and a working Collect Payment panel. Past matches keep Submit Result.
5. **Venue bookings** — `/venue/bookings`, both groups ordered newest-first; check a legacy `"Fri, 12 Jun 2026"`-style row lands correctly.
6. **Venue sign-out** — click the sidebar badge, menu opens upward, Sign Out returns to the login screen. Check the `w-16` mobile rail.
7. **Tournament payout end-to-end** — join a venue-hosted tournament, then confirm in `/venue/reports` a **paid** transfer row carrying the joining team's name. Re-join / retry and confirm no second transfer is created.
8. **Team attribution** — `/venue/reports` and `/venue/bookings` name the paying team on new rows and degrade gracefully on legacy rows with a null `team_id`.

`npx tsc --noEmit -p .` should stay clean throughout.
