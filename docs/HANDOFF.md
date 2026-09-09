# Uniter handoff

## Latest completed work — 2026-09-09, Claude Code

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
