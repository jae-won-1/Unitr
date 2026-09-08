# Uniter agent instructions

## Shared context

Read `CLAUDE.md` before making changes: it is the shared product brief and detailed
architecture reference for both Codex and Claude Code. Read `docs/HANDOFF.md` for
the latest completed work, validation and remaining issues. Read `README.md` for
setup and commands. Keep product rules in `CLAUDE.md`, workflow rules here, and
current session state in the handoff; do not maintain competing copies.

The implementation is the authority for current behaviour. Prefer the As Built
section over Vision when describing existing features. `BACKEND_PLAN.md`,
`PAYMENT_PLAN.md`, `docs/plan-fixes.md` and dated update files are historical plans,
not evidence that work remains undone. Check the relevant code before acting on them.

## Working together

- Start with `git status --short` and inspect relevant diffs. Preserve existing
  user/other-agent changes; do not reset, stash or overwrite them to simplify a task.
- For sequential work, use this checkout and update the handoff before switching
  tools. For simultaneous editing, use separate branches AND worktrees; branches
  alone do not isolate files in the same directory. Coordinate overlapping changes.
- Complete the requested scope; avoid unrelated refactors or dependency upgrades.
- After meaningful work, update `docs/HANDOFF.md` with what changed, checks actually
  run, unresolved issues and any next step. Update `CLAUDE.md` when behaviour or
  architecture changes. Keep the handoff concise and remove superseded state.
- Do not assume either tool can see the other's conversations, private memory,
  permissions or integrations. Put durable decisions in the repository.

## Development and validation

- Stack: Next.js 14 App Router, React 18, strict TypeScript, Tailwind 3, Supabase
  Auth/Postgres, Stripe and Leaflet. Use npm and the existing `package-lock.json`.
- On this Windows PowerShell setup use `npm.cmd` and `npx.cmd`; the `.ps1` shims
  are blocked. Do not change execution policy to work around this.
- Start: `npm.cmd run dev`. Type check:
  `npx.cmd --no-install tsc --noEmit --incremental false`. Lint: `npm.cmd run lint`.
  Build: `npm.cmd run build` when routing, dependencies or build behaviour changes.
  Equivalent `npm`/`npx` commands work in other shells.
- For code changes, run relevant type/lint checks and focused behaviour checks.
  For documentation-only changes, verify paths, commands and the diff. Report
  pre-existing failures separately. Do not claim a browser/payment flow was tested
  based only on compilation. No automated JS test suite is currently configured.
- Follow existing components and Tailwind tokens; preserve mobile safe-area spacing,
  the stable disabled-action layout and sheets above the navigation chrome.

## Important implementation boundaries

- Reuse domain helpers in `lib/` rather than duplicating business logic. In
  particular use team-leadership helpers for co-captains, match-dates helpers for
  legacy dates, event-availability for attendance and confirm-payment for Stripe
  payment/setup confirmation and mobile 3D Secure recovery.
- Money stored in the ledger is integer pence. Keep fee snapshots and idempotency;
  derive charge amounts and entitlement on the server. Read the payment section
  of `CLAUDE.md` before changing booking, settlement, refunds or venue transfers.
- Browser API calls use `lib/authed-fetch.ts`; user-facing protected routes use
  `lib/api-auth.ts` and entitlement checks. Stripe webhooks use signature
  verification instead of a browser session. Never trust caller IDs from a body.
- Keep service-role and Stripe secret keys server-side. Never copy credentials,
  payment client secrets or personal data into docs, logs or commits.
- SQL changes live in root `supabase_*.sql` files and are applied manually. Read
  each file's dependencies and effects: there is no verified bootstrap migration
  sequence, and some core tables predate these scripts. Do not run every SQL file
  as setup; this directory also contains test/seed scripts.
- The checked-in SQL has a mixture of permissive and restrictive RLS. Inspect the
  actual policies relevant to a change; do not loosen them to make a feature work.
- Do not assume local credentials point to a sandbox. `GO_LIVE.md` contains
  destructive operational steps, not development setup. Database resets, remote
  migration application, live charges/refunds/transfers and deployment require
  authorization for that operation; prepare changes locally within task scope.
