# Uniter pilot tutorials

Three role-specific guides made from the deployed app at
https://unitr-omega.vercel.app/, captured on 8 September 2026. Captain revisions on 9 September use a fresh
Home capture and the two screenshots supplied by the user.

## Ready to share

- `Uniter-new-users.pdf`: 5 slides, for people creating or joining a team.
- `Uniter-captains.pdf`: 9 slides, from team setup through tournament payments.
- `Uniter-team-members.pdf`: 6 slides, for availability, lineups and contributions.
- `images/`: the same slides as numbered 1080 × 1600 JPEGs, grouped by audience.
- `index.html`: an offline viewer with a role selector, previous/next buttons,
  keyboard navigation and touch swipe. Keep it beside the images and PDFs.
- `Uniter-pilot-tutorials.zip`: the PDFs, images, viewer and this README together.

Send the appropriate PDF as a document attachment in a group chat or email.
For a chat carousel, select that role's numbered images in order. The app URL
is printed on every image and clickable in each PDF. The ZIP is for handing
over the complete pack; recipients need only their role's PDF or images.

Suggested accompanying message:

> Here’s the quick Uniter guide for your role. Please run through it before
> the pilot: join your team, pay any joining fee, submit availability and check
> your lineup. Open the app: https://unitr-omega.vercel.app/

## What the examples show

Screens use the existing demo team and Korean Tournament. The displayed event
date, £50 entry, £1 joining fee, balances and fixture times are demonstration
values, not confirmation of the final pilot arrangements.

The captain's team was already entered, so the entry slide shows the actual
entered state and explains the pre-entry action in text. No new tournament
entry, charge, transfer, refund, message, payment request, poll, promotion or
team membership was submitted to create these guides. Opening the existing
direct message can mark it read.

The player has an unpaid joining fee, so the availability slide shows the real
disabled state and explains how to unlock it. No live poll exists; the guide
uses the supplied Availability screenshot and explains player poll responses in text.
There is a saved game lineup, but no saved general team tactics. The final
team-member slide explains topping up after each game using the top-up screen.
Payment confirmation and a fresh paid tournament entry were not exercised.

Private names and the team invite token are masked in the source captures.
The screenshots have been cropped and annotated; no interface or data state
has been invented. Browser credentials and sessions are not part of this pack.

## Rebuilding and review

The editable slide copy, crops and annotations are in `slides.cjs`. Source
captures are in `screens/`. From the repository root, with its existing
Playwright dependencies installed, run:

```powershell
node docs/pilot-tutorials/build.cjs
```

This regenerates the three PDFs, three standalone source HTML decks, JPEGs and
`validation.json`, without connecting to the app. The generated source HTML
decks are print layouts; use `index.html` for responsive viewing. Repackage the
ZIP after rebuilding. Keep the viewer's slide totals in step with content edits.

The generator checks that headings, route labels, body copy and footers do not
overlap. Exported slides were visually inspected and PDF page counts checked;
the viewer was checked at mobile and desktop sizes. No application code or
dependency changes were needed.

Observed product issue: the deployed settlement screen still says
“entry fee + 5% fee” while displaying a £50 total for the £50 entry. Current
source has a zero fee constant. The guide uses the displayed total and does
not claim a 5% rate; the stale interface label remains visible in the genuine
screenshot. Resolve that wording in a separate app change.
