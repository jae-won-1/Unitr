# Overnight log — 29/30 September 2026

Written while you slept, on your instruction to carry on with the React Native
transition and approve everything that isn't critical. Two sections: what I
decided on your behalf, and one test list to run through in a single sitting.

## Ground rules I held to

- **No writes to the live database.** Seed scripts are written, never run.
- **No force-pushes, no deleting branches or data, no dashboard changes**
  (Stripe, Supabase, Google Cloud, Vercel).
- **`main` only receives byte-identical extractions** of pure data code into
  `lib/` (the branch-discipline rule), each type-checked and built first. They
  deploy to Vercel, but change no behaviour. Everything else lands on `mobile`.
- Every mobile change is type-checked and linted before commit. None of it has
  run on a phone — that is what the test list is for.

## Decisions made on your behalf

| # | Decision | Why | Commit |
|---|---|---|---|
| 1 | Challenge and Enter stay greyed until Phase 4 (your call, recorded). | Their failure case needs a captain's payment sheet that doesn't exist yet. | a519a81 |
| 2 | Payments tested against a local test-mode server, not the live API. | The phone's pk_test key can't confirm an intent made with the live secret key. | 33152bd |
| 3 | Pay sheet built with no free-amount top-up. | Your wording decision: a balance you add money to looks like a digital wallet to Apple. | e6a6a6d |
| 4 | Moved `saveCardFromIntent` into `lib/save-card.ts` on **main** (unchanged code, re-exported). | Mobile needs it to save a card after paying. Built and type-checked before pushing; no behaviour change. | 48aca6e |
| 5 | "Save this card" switch added to the pay sheet only, **not** to Fill In. | Fill In goes straight into Stripe's sheet with no screen of ours to put a switch on. Stripe's own save box needs a new server route (ephemeral keys), which is a server change I didn't want to make unsupervised. | (this commit) |
| 6 | Built a Profile screen, reached from an avatar button at the top-right of each tab, not a fourth tab. | Mobile had no way for a player to sign out at all. The web app keeps three tabs and puts Profile behind the avatar; same here. | (this commit) |
| 7 | Profile leaves out **Connect Google**, with a note pointing to the web app. | Linking Google inside the phone app is an OAuth round trip that needs the app added as a redirect in Supabase and Google Cloud, which is dashboard work. | (this commit) |
| 8 | Profile leaves out **Friends** for now. | Its only action is "message this friend", and Messages isn't on mobile yet. | (this commit) |
| 9 | Sign out asks for confirmation first. | On a phone it sits under your thumb at the bottom of a long scroll. | (this commit) |
| 10 | Added `lib/direct-messages.ts` on **main** as a new file; the web inbox and thread pages were **not** changed to use it. | The web pages run these queries inline. Moving them onto the shared file is a refactor of live pages, which I didn't want to do unsupervised. As a new file it changes nothing on the web. The web pages can switch over later. | 2c0990c |
| 11 | Built Messages on mobile: inbox, team chat, one-to-one threads, plus a chat icon with an unread dot beside the avatar. | Phase 5 of the plan; it involves no money and was the largest gap left for players. | (this commit) |
| 12 | One-to-one threads on mobile **poll for replies every 5s**; the web thread doesn't. | On a phone you put the app down and pick it up again. A thread that only updates when you reopen it reads as broken. | (this commit) |
| 13 | Polling pauses while the app is in the background. | The migration plan's note for team chat: use AppState on native in place of the web's hidden-tab check. | (this commit) |
| 14 | Team chat's options menu (mute, leave, rejoin) uses the phone's own action sheet, and leaving asks for confirmation. | It's the native equivalent of the web's ⋯ menu, and leaving hides new messages, so it's worth one extra tap. | (this commit) |
| 15 | Captains can approve or decline join requests on mobile, from My Team. | Home showed the count, but there was nowhere to act on it. | (this commit) |
| 16 | Team Settings ported whole: team details, invite link, co-captains (captain only; greyed for a co-captain, as on the web), joining fee. | It's the first thing a new captain needs, and every write goes through shared code or the web's own database functions. | (this commit) |
| 17 | The invite link shared from the phone uses the **website** address (`EXPO_PUBLIC_WEB_URL`, defaulting to the Vercel URL), not the API address. | The web builds it from the browser's address, which a phone doesn't have. The API address points at your PC while payments are being tested, and a link to that would be useless to anyone else. | (this commit) |
| 18 | Invite link: Share only (the phone's share sheet includes Copy). No separate Copy button. | A Copy button needs another native module (expo-clipboard); the share sheet already covers it. | (this commit) |
| 19 | Post announcement ported with its own copy of the web page's two database writes, rather than moving them into `lib/`. | On the web they're inline in a live page; extracting them would be a refactor I didn't want to make unsupervised. Noted in `PORTED.md` so they're kept in step. | (this commit) |
| 20 | The web's announcements **list** page isn't ported. | Every announcement already arrives in each player's Messages inbox, which mobile now has. | (this commit) |
| 21 | Joining fee help text on mobile says "towards your pitch bookings and tournament entries" rather than the web's "into your team's credit balance". | Your wording decision for mobile. | (this commit) |
| 22 | Moved `useAvailabilityPoll` into `lib/availability-poll.ts` on **main** (unchanged code, re-exported), and dropped two unused imports from the web modal. | Mobile needs the poll to let players answer it. Built and type-checked before pushing. | 4a4e7e7 |
| 23 | Players can answer the captain's poll on mobile, from a "Proposed dates" card on Home. | Mobile could answer per-game questions but not the poll, which is the other half of the same question. | (this commit) |
| 24 | Moved poll **creation** into `lib/availability-poll.ts` on **main**. This one isn't a pure move: `AvailabilityPollForm` on the web now calls the shared function, and option ids fall back to a random id where `crypto.randomUUID` doesn't exist (phones only; every browser has it, so the web behaves as before). | The web file warns that the one-live-poll-per-team rule would drift if it were copied twice. Reviewed the diff line by line and built it before pushing. **Please test creating a poll on the web too.** | ea826c8 |
| 25 | Built the captain's poll screen on mobile (My Team → Availability poll): see answers, propose new dates, close the poll. | It completes the poll, which players can now answer on mobile too. | (this commit) |
| 26 | Built a simple date-and-hour picker (a strip of days, a grid of whole hours from 07:00 to 22:00) instead of the web's clock dial. | The plan says to keep the dial's rule (whole hours by default) rather than copy its look. Past hours today are disabled. | (this commit) |
| 27 | When every slot in a poll has passed, the captain's screen closes it automatically. | That's what the web captain page does, so the squad stops being asked about dates that have gone. | (this commit) |
| 28 | Left out the web's "pick up to 3 dates → post matches" step. | It hands off to match posting, which isn't on mobile yet. | (this commit) |
| 29 | Built full **Create an account** on mobile, replacing the old email-and-password-only sign-up. | The old one made logins with no profile (no name, no position). The new one asks everything the web form asks and saves through the same shared code. | (this commit) |
| 30 | Added a mobile **Finish setting up** screen, and the app now sends any signed-in account with no profile there first, like the web's ProfileGate. | This catches accounts already created by the old mobile sign-up, and would catch a Google account later. | (this commit) |
| 31 | After saving a profile, the mobile screens refresh the login session. | The shared role check only looks again when the signed-in user changes, so it would otherwise go on thinking the profile is missing and bounce you back to Finish setting up. | (this commit) |
| 32 | ⚠️ **Not changed, but worth checking on the web:** the web's `/welcome` may have the same problem, sending a brand-new Google account back and forth between Home and `/welcome` after they finish. | I noticed it reading the shared role code; I haven't reproduced it. It would affect new Google sign-ups, which went live today. | — |
| 33 | Arriving on mobile through a team invite link isn't handled. | Invite links open the website, which handles joining. | — |
| 34 | A player with no team can now find and join a team, or register their own, on mobile (My Team). | Previously the screen only said "use the web app", which left a new sign-up with nothing to do. | (this commit) |
| 35 | The team search on mobile actually filters, by name or location. | On the web the search box is drawn but does nothing. Mobile does what it looks like it does; the web is unchanged. | (this commit) |
| 36 | Home and My Team now re-check your team every time you come back to them. | The shared team lookup only refreshes when the signed-in user changes, so creating, joining or leaving a team wouldn't show up until the app restarted. | (this commit) |
| 37 | Built the per-game tournament page on mobile: kick-off, referee, score, the squad's answers, and the captain's lineup board with formation, style and notes. It opens from "Your games" in the Calendar's tournament sheet. | Tournaments are the pilot's focus, and setting a lineup is the thing a captain does before each game. Every read and write goes through the shared tournament and formation code. | (this commit) |
| 38 | Folded the web's separate Tactics tab (style and notes) under the lineup board. | On a phone, three tabs fit and four are cramped, and a captain thinks about style while looking at the board. | (this commit) |
| 39 | Loading a saved team preset into a lineup isn't ported. | Presets are loaded by code inside the web's Tactics tab component rather than a shared file. Moving it is for when the Tactics screen itself is ported. | — |
| 40 | The full tournament schedule page (all teams, standings, organiser controls) isn't ported; the fixture page points to the web app for it. | It's the organiser's screen and much bigger. Players get their own games on mobile. | — |
| 41 | Added the notification bell to mobile (beside Messages) with a Notifications screen and Mark all read. | Captains get notified here when an event is cancelled and refunded, when they're removed from an event, or when a joining fee goes up. Mobile showed none of it. | (this commit) |
| 42 | Tapping a notification opens the matching phone screen when there is one (messages, a tournament game, My Team, Team Settings, Profile, Calendar), and otherwise just marks it read. | Notification links are website addresses, and some point at screens the phone doesn't have yet. | (this commit) |
| 43 | The web bell's three computed counts (join requests, open posts, dues) aren't repeated in the mobile bell. | They already have places on mobile: join requests on My Team and Home, what you owe on Home. | (this commit) |

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
- [ ] **Mobile: captain poll** (My Team → Availability poll): add 2–3 options with the day strip and hour grid (past hours today should be greyed), send, and check the squad sees "Your captain proposed dates". Answer from a player account, then check the counts, the "Best" slot and the initials on the captain's screen. Try **New poll** (warns it replaces the current one) and **Close poll**.
- [ ] **Web, important: brand-new Google account.** In a private window, Continue with Google with an account that has never used Uniter, and fill in `/welcome`. Check you land on Home and **stay** there, rather than flicking back to `/welcome`. If it loops, tell me: it's a live bug for new sign-ups, not a mobile one.
- [ ] **Mobile: create an account** (Sign in → "New here? Create an account"). Try it with a throwaway email; it creates a real account in the live database, so delete it afterwards in Supabase → Authentication → Users. Check the validation (password under 8, mismatch, unanswered questions), then that you land on Home with your name in the greeting.
- [ ] **Mobile: finish setting up.** Sign in on the phone with an account that has no profile (the Step-0 list had three: `jay1choii1@`, `emilytony1108@`, `jeehan.kim05@`; use your own). You should be taken to Finish setting up, and land on Home after answering. "Use a different account" signs out.
- [ ] **Find a team** (as a player with no team, e.g. a new test account): search by name and by area, filter by level, then Request to join. The button should stay "Request sent" after leaving and reopening the tab, and the captain should see the request.
- [ ] **Register a team** (as a teamless test account): fill it in and create. You should land on My Team as captain, with Invite players and Team Settings showing, without restarting the app. Delete the test team afterwards in Supabase if you don't want it listed.
- [ ] **Tournament games** (needs an entered tournament with fixtures drawn up, e.g. on the Test team): Calendar → tap the tournament → "Your games" lists each game; tap one.
- [ ] **Fixture page as a player**: Info shows kick-off, pitch and referee; Attendance shows the squad's In / Out / Pending for the day; Lineup is read-only.
- [ ] **Fixture page as captain**: pick a formation, tap positions to choose players (someone who said Out shouldn't be offered; picking someone already placed moves them), set a style and notes, **Save lineup**. Then open the same game on the web and check it matches (same players in the same positions).
- [ ] **Bell** (top right): the dot shows with unread notifications. Open it, tap one (it goes grey and opens the right screen if it links somewhere the phone has), then Mark all read. To get one to test with: the removing-a-team feature and changing a joining fee both create notifications on the Test team.
