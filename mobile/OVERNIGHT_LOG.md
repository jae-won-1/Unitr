# Overnight log — 29/30 September 2026

Written while you slept, on your instruction to carry on with the React Native
transition and approve everything that isn't critical. A summary first, then
every decision I made on your behalf, then one test list to run through in a
single sitting.

## Summary

**What the phone app can now do** (on top of Phases 0–2):

- **Sign up and sign in properly.** Full registration, a profile gate for
  accounts with no profile, Profile with Edit Profile, a saved card, Friends
  and Sign out.
- **Money, worded for the App Store.** Pay what you owe (joining fee, match
  shares), Fill In by card, enter a tournament with any shortfall paid "towards
  the buy-in", and save a card. All through Stripe's native payment sheet, test
  mode.
- **The pilot's tournament loop end to end.** Find and enter an event, see its
  schedule, results and table, answer availability, set each game's lineup
  (or load a saved setup), then issue the squad's payment requests afterwards.
- **Team life.** Messages (inbox, team chat, one-to-one, start a conversation
  from the squad), the notification bell, availability polls (answer and run),
  announcements, join requests, Team Settings (details, invite link,
  co-captains, joining fee), Tactics, Transfer Market, and find/join/register a
  team.

**What's still web-only on purpose:** the friendly flow (post a match,
Challenge, Manage match, results, ringer requests), pitch booking, marking a
payment as received by hand (Payment Status), all organiser/admin/venue tools,
and Connect Google. The friendly flow is the next big piece. It holds and moves
team money, so I left it for when you can review it.

**Not done: running it on a phone.** Every change is type-checked and linted,
and both the Android and iOS bundles build. But nothing has been tapped
through, which is the list at the bottom.

## Check these first (they touch the live website)

1. **Create an availability poll on the web** (row 24): the code behind it moved
   into a shared file tonight. Check a poll still sends, and that sending a
   second one replaces the first.
2. **A brand-new Google account on the web** (row 32): after finishing
   `/welcome`, check you stay on Home rather than bouncing back to `/welcome`.
   I spotted this possibility reading the code, didn't change anything, and it
   would affect new sign-ups now that Google is live.
3. **Delete the test data you create** while testing (test accounts, test teams,
   test tournaments). All testing runs against the live database.

## Ground rules I held to

- **No writes to the live database.** Seed scripts are written, never run.
- **No force-pushes, no deleting branches or data, no dashboard changes**
  (Stripe, Supabase, Google Cloud, Vercel).
- **`main` only receives shared code for the phone**, each change type-checked
  and built before pushing (they deploy to Vercel): moves of pure data code
  into `lib/`, checked identical to what they replaced, and two new files the
  web doesn't use yet (`lib/authed-fetch.native.ts`, `lib/direct-messages.ts`).
  **One exception** isn't a pure move: poll creation (row 24, `ea826c8`), which
  is why it's in "Check these first" below. Everything else lands on `mobile`.
- Every mobile change is type-checked and linted before commit. None of it has
  run on a phone — that is what the test list is for.
- **Both phone bundles build.** At `f3c8dfa`, and again on the final state at
  `6ebe806`, I ran a full Metro export for
  Android and for iOS (`npx expo export`): every screen and shared file
  resolves and compiles to Hermes bytecode, with no warnings. That proves the
  app *assembles*; it doesn't prove it *runs* correctly, which is the test list.

## Decisions made on your behalf

| # | Decision | Why | Commit |
|---|---|---|---|
| 1 | Challenge and Enter stay greyed until Phase 4 (your call, recorded). | Their failure case needs a captain's payment sheet that doesn't exist yet. | a519a81 |
| 2 | Payments tested against a local test-mode server, not the live API. | The phone's pk_test key can't confirm an intent made with the live secret key. | 33152bd |
| 3 | Pay sheet built with no free-amount top-up. | Your wording decision: a balance you add money to looks like a digital wallet to Apple. | e6a6a6d |
| 4 | Moved `saveCardFromIntent` into `lib/save-card.ts` on **main** (unchanged code, re-exported). | Mobile needs it to save a card after paying. Built and type-checked before pushing; no behaviour change. | 48aca6e |
| 5 | "Save this card" switch added to the pay sheet only, **not** to Fill In. | Fill In goes straight into Stripe's sheet with no screen of ours to put a switch on. Stripe's own save box needs a new server route (ephemeral keys), which is a server change I didn't want to make unsupervised. | dcadf1f |
| 6 | Built a Profile screen, reached from an avatar button at the top-right of each tab, not a fourth tab. | Mobile had no way for a player to sign out at all. The web app keeps three tabs and puts Profile behind the avatar; same here. | 05c2c27 |
| 7 | Profile leaves out **Connect Google**, with a note pointing to the web app. | Linking Google inside the phone app is an OAuth round trip that needs the app added as a redirect in Supabase and Google Cloud, which is dashboard work. | 05c2c27 |
| 8 | Profile leaves out **Friends** for now. | Its only action is "message this friend", and Messages isn't on mobile yet. | 05c2c27 |
| 9 | Sign out asks for confirmation first. | On a phone it sits under your thumb at the bottom of a long scroll. | 05c2c27 |
| 10 | Added `lib/direct-messages.ts` on **main** as a new file; the web inbox and thread pages were **not** changed to use it. | The web pages run these queries inline. Moving them onto the shared file is a refactor of live pages, which I didn't want to do unsupervised. As a new file it changes nothing on the web. The web pages can switch over later. | 2c0990c |
| 11 | Built Messages on mobile: inbox, team chat, one-to-one threads, plus a chat icon with an unread dot beside the avatar. | Phase 5 of the plan; it involves no money and was the largest gap left for players. | 592a22e |
| 12 | One-to-one threads on mobile **poll for replies every 5s**; the web thread doesn't. | On a phone you put the app down and pick it up again. A thread that only updates when you reopen it reads as broken. | 592a22e |
| 13 | Polling pauses while the app is in the background. | The migration plan's note for team chat: use AppState on native in place of the web's hidden-tab check. | 592a22e |
| 14 | Team chat's options menu (mute, leave, rejoin) uses the phone's own action sheet, and leaving asks for confirmation. | It's the native equivalent of the web's ⋯ menu, and leaving hides new messages, so it's worth one extra tap. | 592a22e |
| 15 | Captains can approve or decline join requests on mobile, from My Team. | Home showed the count, but there was nowhere to act on it. | 1cb802d |
| 16 | Team Settings ported whole: team details, invite link, co-captains (captain only; greyed for a co-captain, as on the web), joining fee. | It's the first thing a new captain needs, and every write goes through shared code or the web's own database functions. | 1cb802d |
| 17 | The invite link shared from the phone uses the **website** address (`EXPO_PUBLIC_WEB_URL`, defaulting to the Vercel URL), not the API address. | The web builds it from the browser's address, which a phone doesn't have. The API address points at your PC while payments are being tested, and a link to that would be useless to anyone else. | 1cb802d |
| 18 | Invite link: Share only (the phone's share sheet includes Copy). No separate Copy button. | A Copy button needs another native module (expo-clipboard); the share sheet already covers it. | 1cb802d |
| 19 | Post announcement ported with its own copy of the web page's two database writes, rather than moving them into `lib/`. | On the web they're inline in a live page; extracting them would be a refactor I didn't want to make unsupervised. Noted in `PORTED.md` so they're kept in step. | 1cb802d |
| 20 | The web's announcements **list** page isn't ported. | Every announcement already arrives in each player's Messages inbox, which mobile now has. | 1cb802d |
| 21 | Joining fee help text on mobile says "towards your pitch bookings and tournament entries" rather than the web's "into your team's credit balance". | Your wording decision for mobile. | 1cb802d |
| 22 | Moved `useAvailabilityPoll` into `lib/availability-poll.ts` on **main** (unchanged code, re-exported), and dropped two unused imports from the web modal. | Mobile needs the poll to let players answer it. Built and type-checked before pushing. | 4a4e7e7 |
| 23 | Players can answer the captain's poll on mobile, from a "Proposed dates" card on Home. | Mobile could answer per-game questions but not the poll, which is the other half of the same question. | a909cd7 |
| 24 | Moved poll **creation** into `lib/availability-poll.ts` on **main**. This one isn't a pure move: `AvailabilityPollForm` on the web now calls the shared function, and option ids fall back to a random id where `crypto.randomUUID` doesn't exist (phones only; every browser has it, so the web behaves as before). | The web file warns that the one-live-poll-per-team rule would drift if it were copied twice. Reviewed the diff line by line and built it before pushing. **Please test creating a poll on the web too.** | ea826c8 |
| 25 | Built the captain's poll screen on mobile (My Team → Availability poll): see answers, propose new dates, close the poll. | It completes the poll, which players can now answer on mobile too. | ba88fd4 |
| 26 | Built a simple date-and-hour picker (a strip of days, a grid of whole hours from 07:00 to 22:00) instead of the web's clock dial. | The plan says to keep the dial's rule (whole hours by default) rather than copy its look. Past hours today are disabled. | ba88fd4 |
| 27 | When every slot in a poll has passed, the captain's screen closes it automatically. | That's what the web captain page does, so the squad stops being asked about dates that have gone. | ba88fd4 |
| 28 | Left out the web's "pick up to 3 dates → post matches" step. | It hands off to match posting, which isn't on mobile yet. | ba88fd4 |
| 29 | Built full **Create an account** on mobile, replacing the old email-and-password-only sign-up. | The old one made logins with no profile (no name, no position). The new one asks everything the web form asks and saves through the same shared code. | 449ca4f |
| 30 | Added a mobile **Finish setting up** screen, and the app now sends any signed-in account with no profile there first, like the web's ProfileGate. | This catches accounts already created by the old mobile sign-up, and would catch a Google account later. | 449ca4f |
| 31 | After saving a profile, the mobile screens refresh the login session. | The shared role check only looks again when the signed-in user changes, so it would otherwise go on thinking the profile is missing and bounce you back to Finish setting up. | 449ca4f |
| 32 | ⚠️ **Not changed, but worth checking on the web:** the web's `/welcome` may have the same problem, sending a brand-new Google account back and forth between Home and `/welcome` after they finish. | I noticed it reading the shared role code; I haven't reproduced it. It would affect new Google sign-ups, which went live today. | — |
| 33 | Arriving on mobile through a team invite link isn't handled. | Invite links open the website, which handles joining. | — |
| 34 | A player with no team can now find and join a team, or register their own, on mobile (My Team). | Previously the screen only said "use the web app", which left a new sign-up with nothing to do. | 75f001b |
| 35 | The team search on mobile actually filters, by name or location. | On the web the search box is drawn but does nothing. Mobile does what it looks like it does; the web is unchanged. | 75f001b |
| 36 | Home and My Team now re-check your team every time you come back to them. | The shared team lookup only refreshes when the signed-in user changes, so creating, joining or leaving a team wouldn't show up until the app restarted. | 75f001b |
| 37 | Built the per-game tournament page on mobile: kick-off, referee, score, the squad's answers, and the captain's lineup board with formation, style and notes. It opens from "Your games" in the Calendar's tournament sheet. | Tournaments are the pilot's focus, and setting a lineup is the thing a captain does before each game. Every read and write goes through the shared tournament and formation code. | 616b4e5 |
| 38 | Folded the web's separate Tactics tab (style and notes) under the lineup board. | On a phone, three tabs fit and four are cramped, and a captain thinks about style while looking at the board. | 616b4e5 |
| 39 | Loading a saved team preset into a lineup isn't ported. | Presets are loaded by code inside the web's Tactics tab component rather than a shared file. Moving it is for when the Tactics screen itself is ported. | — |
| 40 | The full tournament schedule page (all teams, standings, organiser controls) isn't ported; the fixture page points to the web app for it. | It's the organiser's screen and much bigger. Players get their own games on mobile. | — |
| 41 | Added the notification bell to mobile (beside Messages) with a Notifications screen and Mark all read. | Captains get notified here when an event is cancelled and refunded, when they're removed from an event, or when a joining fee goes up. Mobile showed none of it. | 71b0e88 |
| 42 | Tapping a notification opens the matching phone screen when there is one (messages, a tournament game, My Team, Team Settings, Profile, Calendar), and otherwise just marks it read. | Notification links are website addresses, and some point at screens the phone doesn't have yet. | 71b0e88 |
| 43 | The web bell's three computed counts (join requests, open posts, dues) aren't repeated in the mobile bell. | They already have places on mobile: join requests on My Team and Home, what you owe on Home. | 71b0e88 |
| 44 | **Enter** (a tournament) is now live on mobile for captains and co-captains, from the Find a game feed. **Challenge** stays greyed. | You said to leave both until Phase 4, which is now under way. Tournaments are the pilot's money path. Enter needed no new top-up screen (next row); Challenge needs the whole friendly flow (pitch pick and hold). | 829d313 |
| 45 | If the team can't cover the buy-in, the phone offers to pay **exactly the shortfall**, worded "Pay £X towards the buy-in", then enters automatically. There's no free-amount top-up screen. | It's the same money path underneath (a payment into the team's account, then the buy-in taken), but worded around the real thing being paid for, per your App Store decision. The web's top-up flow is unchanged. | 829d313 |
| 46 | After a shortfall payment, the sheet never offers to take payment again, even if the payment is slow to register. It shows "try entering again" instead. | Prevents a double charge if the Stripe webhook is slow and the captain taps again. | 829d313 |
| 47 | Built a **read-only** tournament page on mobile: details, a banner if it was cancelled, entered teams, the whole day's schedule (finish times, scores, referees), the table, and Enter for a captain whose team isn't in. | Players and captains need it on the day. It opens from the Calendar sheet (that button is now live) and from a tournament's title in the feed. | 87cc55a |
| 48 | Left **all organiser controls** off mobile: drawing up the schedule, appointing referees, entering scores, rating players, taking the event down, removing a team. | The migration plan keeps organiser and admin tools on the web for v1, and those are the controls that move refunds and results. | — |
| 49 | Moved Settle Payments' tournament data helpers into `lib/settle-payments.ts` on **main** (unchanged code; the web modal imports them back). | Mobile needs the same reading of what the team paid for an entry (the debit at entry, including any invitation discount). Checked that the moved code is identical, and built it. | 3d619a5 |
| 50 | Captains can **issue** a tournament's payment requests on mobile (My Team → Settle payments): pick who took part and send. It writes the same rows and reminder messages as the web. | It closes the pilot's money loop on the phone: enter, play, ask the squad for their shares, and they pay in "What you owe". | f3c8dfa |
| 51 | After issuing, the phone shows who has paid **read-only**. Marking a payment off by hand (cash), reminding and removing a player stay on the web's Payment Status. | CLAUDE.md wants "paid" recorded in one place. Players who pay through the app are still marked off automatically. **Worth knowing:** the web's own pay flow (`applyTopUp`) already writes "paid" too, so that rule is looser than CLAUDE.md says. I haven't changed anything there. | f3c8dfa |
| 52 | Settle payments on mobile covers **tournaments only**, not friendlies. | Friendlies can't be played on mobile yet. | — |
| 53 | Tapping anyone in the My Team squad opens their details with a **Message** button. The captain is now listed first in the squad. | Mobile could reply to conversations but not start one. The captain wasn't in the list at all (the list is the co-captain picker's), and they're who players most want to message. | 219c009 |
| 54 | Moved the tactics preset data (`loadTeamTactics`, `loadSquadOptions`) into `lib/team-tactics.ts` on **main** (unchanged code, re-exported; move checked identical, built). | Mobile needed it for the Tactics screen and for loading a setup into a game. | c810e9f |
| 55 | Built Tactics on mobile (My Team → Tactics): the whole squad can read the saved setups; captains and co-captains can create, edit and delete them on the pitch board. | It completes the captain's pre-match tools alongside the tournament lineup. | 07a5c1d |
| 56 | Added **Load a saved setup** to a tournament game's lineup. Players who said they're out, or who have left, are dropped when it loads. | This was the gap left on the fixture page earlier tonight. It follows the web's rule for loading a preset. | 07a5c1d |
| 57 | Ported the Transfer Market to mobile (My Team → Transfer Market): search players and teams, add friends, captains send offers to free agents, ask to join a team, and an inbox for team offers and friend requests. | Its data and every action were already in a shared file, so this was UI work only and can't behave differently from the web. | d2af76a |
| 58 | "View profile" in the market opens the player sheet (details and Message); there's no "View team" on mobile. | The phone has no public team page yet. The player sheet already exists and lets you message the player. | d2af76a |
| 59 | Added the **Friends** list to Profile; each friend opens their details with Message. | Left out earlier because its only action was messaging, which now exists. The query copies the web Profile's, in a small local function. | d5051d2 |

## Test checklist (do these together later)

Setup once, before any of it:

1. Paste your `sk_test_` key into `.env.development.local` (repo root).
2. `npm run dev` in the repo root — the startup lines should list
   `.env.development.local`. (I stopped your earlier dev server by mistake.)
3. `cd mobile && npx expo start`, scan the QR code with Expo Go. Phone and PC on
   the same Wi-Fi.
4. When finished testing payments, set `EXPO_PUBLIC_API_BASE_URL` in
   `mobile/.env` back to the Vercel line.

Tests:

- [ ] **Fill In payment.** `node mobile/scripts/ringer-test-fixture.mjs seed`,
      sign in as `testcaptain@gmail.com`, Home → Find a game → Fill In → Join.
      Pay with `4000 0027 6000 3184` (forces 3D Secure). Expect "You're in" and
      the card to show "You're in". Then `... undo` immediately.
- [ ] **Leave team** on My Team: greyed with a reason for a captain; red with a
      second confirmation for a player. (Don't confirm on a real account.)
- [ ] **What you owe** strip on Home (needs Stripe CLI webhooks — see
      `mobile/PORTED.md`, Phase 3 note — and writes to the live ledger).
- [ ] **Save this card** in the pay sheet: with no card on file, the switch shows; turn it on, pay, then reopen the sheet — it should now say payments go to your saved card, and ask you to confirm before charging.
- [ ] **Profile**: tap the avatar (top right) on Home, Calendar and My Team. Check name, positions, About you. Edit Profile: change positions (first pick shows "main") and an answer, save, and see it update.
- [ ] **Add a card** on Profile (test key, `4242 4242 4242 4242`, or `4000 0027 6000 3184` for 3D Secure). Expect "Visa •••• 4242 · Saved". Then **Remove** it. Uses a test account only — it writes the card to that account's profile.
- [ ] **Sign out** from Profile: confirmation, then the sign-in screen, and Back doesn't return into the app.
- [ ] **Messages icon** (top right, beside the avatar): the red dot shows when you have unread messages and clears after reading. Muting the team chat should stop the chat counting towards it.
- [ ] **Team chat**: open it from the inbox, send a message, and see it appear. From the web app (or a second account) send one back; it should arrive on the phone within about 5 seconds. Scroll up, have a message arrive, and check the **New messages** pill brings you back down.
- [ ] **Team chat menu** (⋯): turn notifications off and on; Leave (confirm), which should show "You left this chat" with Rejoin; then Rejoin.
- [ ] **One-to-one thread**: open one from the inbox, send, and check a reply arrives within about 5 seconds.
- [ ] **Keyboard**: in both chats, the message box should stay above the keyboard on your phone. This is the part most likely to look wrong on Android.
- [ ] **Join requests** (as a captain, with a request pending, e.g. from a test account): Approve and Decline on My Team. An approved player should appear in the squad and get the welcome message.
- [ ] **Team Settings** (My Team → Team Settings, as captain): edit details and save; formats show "main" on the first pick.
- [ ] **Invite link**: Share opens the phone's share sheet; the link starts `https://unitr-omega.vercel.app/join/…` and works when opened. **Reset link** asks first, and the old link stops working.
- [ ] **Co-captains**: switch someone on and off as the captain. As a co-captain, the section is greyed with an explanation.
- [ ] **Joining fee**: change it and save. This changes what the whole squad owes, so use the Test team only.
- [ ] **Post announcement**: type `@` and a letter, tap a suggested name, post. Everyone in the squad should get it in Messages.
- [ ] **Poll** (needs a live poll — create one on the web as captain): on Home, a "Your captain proposed dates" card appears. Pick dates and Submit; the card then says "n dates sent". Reopen and change to "Unavailable for any of these".
- [ ] **Poll while owing money** (Test team account with an unpaid joining fee): dates can't be picked, "Unavailable for any" still sends, and **Pay now** opens the pay sheet.
- [ ] **Web: create a poll** (My Team → Collect availability, or the captain's Home tile) — this code moved into a shared file tonight, so check it still sends, and that sending a second poll replaces the first.
- [ ] **Mobile: captain poll** (My Team → Availability poll): add 2–3 date options with the Date and Time fields (each opens centred; past days and past hours today should be greyed), send, and check the squad sees "Your captain proposed dates". Answer from a player account, then check the counts, the "Best" slot and the initials on the captain's screen. Try **New poll** (warns it replaces the current one) and **Close poll**.
- [ ] **Web, important: brand-new Google account.** In a private window, Continue with Google with an account that has never used Uniter, and fill in `/welcome`. Check you land on Home and **stay** there, rather than flicking back to `/welcome`. If it loops, tell me: it's a live bug for new sign-ups, not a mobile one.
- [ ] **Mobile: create an account** (Sign in → "New here? Create an account"). Try it with a throwaway email; it creates a real account in the live database, so delete it afterwards in Supabase → Authentication → Users. Check the validation (password under 8, mismatch, unanswered questions), then that you land on Home with your name in the greeting.
- [ ] **Mobile: finish setting up.** Sign in on the phone with an account that has no profile (the Step-0 list had three: `jay1choii1@`, `emilytony1108@`, `jeehan.kim05@`; use your own). You should be taken to Finish setting up, and land on Home after answering. "Use a different account" signs out.
- [ ] **Find a team** (as a player with no team, e.g. a new test account): search by name and by area, filter by level, then Request to join. The button should stay "Request sent" after leaving and reopening the tab, and the captain should see the request.
- [ ] **Register a team** (as a teamless test account): fill it in and create. You should land on My Team as captain, with Invite players and Team Settings showing, without restarting the app. Delete the test team afterwards in Supabase if you don't want it listed.
- [ ] **Tournament games** (needs an entered tournament with fixtures drawn up, e.g. on the Test team): Calendar → tap the tournament → "Your games" lists each game; tap one.
- [ ] **Fixture page as a player**: Info shows kick-off, pitch and referee; Attendance shows the squad's In / Out / Pending for the day; Lineup is read-only.
- [ ] **Fixture page as captain**: pick a formation, tap positions to choose players (someone who said Out shouldn't be offered; picking someone already placed moves them), set a style and notes, **Save lineup**. Then open the same game on the web and check it matches (same players in the same positions).
- [ ] **Bell** (top right): the dot shows with unread notifications. Open it, tap one (it goes grey and opens the right screen if it links somewhere the phone has), then Mark all read. To get one to test with: the removing-a-team feature and changing a joining fee both create notifications on the Test team.
- [ ] ⚠️ **Enter a tournament — use a test event only.** This moves the team's real money in the live database. Create a cheap test tournament on the web (admin or Test-team hosted), then on the phone, as the Test team's captain: Find a game → the event → **Enter**. With enough in the team's account it should say "You're in!", and the squad should get "can you play?" on Home. Take the test event down afterwards on the web (it refunds the buy-in).
- [ ] **Enter with a shortfall** (needs the Stripe CLI webhook setup from the pay-sheet note): with less in the team's account than the buy-in, Enter should offer "Pay £X towards the buy-in"; pay with a test card and it should enter automatically. Stop the webhook forwarding and try again: it should say the payment hasn't arrived yet and offer only "Try entering again", never a second payment.
- [ ] **Tournament page**: from the Calendar (tap an entered tournament → View schedule & results) and from the feed (tap a tournament's name → Details). Check the details, the team list (yours highlighted), the schedule (your games tappable, with finish times if match length was set), and the table once a score has been entered on the web. Pull down to refresh after entering a score on the web.
- [ ] **Cancelled event**: take a test event down on the web; its page on the phone should show the red cancelled banner with the reason.
- [ ] **Settle payments** (as the Test team's captain, after entering a test tournament): My Team → Settle payments → open the tournament. "Played" should list who said they could play (or the whole squad if nobody answered). Untick someone and check the per-player amount; send. Each player gets "You owe £X for entering …" in Messages and a "You owe" strip on Home. Pay one share on the phone, reopen Settle payments, and that player should show **Paid ✓**. Compare with Payment Status on the web.
- [ ] **Message a teammate**: My Team → tap a squad member (and the captain) → details → Message. It should open an empty thread; send, and check it arrives on the web or the other account. Your own row shouldn't offer Message.
- [ ] **Tactics** (My Team → Tactics): as captain, create a setup (name, situation, size, formation, a few players, style, pressing, notes) and save; edit it, then change its match size (the players should clear); try a duplicate name (you should get a plain message); delete one. As a player, check it's read-only. Compare with the web's Tactics tab.
- [ ] **Load a saved setup** into a tournament game's lineup (captain): the shape, style and notes load, and anyone who said they can't play is left off the board. Save and check on the web.
- [ ] **Transfer Market** (My Team → Transfer Market): search players by name and filter by position; Add friend (the other account sees it in the inbox and can accept). As a captain, Send offer to join to a free agent; on the free agent's phone, open the inbox (envelope, top right) → Accept & join, and they should land in the squad without restarting. On the Teams tab, Ask to join as a teamless player; the captain sees the join request.
- [ ] **Friends on Profile**: after accepting a friend request in the Transfer Market, the friend shows under Friends on Profile; tap them → Message.
