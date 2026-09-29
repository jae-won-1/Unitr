# Sign in with Google

The code is written and inert. Everything that switches it on is dashboard work
in two consoles, plus one code job. Written 2026-09-22, deliberately not
actioned: none of it may happen before the pilot tournament on **Sun 27 Sep
2026**.

There is **no SQL**. A Google account writes the same `profiles` row
registration always wrote, and the existing insert policy and `account_type`
guard already allow it.

**Do the steps in order.** Step 0 is the one that stops being possible later.

---

## 0. Before anything is enabled — take stock of who exists

Supabase dashboard → Authentication → Users. Export or screenshot the list, and
note which accounts show a confirmed email.

**Done 2026-09-29: every account came back confirmed.** With "Confirm email"
off, Supabase auto-confirms each address at sign-up rather than leaving it
unconfirmed — this document originally assumed the opposite. Check with:

```sql
select u.email, u.email_confirmed_at is not null as confirmed,
       p.id is not null as has_profile
from auth.users u left join public.profiles p on p.id = u.id
order by u.created_at;
```

Knowing the list before Google accounts start appearing is still what lets you
tell an old account from a new duplicate afterwards. Accounts with no profile
row will be sent to `/welcome` by `ProfileGate` on their next sign-in.

Also note any account registered with a made-up address (`…@test`, `…@fake`,
anything not a real mailbox). Those can never be matched by email and will need
Connect Google, or nothing.

---

## 1. Merge the code to `main`

It lives on the `mobile` branch, which is frozen off Vercel. Nothing below has
any effect until the app that contains these screens is actually deployed.

```
git checkout main
git merge mobile       # or cherry-pick the Google sign-in commit
```

The web app is identical on both branches apart from this work, so the merge
should be clean. Deploy and confirm `/login` shows the Google button — it will
still fail on tap, which is correct until step 3.

---

## 2. Google Cloud console — create the OAuth client

APIs & Services → Credentials → *Create OAuth client ID* → **Web application**.

- **Authorised redirect URI:** `https://<project-ref>.supabase.co/auth/v1/callback`

  Supabase's, not ours. Google never redirects to Uniter directly — this is the
  single most common thing to get wrong.
- Fill in the OAuth consent screen: app name, support email, logo, privacy
  policy link. An **unverified** app is capped at 100 users, which is fine for a
  pilot; going beyond that needs Google's review, which takes weeks. Start the
  verification early if you expect to pass 100.
- Keep the client ID and client secret for the next step.

---

## 3. Supabase dashboard — three settings

1. **Authentication → Providers → Google**: enable, paste the client ID and
   secret.
2. **Authentication → URL Configuration → Redirect URLs**: add
   `https://<production-domain>/auth/callback` and
   `http://localhost:3000/auth/callback`. A URL that isn't listed sends the
   visitor to Supabase's own error page instead of back to the app.
3. **Authentication → Advanced → Manual linking**: enable. Without it, Connect
   Google on `/profile` returns "manual linking is disabled" — the button says
   so rather than failing quietly, but the feature doesn't work.

No environment variables change.

### Gate — test the round trip before telling anyone

On the deployed site, in a private window:

- A **brand-new** Google account: tap Continue with Google → consent → lands on
  `/welcome` → fill it in → lands on Home with a working profile.
- An **existing** account: sign in with email and password → `/profile` →
  Sign-in Methods → Connect → consent → back on `/profile` reading
  "Connected". Sign out, tap Continue with Google, and confirm it lands on that
  **same** account with its team still there.

If the second one produces an empty account instead, stop — that is the
duplicate case, and it means the link never attached.

---

## 4. Tell the existing squad what to do

This is the step that isn't in a dashboard. Because every existing address is
confirmed (step 0), a member whose Uniter email **is** their Google account is
matched automatically. Everyone else needs Connect Google first.

> You can now sign in with Google. If your Uniter account uses the same Gmail
> address, just tap Continue with Google. If it uses a different address (a
> university, Hotmail or Naver email, say), sign in the way you always have
> first, then go to Profile → Sign-in Methods → Connect Google — otherwise the
> Google button starts you a brand-new empty account.

`/welcome` says a version of this itself, before any field is filled in, but a
message to the squad before they see it is worth more.

### Why — the three groups

Supabase links a Google identity to an existing user **only when that user's
email is already confirmed** — which, on this project, every address is.

| Who | What happens on Continue with Google |
| --- | --- |
| Confirmed email, same address on Google | Same user id. Profile, team and payments intact, password still works |
| Registered with a **different** address from the Google account (non-Gmail, typo, made-up) | A **second, separate account** — new user id, no profile, none of their squad. The original is untouched and still reachable by password, but they won't know that |
| Unconfirmed email (none exist today; only possible once Confirm email is on) | The same as the row above |

Connect Google answers the second row, because `linkIdentity` attaches
Google to whoever is **signed in** — the registered address stops mattering. The
app cannot warn about the collision by itself: `profiles` stores no email and
the browser cannot read `auth.users`.

---

## 5. Clean up any duplicates that appear

If somebody does tap Google first and ends up in a fresh account:

1. Have them sign out and sign back in with their **password** — the original
   account is untouched.
2. Profile → Sign-in Methods → Connect Google. This will fail with "already
   connected to another Uniter account" while the duplicate holds that identity.
3. Delete the duplicate in Authentication → Users (check it has no `profiles`
   row and no team first — `select * from profiles where id = '<uuid>'`), then
   Connect again.

---

## 6. Separately: turning "Confirm email" on

Worth doing, but **not a switch** — it is a small piece of work, and it is what
would stop new duplicates at the source by making every future account matchable
by email.

With it on, `supabase.auth.signUp` returns a user and **no session**.
`app/register/page.tsx` writes the profile (the RLS policy and the
`account_type` guard were both written not to need a session) and then pushes to
`/`, where the new member arrives **signed out** with nothing explaining why. To
them, registration failed. The invite flow survives it — the localStorage
backstop in `lib/team-invite` exists for exactly that round trip.

So, in order:

1. Add a "check your inbox" state to `/register` for the no-session return.
2. Move off Supabase's built-in SMTP (Resend, SendGrid, Postmark). The built-in
   one is rate-limited to a handful of messages an hour and lands in spam often
   enough to matter when a squad signs up together. Authentication → Emails →
   SMTP Settings.
3. Send a test signup to a real inbox and confirm the link works.
4. Then enable Authentication → Providers → Email → **Confirm email**.

Existing accounts are already confirmed (step 0) and are unaffected by the
switch.

**Why it matters for Google as well:** while it is off, an address is marked
confirmed without anyone proving they own it. Someone who registers with
another person's Gmail would have that account auto-linked when the real owner
later taps Continue with Google — and would still hold its password. Unlikely
at pilot scale, but it is the reason this job is worth doing.

---

## Reference — what the code does

| Piece | Job |
| --- | --- |
| `lib/google-auth.ts` | Leaves for Google (`redirectTo` = `<origin>/auth/callback`), and the Connect / Disconnect side via `linkIdentity`. Stashes an invite code in localStorage first — it can't survive the redirect on a query string |
| `app/auth/callback/page.tsx` | Where Google comes back to. Waits for supabase-js to parse the session, then routes: no profile → `/welcome`, `?next=` → back where Connect started, venue → the portal, otherwise the invite or Home |
| `app/welcome/page.tsx` | The rest of the registration form. Google gives a name and an email; this asks the account type and the six player questions, then writes the profile. Warns first that this is a *new* account |
| `components/ProfileGate.tsx` | Sends a signed-in account with no profile row back to `/welcome` from anywhere else in the app |
| `components/SignInMethods.tsx` | **Connect Google** on `/profile`, for an account that already exists |
| `components/RegistrationFields.tsx` | The question markup, shared by `/register` and `/welcome` so the two forms can't drift |
| `lib/register-profile.ts` | The insert both screens do, and where a finished account lands |

The client runs supabase-js's default **implicit** flow (`lib/supabase.ts` sets
no `flowType`), so the session arrives in the URL fragment and is parsed in the
browser. There is no server callback route and none is needed; adding one would
mean moving the whole app to PKCE.
