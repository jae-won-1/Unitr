# Uniter handoff

## Latest completed work — 2026-09-08, Codex

Set up this repository for ongoing use with both Codex and Claude Code.
Reviewed the project brief, historical plans, app layout, role resolution,
design tokens, authentication/payment clients and helpers, SQL conventions,
package scripts and Claude's shared settings. This was onboarding, not a full
code or security audit.

- Added root `AGENTS.md` with shared workflow, code conventions and verification.
- Linked it from `CLAUDE.md`, preserving the existing product knowledge. Corrected
  the role list to include admin and qualified the blanket SQL/RLS claims.
- Added `README.md` with setup, code map and instructions for switching tools.
- Added `.env.example` using variable names from source, without copying secrets.
- No application behaviour, dependencies, database contents, Claude settings or
  machine-wide Codex configuration changed. Changes are uncommitted.

## Validation baseline

Starting checkout was clean at `f217b4c` (billing details at payment confirmation).
Local runtime: Node 24.19.0, npm 11.17.0.

- `npx.cmd --no-install tsc --noEmit --incremental false`: passed.
- `npm.cmd run lint`: passed with four existing React hook dependency warnings:
  - `app/pay/[matchId]/page.tsx`: `createClientSecret`.
  - `app/pitches/page.tsx`: `ALL_HOURS`.
  - `components/BookPitchPanel.tsx`: `isAvailableAt`.
  - `components/SettlePaymentsModal.tsx`: `date`, `isTournament`.
- Bare `npm`/`npx` are blocked by PowerShell execution policy; `.cmd` works.
- Production build and browser/payment flows were not run for this documentation
  setup. No database scripts or remote payment operations were executed.

## Context for the next task

No feature task is currently in progress. Ask the user what to build or fix next;
do not treat historical plans as an assigned backlog.

- `BACKEND_PLAN.md` still describes a static app with no backend, and the early
  state in `PAYMENT_PLAN.md` predates the current ledger. Check code and the
  As Built brief before relying on either.
- Parts of `CLAUDE.md` describe test-only payments, but its later mobile 3D Secure
  notes describe live-card fixes and `GO_LIVE.md` describes a live cutover. Actual
  environment/payment mode and remotely applied migrations were not verified.
- Core database bootstrap is not fully represented in versioned migrations.
- Existing Claude conversations/private memory and external integrations have not
  been imported. Capture any decisions needed for future work in the shared docs.

## Updating this file

Replace the latest-work section after meaningful tasks. Record changed behaviour,
validation actually performed, unresolved issues and the next concrete step. Keep
durable architecture in `CLAUDE.md` and working rules in `AGENTS.md`. Never put
credentials, payment secrets or personal data here. Check Git for current state;
this handoff is a dated snapshot, not a substitute for the working tree.
