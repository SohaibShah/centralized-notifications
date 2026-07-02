# Project: [name] — internal tool for Securiti AI

One-line description: [fill in — what does this app do, who uses it]

## Stack
- Frontend: Vue 3 + TypeScript, Composition API with `<script setup>`, Vite, Pinia, Vue Router
- Backend: Node.js + TypeScript (pick Express or Fastify and stay consistent — don't mix)
- Data: PostgreSQL (system of record), Redis Streams (events/queues between services)
- Monorepo: pnpm workspaces — `frontend/`, `backend/`, `packages/shared/`

## Non-negotiable conventions
- **Forms are JSON-driven.** Never hand-roll a one-off form component. Every form is described
  by a JSON config and rendered by the shared `<FormRenderer>`. Read the `json-form-conventions`
  skill before building or touching any form.
- **Design system, not defaults.** Every screen follows the tokens and rules in the
  `design-system` skill. No unstyled Tailwind defaults shipped as "done", no generic
  centered-card-with-shadow layouts, no decisions made without a reason.
- **Validate at the boundary.** All API input is validated with zod. Share schemas between
  frontend and backend via `packages/shared` wherever the shapes match.
- **No secrets in code.** Config comes from environment variables, validated at process startup.
  Never commit `.env`. Flag any hardcoded credential, token, or connection string immediately.

## Coding standards
- TypeScript strict mode everywhere. `any` requires an inline comment explaining why.
- `pnpm lint` and `pnpm typecheck` must be clean before a change is "done."
- Tests: Vitest for units, Playwright for e2e. New business logic needs a test alongside it.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
- Prefer editing an existing file/pattern over introducing a new one. If you're about to invent a
  second way to do something the codebase already does one way, stop and reuse the existing way.

## Workflow
- Use **plan mode** for anything touching more than 2–3 files, the DB schema, auth, or payments.
  Present the plan and wait for approval before editing.
- Push exploration and verbose output into subagents instead of the main conversation — see
  `.claude/agents/`. Use `code-reviewer` after non-trivial changes, `security-reviewer` before any
  PR touching auth/PII/payments/migrations, `frontend-design-reviewer` after UI work,
  `db-reader` for read-only data investigation, `git-troubleshooter` for any git error or
  confusing repo state.
- Use `/commit` to commit (checks `.gitignore` and stages deliberately) and `/open-pr` to push
  and open a PR with a real description — don't hand-run `git commit`/`git push` as a substitute.
- Run `/code-review` before opening a PR.
- Never run destructive SQL directly. DB schema changes go through a migration file in
  `backend/migrations/` — never hand-edit the schema. Redis Stream consumers follow
  `.claude/rules/redis-streams.md` (consumer groups, idempotency, dead-letter handling).
- When building or changing UI, use `/verify` (or ask to launch the app and take a screenshot)
  to confirm the change actually looks and works right, not just that it compiles.
- This project currently has one developer and no production access. Treat anything hard to
  reverse later — schema design, the API contract other services will call, provider/vendor
  choice, multi-tenancy model — as needing a quick sanity check with a manager/mentor before
  locking it in, not just approval in this conversation. Subagent review catches code issues;
  it doesn't catch "this isn't what the team actually needs."

## Project layout
- `frontend/` — Vue 3 app
- `backend/` — API + Redis Stream consumers/workers
- `packages/shared/` — shared TypeScript types and zod schemas
- `docs/` — generated gantt chart / task list only. The SRS itself lives in Google Docs
  (see `.claude/skills/fill-srs/`), not as a file in this repo.
- `.claude/` — Claude Code config: agents, skills, rules (check this into git so the whole team
  gets the same setup)

## Build & run
_(fill in once these exist — Claude should update this section the first time it sets up the
actual scripts, so it stays accurate)_
- `pnpm install`
- `docker compose up -d` — Postgres + Redis for local dev
- `pnpm dev` — runs frontend + backend in watch mode
- `pnpm test` — unit tests
- `pnpm test:e2e` — Playwright e2e tests
