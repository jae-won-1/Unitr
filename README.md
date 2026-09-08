# Uniter

An amateur football app for players, team captains, venue managers and platform
admins: team discovery, matches, tournaments, availability, pitch bookings,
team chat and payments.

Built with Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Supabase,
Stripe and Leaflet. Product behaviour and the longer-term vision are documented
in [CLAUDE.md](CLAUDE.md).

## Local development

Use Node.js and npm. The onboarding checks ran with Node 24.19.0 and npm 11.17.0;
the repository does not currently pin a Node version.

1. On a fresh checkout, install locked dependencies with `npm.cmd ci`.
2. If `.env.local` does not exist, copy `.env.example` to `.env.local` and fill it
   with the appropriate development credentials. Preserve an existing file.
3. Run `npm.cmd run dev` and open the local URL printed by Next.js (normally
   `http://localhost:3000`).

These commands use `.cmd` because this Windows PowerShell setup blocks npm's
PowerShell scripts. In other shells, use `npm` and `npx` normally.

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | Development server |
| `npx.cmd --no-install tsc --noEmit --incremental false` | Type check without updating the compiler cache |
| `npm.cmd run lint` | Existing Next.js ESLint checks |
| `npm.cmd run build` | Production build; also needs configured environment variables and Google Fonts access |
| `npm.cmd run start` | Serve a completed production build |

Supabase provides the backend; starting Next.js does not create a local database.
Some core tables were originally created in the dashboard. Root `supabase_*.sql`
files are manual schema updates, tests and seed scripts, not a complete ordered
bootstrap. Read dependencies before applying an individual update to an authorized
development database. `supabase_settlement_tests.sql` is a manual transactional
database test; Playwright is installed but no browser test suite is configured.

## Where things live

| Path | Purpose |
| --- | --- |
| `app/` | Pages/layouts and `app/api/` server endpoints |
| `components/` | Shared UI and feature panels |
| `contexts/` | Authentication and role resolution |
| `lib/` | Shared business logic, data access, payment and date helpers |
| `app/venue/`, `app/admin/` | Venue and staff interfaces |
| `tailwind.config.ts`, `app/globals.css` | Design tokens and global styling |
| `supabase_*.sql` | Manual database changes and SQL checks |
| `GO_LIVE.md` | Stripe operational cutover guide, including destructive steps |

## Using Codex and Claude Code

Open this repository in either tool. [AGENTS.md](AGENTS.md) supplies the shared
working rules; [CLAUDE.md](CLAUDE.md) keeps the existing project knowledge;
[docs/HANDOFF.md](docs/HANDOFF.md) records current progress and validation.
Codex discovers the root `AGENTS.md` when a new session starts, following
[OpenAI's project instructions guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
Claude's project brief explicitly directs it to the same workflow and handoff.

When switching tools, finish the current edit and have the outgoing tool update
the handoff. The incoming tool should read it and inspect the working tree.
Uncommitted files are visible to both tools in this checkout; chat histories are
not shared. For work at the same time, use separate worktrees and branches, then
review and integrate the changes. Each worktree needs its own dependencies and
untracked environment file.

No additional plugin, API key for Codex, or project-specific model setting is
needed for these repository instructions. Claude's existing settings remain in
`.claude/`; they are not Codex permissions.
