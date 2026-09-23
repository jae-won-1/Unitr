# Uniter handoff

## Latest completed work — 2026-09-23, Claude Code: remove one team from an event

Uniter staff can take a single unwanted team out of an event they host, instead
of cancelling the whole thing. Shipped ahead of the pilot tournament because the
fallback — taking the event down and refunding everyone — is a much bigger
hammer to reach for on the day. **No SQL**: it reuses `refund_event_buyin` from
`supabase_event_takedown.sql`, which `scripts/check-migrations.mjs` confirms is
applied to the live database.

- **New route `app/api/events/kick-team/route.ts`** — the narrow sibling of
  `/api/events/take-down`, behind the same three refusals (admin caller,
  `organiser_admin_id` set, before kickoff), plus: never the organiser's own
  team, never a team that isn't entered, and a reason is required because the
  captain is told it. It **refunds before it removes**, with the same idempotent
  `refund_event_buyin`, so a failed refund leaves the team still entered and the
  removal retryable rather than out of the event and out of pocket. A missing
  migration (42883) refuses outright rather than removing a team whose money
  can't go back.
- Undoing an entry is more than the `open_match_teams` row. Also cleaned up,
  best-effort: that squad's `match_confirmations` for the event, the
  `tournament_matches` the team was drawn into, referees drawn from its squad,
  its pending invitation, the pending `replenish` `player_payments`
  `/api/tournaments/join` pre-created, and unreceived
  `payment_collection_status` rows. Anything already paid is left alone. A
  `full` listing goes back to `open`. The captain gets a bell notification
  carrying the reason and the refund.
- **New `lib/kick-team.ts`**, mirroring `lib/take-down-event.ts`. UI on
  `/play/tournament/[id]`: for staff on their own event before kickoff, the
  Teams card renders a row per team with **Remove**, opening an inline reason
  box and a confirm. Everyone else sees the unchanged chip row. The refund total
  stays on screen afterwards — the only place it is shown.
- `teamId` is validated as a uuid before it reaches the PostgREST `or` filter.

### Validation

- `npx tsc --noEmit` clean and `next lint` clean on this branch, which carries
  none of the in-progress work on `mobile` (see below). `next build` passed in
  the development checkout with these same file contents, with
  `/api/events/kick-team` in the route table.
- **Not exercised in a browser, and no team has actually been removed.** The
  refund and the cleanup writes are reasoned, not observed. Next step is one
  removal on a throwaway event before relying on it during the pilot.

### Still on the `mobile` branch, deliberately not here

A **Leave team** feature (`lib/leave-team.ts`,
`components/my-team/LeaveTeamPanel.tsx`, and the panel's wiring into
`app/my-team/page.tsx` plus a `useRole().isCoCaptain` read) was written in the
same session and held back: it has no reason to be live for the pilot, and it
puts a new destructive control in front of players. It merges with the rest of
the branch afterwards. The Google sign-in work is likewise still uncommitted
there — see `docs/GOOGLE_SIGN_IN.md` for its switch-on order.

## Previous completed work — 2026-09-21, Codex: Calendar discovery link

The empty Calendar's **Find a game** button now opens `/#find-matches`.
All Home variants expose that section anchor with `scroll-mt-16` to clear
the fixed header. Home retries the fragment scroll after role loading and
handles subsequent hash changes, so authentication does not lose the target.
Feed filters and entry permissions are unchanged. `CLAUDE.md` documents the link.

Work is isolated on `fix/calendar-find-game` in
`C:/Users/jay1c/unitr-calendar-find-game`, based on main `9ba8b59`, because
Claude Code is using the original checkout on `mobile`. No mobile files or
original-checkout changes were edited.

Validation: `npm.cmd run build` passed compilation, lint, type checking and
all 62 static pages; the existing four hook warnings and Browserslist notices
remain. `git diff --check` passed. Reviewed each Home variant's target and
the loading guard; browser navigation was not exercised. Not pushed or
deployed. Next step: integrate this branch into main and deploy when requested.

## Previous completed work — 2026-09-21, Codex: Vercel build lint fix

Escaped the apostrophe in the Transfer Market guest message (`we&apos;ll`) in
`app/my-team/transfer/page.tsx:440`. This fixes the `react/no-unescaped-entities`
error reported by Vercel for commit `667f757`; displayed text is unchanged.

Validation: `npm.cmd run build` passed, including lint, type checking and all
62 static pages. The four existing hook dependency warnings and stale
Browserslist notices remain. No browser flow was tested. Preserved existing
`tsconfig.json` edits and untracked `mobile/` work; the build used that existing
configuration. User authorized publishing this web fix to `main` for Vercel
production deployment, excluding all ongoing Claude Code mobile migration
work. Deployment verification is pending.

## Previous completed work — 2026-09-15, Claude Code: schedule shape + the app's clock in admin

Two admin-facing changes, in one session.

**1. Generating a schedule asks how long the games are.** The organiser panel on
`/play/tournament/[id]` now takes a **match length** and a **break between
matches**, and lays kickoffs out at `start + i × (match + break)`. It used to
divide the booked block by the number of fixtures, so an 11-pair round-robin in a
three-hour block produced 16-minute slots nobody had agreed with the venue.

- `app/play/tournament/[id]/page.tsx` — two number fields (defaults 20 / 5) and a
  `plan` memo holding the pairings and where they land. A preview line shows
  `n games · 18:00 – 20:25` before anything is written; an overrun of the booked
  end time is called out in amber with a one-tap "fit to N-min games", which is
  the longest match that still fits at the chosen break. Generate is disabled
  below a 5-minute match. The manual add takes the same length, so one fixture
  added by hand doesn't read as a game of unknown length.
- The break shapes kickoffs only and isn't stored. The match length is written to
  `tournament_matches.duration_minutes` and the fixture list shows a finish time
  under each kickoff, for everyone — not just the organiser who typed it.
- **New migration `supabase_tournament_fixture_duration.sql`** (one nullable
  column; run after `supabase_tournament_schedule.sql`). **Not yet applied.**
  Until it is, generating still works and the finish times are simply absent —
  the read and both inserts go through `withOptionalColumn`.
- `lib/optional-column.ts` — `Result`'s error type gained an optional `code`, so a
  caller can still tell a missing *table* (42P01, "run the migration") from a real
  failure. No behaviour change.

**2. Admin time entry uses the app's own dial.** `/admin/create` had native
`<input type="date">` / `type="time"`, which read differently on every browser;
the fixture kick-off field on the tournament page had the same. All four are now
the app's `DatePicker` / `TimePicker`.

- `components/DateTimePickers.tsx` — `TimePicker` gained an optional
  `minuteStep`. Default behaviour is **unchanged and still whole-hour**, which
  its existing callers (pitch slots, poll dates, venue opening rules) rely
  on. With `minuteStep={5}` the dial runs hours-first, minutes-second like a
  phone's clock picker, with a tappable `9:30 AM` read-out to go back. Past-time
  blocking follows: an hour greys out only when nothing inside it is still
  reachable, and a minute when that exact time has gone.

`npx tsc --noEmit` clean, `next lint` clean on the three changed files, and
`npm run build` succeeded. Not exercised in a browser this session — in
particular the two-stage dial and the overrun warning have not been clicked.

## Previous completed work — 2026-09-15, Claude Code: the availability gate, both halves

Two changes to who may answer "am I playing?", in one session.

**1. Voting unavailable is no longer gated at all.** An unpaid joining fee used
to grey out *both* buttons, so a player who owed money couldn't tell their
captain they were out — the captain read that silence as "hasn't replied" and
chased someone who was never going to play. Ruling yourself out claims no place,
so it's open to everyone now.

**2. Unsettled match fees join the joining fee as a condition for voting
available.** Previously only the joining fee blocked it; outstanding dues from
games already played did not.

- New `lib/availability-gate.ts` — the only place the rule lives.
  `loadAvailabilityGate(teamId, playerId)` returns `{ feeOwedPence,
  duesOwedPence, blocked }`, plus `useAvailabilityGate` and `owedSummary()` so
  no two surfaces name the debt differently. The dues read is deliberately
  narrower than `useMyDues` (which resolves opponents and dates for a payable
  list, and lives in a Stripe-importing file): it sums `share_pence -
  credited_pence` over `payment_collection_status` rows that are `included` and
  not `received`, scoped to the team. Degrades to "owes nothing" on error, per
  the house rule. Concurrent callers share the **in-flight** promise only —
  every card in a list asks at once, but a settled cache would leave the buttons
  greyed after the player paid.
- `components/AvailabilityButtons.tsx` — per-button gate: Available disabled and
  at 40%, Unavailable live. `set()` also refuses a `confirmed` write while
  blocked, so the guard doesn't depend on the disabled attribute.
- `components/AvailabilityModal.tsx` — on the poll, picking dates is the gated
  half; "unavailable for any of these dates" always sends. A blocked player can
  still deselect an existing pick, because the none-of-these option only unlocks
  with nothing selected.
- Copy corrected where the old rule was stated to players:
  `TeamCreditsBar` (both the fee and the dues notices now say the unavailable
  answer is still open) and `PlayerActionStrip` (names both debts when both are
  owed — it previously showed only the fee, sending a player to pay it and
  leaving them still blocked with nothing on screen explaining why).

No schema change and no new migration: this rule has always been client-side
only, with no RLS policy or API route behind it. A determined browser could
always write a `confirmed` row through PostgREST — that was true before these
changes and is unchanged by them.

`npx tsc --noEmit` clean; `next lint` clean on all five files. Not exercised in
a browser this session.

## Previous completed work — 2026-09-13, Codex: pilot tutorial redesign

Redesigned all three `docs/pilot-tutorials/` guides from the user's app-store
examples: one benefit and one real screenshot per slide, 108 px headlines,
consistent UI green / cream / yellow, prominent navigation routes, shared pitch
lines and progress bars. Tightened the crops and reduced the copy to one action
plus a short note. Invites and co-captains have separate captain slides;
team-member post-game top-up remains combined. Counts are now 5 / 10 / 6.

Reused the redacted September 8–9 captures. Live browser capture is unavailable
in this session. Corrected payment navigation against current source and excluded
obsolete settlement headings/5% wording from the selected crops. Refreshed PDFs,
JPEGs, source HTML, offline viewer and shareable ZIP. No app code or live data
changed; no GitHub push was requested.

Validation: export checks passed for one image per slide, crop/highlight bounds,
text overflow and spacing. `verify.cjs` passed PDF/JPEG counts, image decoding,
rendered branding/footer pixels, viewer navigation and mobile/desktop width.
PDF.js extracted every headline, navigation route and app link from all 21 PDF
pages. Visual review covers all slide layouts and focused final crops. Added
`preview.cjs` and `preview.jpg` for a four-card design preview. Application
type/lint/build checks are not applicable to this artifact-only change.

## Previous completed work — 2026-09-13, Codex

Installed the user's selected U/football home-screen artwork, recoloured with
the built-in image tool. The user's follow-up replaces the UI-green version
with the previous home-screen icon's bright `#00E676`, confirmed from the prior
committed generator's `FG = [0x00, 0xe6, 0x76]`. The UI stays `#008000`. Source PNGs
and both final prompts are in `assets/icons/`; generated rasters have small
colour variations, rather than a strictly indexed palette.

- Replaced `app/icon.png` (512 px) and `app/apple-icon.png` (180 px).
- `app/manifest.ts` now points to actual 192/512 px exports in `public/icons/`,
  plus a separately padded 512 px maskable icon. Standalone launch is preserved.
- Replaced the old procedural U generator with a Playwright resizing script
  consuming the approved source artwork. No dependency changes.
- Type check, lint and production build passed. Existing four hook dependency
  warnings and the stale Browserslist notice remain. Local production browser
  checks confirmed the Apple/icon/manifest links, HTTP 200 for every icon and
  matching declared dimensions. All exports are opaque; maskable foreground
  radius measured 37.84% (within the 40% safe circle). Visually inspected exports.
- User approved publishing this icon update to GitHub `main` for automatic
  deployment. Deployment completion and physical phone installation have not
  been verified; existing shortcuts may need removal and re-adding.
  Preserved the prior handoff below.
- Colour follow-up: replaced both source PNGs and regenerated all five exports.
  Rechecked dimensions, opacity and mask-safe radius (37.84%); visually inspected
  the new artwork. `git diff --check` passed. Only images/docs changed in this
  follow-up, so prior type/lint/build results above were not rerun.

## Previous completed work — 2026-09-13, Claude Code

Security pass ahead of the pilot tournament. Six holes, all of them reachable
from a browser with the anon key by skipping the API routes and talking to
PostgREST directly. **Nothing in the payment flow changed for a user**, and no
existing row was touched — every fix blocks a write the app never makes.

- **New SQL — `supabase_pilot_security.sql`** (idempotent, **not yet run**),
  with a verification checklist and a rollback block at the foot of the file:
  1. `refund_event_buyin` and 2. `apply_replenishment` are revoked from
  `authenticated` and granted to `service_role`. Both were `security definer`,
  neither checked its caller, and both were callable from devtools — the first
  returned a team's tournament buy-in to credit while leaving the entry in
  place, the second minted credit against a self-inserted `player_payments` row.
  3. `profiles.account_type` is immutable from a client session (a trigger; an
  INSERT may carry only `player` or `venue_manager`), so nobody can promote
  themselves past `isAdmin()`. 4. `open_matches` and `tournament_invitations`
  writes now belong to the organiser — `/api/tournaments/join` reads the buy-in
  and the discount off those tables and was right to; the tables were wrong to
  let a captain write them. 5. The joining-fee snapshots on `team_members`, and
  `teams.captain_id` plus the captain's copy of the fee, are guarded by triggers
  that allow only the two paths that legitimately move them (the webhook, where
  `auth.uid()` is null, and `record_cash_credit`, which is already captain-only);
  `teams` writes are restricted to leaders. 6. `messages` is readable only by
  its sender and recipient — DMs were world-readable while team chat was not.
- **New route — `app/api/credit/apply-replenishment/route.ts`**: the honest
  caller of the now-revoked RPC. Authenticates the caller, confirms the row is
  theirs and unapplied, retrieves the PaymentIntent from Stripe and requires
  `succeeded`, that it is the caller's own payment (metadata `playerId` or their
  customer id) and that it covers `total_pence`, and that no other row has
  already been credited against it. Same model as the webhook: credit follows a
  verified payment.
- **`app/pay/[matchId]/page.tsx`** — one line: the direct
  `rpc("apply_replenishment")` became `authedPost("/api/credit/apply-replenishment")`.
  The pay screen is otherwise untouched.

### Validation
`npx tsc --noEmit` clean; `npx next build` compiles, `/api/credit/apply-replenishment`
registered, only the pre-existing `react-hooks/exhaustive-deps` warnings. **The SQL
has not been run** — apply it in the Supabase editor and work the verification block
at the foot of the file (seven writes that should now fail, five flows that should
still work).

### Known-remaining, deliberately not done
- **`team_members` still takes any insert**, so a user can write themselves an
  `approved` membership in any team — which also defeats the squad-only RLS on
  team chat. Fixing it means `join_team_by_invite` has to mark its own inserts as
  legitimate, i.e. redefining that function; not worth doing to a live invite
  flow without asking.
- **`profiles` is world-readable, `stripe_customer_id` / `stripe_payment_method_id`
  / card brand + last4 included.** A `pm_…` id is not chargeable without the
  secret key, but it is PII. The fix is to move those four columns to a table with
  own-row RLS and update the five read sites — a data migration, not a mid-pilot
  change.
- **`split_pitch_fee`, `release_hold`, `reimburse_secured_pitch`** are the same
  class of unguarded definer function as §1 and §2, but they are called from
  `ChallengePanel` in the browser, so they need caller guards rather than a
  revoke. Friendlies, not the pilot.
- **No security headers** (`next.config.js` is empty) — HSTS, `X-Frame-Options`,
  `Referrer-Policy`, `X-Content-Type-Options` are worth adding; a CSP is not,
  it risks Stripe's iframes.
- **Next 14.2.5** has known CVEs. There is no `middleware.ts`, so CVE-2025-29927
  has nothing to bypass here. A patch bump within 14.2 is low-risk.
- **No rate limiting** on any API route.


## Previous completed work — 2026-09-12, Claude Code

Made the registration answers editable afterwards, for both a team and a player,
and turned two of them into multi-selects.

- **Team Settings** (`/my-team/settings`) gained
  `components/my-team/TeamDetailsPanel.tsx`: name, location, level, players per
  side and description — everything `/my-team/create` asks. Players per side is
  a **multi-select** here; a rename updates the page header and invite panel
  without a reload. The joining-fee block, invite link and co-captains panel are
  unchanged. Reachable by a co-captain too (`loadLeadership().canManage`), like
  the rest of the page.
- **Profile** (`/profile`): the Edit Profile button did nothing at all before and
  now opens `components/EditProfileSheet.tsx` — full name, **positions
  (multi-select)**, experience, age group, gender, games per month, preferred
  type of football. A new "About You" card shows the four answers that had never
  been displayed anywhere, so an edit visibly changes something. The chip row
  under the avatar lists every position; the line under the name keeps the
  primary one.
- **New SQL — `supabase_multi_select_preferences.sql`** (idempotent, no
  dependencies, **not yet run**): adds `teams.formats` and `profiles.positions`,
  backfilled from the scalars. The scalar stays the *primary* value and is
  rewritten on every save, so `teamSizeFromFormat`, the tactics boards and every
  unmigrated reader keep working untouched.
- **New libs**: `lib/team-options.ts` and `lib/profile-options.ts` own the option
  lists (now imported by `/register` and `/my-team/create`, so the forms can't
  drift) and are the only place either scalar/array pair is read or written.
  `lib/optional-column.ts` runs a statement that names a possibly-missing column
  and re-runs it without that column if Postgres objects — the house
  "missing migrations degrade" rule, reusable.
- **Filters now match any value**: Transfer Market, `/my-team/players` and
  `TeamsPanel`. Display sites updated: both team pages, the market cards, search.
  `MembersTab` / `StatsTab` still show the primary position only — their selects
  are already nested inside the `is_co_captain` fallback and weren't worth
  compounding.

`CLAUDE.md` updated: new "Team details, and the two multi-select answers" section,
the `/my-team/settings` and `/profile` rows, and the data-model table.

### Validation

- `npx tsc --noEmit`: clean. `npx next build`: exit 0. `npm run lint`: no new
  warnings (the pre-existing `react-hooks/exhaustive-deps` ones remain).
- **Not exercised in a browser, and the migration has not been run**: nothing was
  saved against real data, so the save paths, the backfill and the
  degrade-without-the-column fallbacks are reasoned, not observed. Running
  `supabase_multi_select_preferences.sql` is the next step, then saving a team's
  details and a profile once each.

## Previous completed work — 2026-09-09, Codex

Created three UNITER app icon concepts in `docs/app-icon-concepts/`: football,
team huddle inside a crest, and community figures forming a U. Each PNG is an
original 1254 × 1254 generated export. The folder includes an offline comparison
page with 64 px / 48 px and circular-mask previews, plus the final prompt set.

Revised the community U at the user's request as
`uniter-community-huddle-v2.png`: five more realistic players leaning inward,
arms visibly around shoulders, no blue accent, and a small football beside the
U. Preserved the original PNG, saved the edit prompt and updated the comparison's
third card. The revised export is also 1254 × 1254 and fully opaque.

Used the built-in image generation tool. Regenerated an initial pass that had
unwanted transparency; final images were visually inspected and all pixels
checked as fully opaque. Playwright checks at 1200 px and 390 px confirmed all
12 image instances loaded, three download links and no horizontal overflow.
Inspected the desktop preview and small icons; `preview.png` captures that page.
`git diff --check` passed. No application icons, manifest, dependencies or product
behaviour changed; application type/lint/build checks are not applicable to these
concept assets. Next step is selecting a direction before production icon exports.

## Previous completed work — 2026-09-09, Claude Code

Split **Settle Payments** (issuing what the squad owes) from **Payment Status**
(tracking who has paid), which had been blurred: the Payment Status sheet opened
titled "Collect Payment", and the joining-fee *tracker* lived inside Settle
Payments with no way to change the fee itself short of Team Settings.

- Both sheets now carry a **Fixtures / Joining fee** tab pair, captains only.
  New `components/JoiningFeePanels.tsx` holds the two halves:
  `JoiningFeeAmountPanel` (writes `teams.joining_fee_pence`; permanent tab, so
  there's somewhere to set a fee when none exists) and `JoiningFeeStatusPanel`
  (per-member paid/due off the snapshots, with Remind) — the latter moved out of
  `SettlePaymentsModal` unchanged apart from an empty state and a `viewerId`
  rename.
- `payment_collection_status.received` is now written in exactly one place,
  `markReceived` in `TeamCreditsBar`. Settle Payments' fixture panel keeps a
  read-only receipt of what was charged and points at Payment Status; its
  header reads "Payment request" / "Not issued yet" rather than "Collect
  Payment".
- Payment Status stops filtering out fully-paid fixtures so a mistaken tick can
  be undone; its red badge counts only fixtures still owed, so the number still
  means "needs you".
- Fixed the stale "+ 5% fee" / "(inc. 5% fee)" wording flagged in the previous
  handoff (`SettlePaymentsModal`, `app/pitches/page.tsx`) — both now derive from
  `UNITER_FEE_ENABLED` / `UNITER_FEE_LABEL`, so at the current rate of 0 the fee
  clause disappears instead of claiming a charge that isn't made.
- Unrelated, same session: the tournament schedule's "Set lineup & tactics"
  button is green (`app/play/tournament/[id]/page.tsx`).

No SQL, dependency or deployment change. `CLAUDE.md` updated (new "Settle
Payments vs Payment Status" section under Payment model, plus the joining-fee
and `/my-team/history` lines).

### Validation

- `npx tsc --noEmit`: clean. `npx next build`: exit 0.
- `npx next lint` on the touched files: only the two pre-existing
  `react-hooks/exhaustive-deps` warnings already listed below
  (`SettlePaymentsModal`, `app/pitches`).
- **Not exercised in a browser**: no payment request was issued, marked paid or
  reminded against real data, and no joining fee was saved. The mark-paid write
  and the `fees_settled` roll-up are ported logic, not re-verified end to end.

## Previous work — 2026-09-09, Codex

Created shareable pilot tutorial slides from the deployed app and existing demo
Korean Tournament. Deliverables live in `docs/pilot-tutorials/`:

- Three portrait PDFs: new users (5 slides), captains (9), team members (6).
- Matching numbered JPEGs for group chats, an offline role-selecting viewer,
  and a ZIP containing the shareable files.
- Editable copy/crop definitions, redacted screenshots and a Playwright-based
  export script; instructions and capture limitations in that folder's README.

Added `.vscode/settings.json` to associate `*.pdf` with the installed PDF
Preview editor (`pdf.preview`). VS Code was opening exported PDFs as text and
raising an “Unusual Line Terminators” warning after encountering a byte pattern
inside a compressed image stream. The captain PDF is a valid nine-page PDF:
it has a `%PDF-1.4` header and `%%EOF` trailer. Reload the VS Code window once
to apply the new editor association.

Captain guide revised as requested: removed the final slide; merged the two
availability slides and the two lineup slides using the exact user-supplied
screenshots; enlarged the opening Home capture with its yellow callouts; renamed
collection to “Collect payments after each game” and removed “message” from its
second instruction. Slide 6 now highlights Manage match in yellow; the following
slide uses the existing formation-screen capture to explain formation selection,
player assignment and Save Lineup. Updated the PDF, numbered images, viewer and
complete ZIP.

Merged team member slides 6–7 into one post-game top-up explanation, retaining
only the top-up screenshot. All guides now show navigation routes in larger bold
white text on green banners with yellow accents. Rebuilt all artifacts and
removed the obsolete seventh team-member JPEG.

Preserved the separate in-app tutorial work. The checkout initially contained
changes to `TopBar.tsx`, `TutorialSheet.tsx` and `tutorial-content.ts`; those were
committed independently during this task as `1fdf2fc`. This task changes no app
behaviour, dependencies, SQL or deployment. Tutorial artifacts are uncommitted.

## Validation

- `node --check docs/pilot-tutorials/build.cjs` and `slides.cjs`: passed.
- Export completed; automatic heading/copy/footer overlap checks passed.
- Representative updated layouts from all three guides and the merged payment
  slide were visually inspected. PDF page counts are 5 / 9 / 6; each PDF
  contains the app link.
- Offline viewer: all 20 images loaded; role switching, navigation and end
  boundaries checked; no horizontal overflow at 390px; mobile and desktop
  screenshots inspected.
- No fresh tournament entry, card payment, payment request, message, poll,
  promotion or team membership was submitted. Opening the existing message can
  mark it read. Credentials and browser sessions are not in the deliverables.
- Application type/lint/build checks were not rerun for this artifact-only task.
  The earlier onboarding baseline passed type checking and lint, with four hook
  warnings (`app/pay/[matchId]`, `app/pitches`, `BookPitchPanel`,
  `SettlePaymentsModal`); it is not validation of subsequent app commits.

## Known limitations and next steps

- Demo team was already entered, so the entry slide shows the actual entered
  state and describes the pre-entry action in text. No live poll exists. The
  player has an unpaid joining fee, so its availability buttons are disabled;
  the guide explains this. Existing joining-fee reminder and saved game lineup
  supply the message and lineup examples. Payment confirmation was not exercised.
- ~~Deployed settlement wording still says “entry fee + 5% fee”~~ — fixed in
  source this session (see above); the deployed build still shows it until the
  next deploy. The tutorial does not assert a 5% fee.
- User can send the appropriate PDF or role's numbered images now. Refresh
  screenshots and example values if the final pilot or deployed UI changes.
- Payment environment and remotely applied migrations remain unverified. Do not
  infer a sandbox from test account names or historical plans. Core database
  bootstrap is not fully represented in versioned SQL.

Keep durable product rules in `CLAUDE.md`, workflow in `AGENTS.md`, and current
state here. Check Git before work; this file is a dated snapshot.
