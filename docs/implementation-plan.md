# Centralized Notification System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan. Week 1 tasks use checkbox
> (`- [ ]`) steps. Weeks 2–5 are task breakdowns; **at the start of each week, expand its tasks into
> bite-sized TDD steps** (write failing test → run → implement → run → commit) before coding.

**Goal:** Build a prototype Centralized Notification System — one unified, AI-assisted, admin-governed
notification feed that ingests notifications from any module of an enterprise application — delivered
as five weekly, individually-demoable milestones.

**Architecture:** A generic, domain-agnostic backend (one fixed notification contract + opaque
`metadata`; abstracted intake; delivery behind a channel adapter; data-driven policy) and a dynamic,
JSON-driven Vue frontend (feed, cards, filters, admin, prefs rendered from schemas/config). It runs
standalone for the prototype with its own simple auth and module simulators; production later swaps in
host-app identity and real modules.

**Tech Stack:** pnpm monorepo (`frontend/`, `backend/`, `packages/shared/`); Vue 3 + TS (Vite, Pinia,
Vue Router); Fastify + TS; PostgreSQL (latest); Server-Sent Events; Anthropic (Claude) via a pluggable
LLM adapter; PostgreSQL FTS retrieval; Redis Streams (week 5); zod; Vitest + Playwright.

## Source-of-truth documents (read before executing)

- **SRS:** `docs/srs/SRS - Centralized Notification System - v1.3.docx` — requirements FR-1…FR-29,
  NFR-1…NFR-7, the 5-week roadmap, and Approaches (alternatives + rationale). Extract text with
  `textutil -convert txt "<path>" -stdout`.
- **Architecture:** `docs/architecture.md` — folder layout, backend/frontend internal structure, the
  notification contract, the data model (ER), and 6 process diagrams. **This is the layout authority.**
- **Decisions & open items:** `docs/srs/open-questions-and-decisions.md` — locked decisions, deferred
  items, and the **mentor sign-off gate** (below).
- **Rules (must follow):** `.claude/rules/redis-streams.md`, `notifications-domain.md`, `security.md`,
  `testing.md`, `api-documentation.md`.
- **Skills (invoke when relevant):** `json-form-conventions` (before ANY form), `design-system`
  (any UI), `gantt-chart` (timeline). Subagents: `code-reviewer`, `security-reviewer`,
  `frontend-design-reviewer`, `browser-tester`, `db-reader`, `git-troubleshooter`.

## ⛔ Sign-off gate (before writing feature code)

Per `open-questions-and-decisions.md`, get explicit mentor sign-off on (1) the **notification contract**
(shape below, incl. the 4-scope `audience`) and (2) the **global-vs-per-user precedence rule**
(suppressions stack — a global disable always wins; a per-user setting may only further restrict).
These are the load-bearing, hard-to-reverse decisions. Scaffolding (Week 1 Tasks 1–2) can proceed in
parallel; do not build the pipeline/contract-dependent code until signed off.

## Global Constraints (every task inherits these — values verbatim)

- **Monorepo:** pnpm workspaces — `frontend/`, `backend/`, `packages/shared/`. `frontend`/`backend`
  never import each other; the only shared coupling is `packages/shared`.
- **Backend framework: Fastify + TypeScript.** Do not mix in Express.
- **Forms are JSON-driven.** Never hand-roll a one-off form. Every form is a JSON config rendered by
  the shared `<FormRenderer>`. Read the `json-form-conventions` skill before building/touching a form.
- **Design system, not defaults.** Every screen follows the `design-system` skill tokens/rules. No
  unstyled Tailwind defaults, no generic centered-card-with-shadow.
- **Validate at the boundary with zod.** All API/notification input validated before touching the DB
  or another service. Share schemas via `packages/shared`.
- **No secrets in code.** Config from env vars, validated at process startup. Never commit `.env`.
  `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `DATABASE_URL`, (`REDIS_URL` in wk5) live in env only.
- **TypeScript strict everywhere.** `any` requires an inline comment explaining why.
- `pnpm lint` and `pnpm typecheck` must be clean before a change is "done."
- **Tests:** Vitest units, Playwright e2e. New business logic needs a unit test in the same change; new
  user-facing flows need a Playwright happy-path + ≥1 error/validation case. Redis consumers need a
  malformed-message test. Don't mark UI "done" without `/verify` or the `browser-tester` subagent.
- **Commits:** Conventional Commits (`feat:`/`fix:`/`chore:`/`refactor:`/`docs:`/`test:`). Use `/commit`
  and `/open-pr`; run `/code-review` before a PR. (Attribution is off per user settings.)
- **DB schema changes go through a migration file in `backend/migrations/`** — never hand-edit schema.
  Never run destructive SQL directly.
- **Plan mode** for anything touching >2–3 files, the DB schema, or auth. Present the plan, wait for
  approval. Use `security-reviewer` before merging anything touching auth/PII/migrations.
- **API docs:** every endpoint/resource gets a doc in `docs/api/` (one file per resource), kept in
  sync; delegate the writing to the `docs-writer` subagent (`api-documentation.md`).
- **Redis Streams (wk5)** follow `redis-streams.md`: consumer groups (never bare `XREAD`), idempotent
  handlers, `XACK` only after the DB write commits, dead-letter after N attempts, `MAXLEN ~`, validate
  payload and never crash the consumer on malformed input.
- **Notification domain (`notifications-domain.md`):** every request carries an idempotency key and the
  pipeline dedupes before sending; check preferences/opt-out **before** delivery; channels behind a
  common `send()` adapter; rate-limit per recipient/source/category; delivery status is a durable fact.
  (PII/redaction is **not** required for this dev-studio prototype — see decisions.)

## Locked design decisions (do not re-litigate without the user)

- **Audience** = `{ scope: 'global' | 'team' | 'role' | 'user'; id? }` — all four built. Recipients are
  resolved from audience against identity data (all users / a team's members / a role's holders / one user).
- **Policy:** global admin config (base) + per-user preferences (layer); **suppressions stack**.
- **Generic backend:** one contract + opaque `metadata`; modules **auto-discovered** on first publish.
- **Dynamic frontend:** cards/filters/admin/prefs rendered from schemas/config via shared renderers.
- **LLM:** pluggable adapter, **hosted Anthropic (Claude) default**; local Ollama optional/swappable.
- **Retrieval:** PostgreSQL FTS now behind a **retriever interface**; pgvector later (stretch).
- **Prototype:** own simple auth (username/password + session; users/roles/teams; seeded) + module
  simulators. Production replaces both.
- **Delivery:** SSE + shared pub/sub fan-out. **Dedup on `id`.** Postgres time-partitioned + retention.
- **Performance (NFR-2):** list virtualization (lightweight lib, not Vuetify), keyset pagination,
  config/prefs caching, batched ingest, server-side grouping/filtering.

---

# Milestone map (demoable at each week's end)

| Wk | Milestone | Demo | FRs |
|----|-----------|------|-----|
| 1 | Skeleton + live feed | login → simulator fires → notification appears live in the feed | 1,2,3,4,5,6,12 |
| 2 | Basic admin + organized feed | admin disables a module for everyone; feed is categorized/prioritized/filterable | 7,8,9,10,11 |
| 3 | AI features | "summarize my unread"; ask the chatbot about your notifications | 13,14,15 |
| 4 | Audiences + prefs + interaction | target global/team/role/user; user prefs filter; group/snooze/act/navigate | 16,17,18,19,20,21 |
| 5 | Hardening + admin expansion | Redis intake + dead-letter; audit/observability/broadcasts/export; perf/tests | 22,23,24,25,26,27,28,29 |

---

# Week 1 — Skeleton + live feed (executable detail)

**Milestone demo:** log in as a seeded user; a module simulator publishes a notification; it appears in
the live, incrementally-loaded feed in real time.

### Task 1: Monorepo scaffold + tooling

**Files:** create `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`,
`docker-compose.yml` (postgres:latest), `.env.example`; `frontend/`, `backend/`, `packages/shared/`
each with own `package.json` + `tsconfig.json`. Update `CLAUDE.md` "Build & run" once scripts exist.

- [ ] Init pnpm workspace with the three packages; add root scripts `dev`, `lint`, `typecheck`, `test`,
      `test:e2e` (delegating to the workspaces). Enable TS strict in `tsconfig.base.json`.
- [ ] `docker-compose.yml`: `postgres:<latest>` (bump the old `16` pin) with a named volume; expose 5432.
- [ ] `.env.example` with `DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER=anthropic`,
      `LLM_MODEL`, rate-limit knobs. Confirm `.env` is gitignored.
- [ ] Verify: `pnpm install`, `docker compose up -d`, `pnpm typecheck` clean. Commit
      (`chore: scaffold pnpm monorepo + docker-compose`).

### Task 2: The notification contract (`packages/shared`) — the central interface

**Files:** Create `packages/shared/src/notification.ts`, `packages/shared/src/index.ts`;
Test `packages/shared/test/notification.test.ts`.

**Produces (later tasks depend on these exact names):**

```ts
// packages/shared/src/notification.ts
import { z } from "zod";

export const audienceSchema = z.object({
  scope: z.enum(["global", "team", "role", "user"]),
  id: z.string().optional(), // required for team/role/user; absent for global
}).refine(a => a.scope === "global" || !!a.id, { message: "id required for non-global scope" });

export const actionSchema = z.object({
  label: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url(),
});

export const notificationSchema = z.object({
  id: z.string().min(1),                    // idempotency key
  module: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  priority: z.enum(["low", "normal", "high", "critical"]),
  snoozable: z.boolean(),
  actions: z.array(actionSchema).optional(),
  audience: audienceSchema,
  category: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(), // opaque — never interpreted by the system
});

export type Notification = z.infer<typeof notificationSchema>;
export type Audience = z.infer<typeof audienceSchema>;
```

- [ ] Write failing tests: valid global notification parses; `team` scope without `id` fails;
      unknown `priority` fails; extra top-level field is stripped/rejected as decided.
- [ ] Run → fail. Implement the schema above. Run → pass. `pnpm --filter shared typecheck`.
- [ ] Commit (`feat(shared): add notification contract zod schema`).

### Task 3: Prototype auth (users/roles/teams + session) — FR-1

**Files:** `backend/migrations/001_identity.sql` (USERS, ROLES, TEAMS, USER_ROLE, USER_TEAM — see
architecture.md ER); `backend/src/auth/*` (session login/logout, `requireUser`, `requireAdmin`,
password hashing, a `seed.ts` seeding users/roles/teams incl. an admin); `backend/src/db/pool.ts`,
`db/scope.ts`; tests in `backend/test/auth.test.ts`.

**Produces:** `getSessionUser(req): { id, roles: string[], teamIds: string[] } | null`;
`requireUser`/`requireAdmin` Fastify preHandlers; `seedIdentity()`.

- [ ] Migration for identity tables (via a migration file — never hand-edit schema). Hash passwords
      (a maintained lib, e.g. `argon2`/`bcrypt` — call out the dep choice per `security.md`).
- [ ] Tests: login with seeded creds sets a session; bad creds 401; `requireAdmin` blocks non-admins;
      session carries roles + team ids. TDD each.
- [ ] **security-reviewer subagent** before merge (this is auth). Commit per passing task.

### Task 4: Module simulator — FR-2

**Files:** `backend/src/sim/simulator.ts` (+ a dev route or CLI to trigger bursts across
modules/priorities/audiences); `backend/test/sim.test.ts`.

**Produces:** `simulate(opts): Notification[]` producing contract-valid notifications (varied module,
priority, audience scope) — used to exercise the pipeline without real modules.

- [ ] Test: simulator output all passes `notificationSchema`; covers each audience scope. Implement. Commit.

### Task 5: Intake boundary + pipeline core (validate → dedupe → persist) — FR-3, FR-4

**Files:** `backend/migrations/002_notifications.sql` (NOTIFICATIONS + NOTIFICATION_STATUS, time-
partitioned; unique on `id`; FTS `tsvector` column + GIN index); `backend/src/intake/boundary.ts`,
`intake/http-intake.ts`; `backend/src/pipeline/{validate,dedupe,persist}.ts`; `backend/test/pipeline.test.ts`.

**Produces (interfaces later transports/tasks rely on):**

```ts
// backend/src/intake/boundary.ts
export interface IntakeBoundary { publish(raw: unknown): Promise<{ accepted: boolean; id?: string }>; }
// pipeline entry the boundary calls:
export async function ingest(raw: unknown): Promise<{ status: "accepted" | "duplicate" | "invalid"; id?: string }>;
```

- [ ] Tests (TDD): malformed payload → `invalid`, logged, no throw (NFR-3); valid new → persisted +
      `accepted`; **same `id` twice → `duplicate`, inserted once** (FR-4 idempotency); DB write commits
      before returning.
- [ ] Implement HTTP intake route (`POST /internal/publish`) that calls `ingest`. Parameterized SQL only.
- [ ] **db-reader** can confirm rows; **code-reviewer** after. Commit per task.

### Task 6: Real-time delivery via SSE + shared fan-out — FR-5

**Files:** `backend/src/http/sse/*` (per-user SSE endpoint + an in-process pub/sub the pipeline publishes
to on persist); wire `persist.ts` → fan-out; `backend/test/sse.test.ts`.

**Produces:** `publishToRecipients(userIds: string[], event): void`; `GET /sse` streaming to the
authenticated user. (Week 1: audience resolution is minimal — treat everything as `global` → all
connected users; full resolution lands Week 4.)

- [ ] Test: a persisted notification is pushed to a connected user's stream; bursts are coalesced
      (batched within a small window). Implement. Commit.

### Task 7: Frontend shell — login + live feed — FR-5, FR-6, FR-12

**Files:** `frontend/src/design/tokens.ts` (design-system skill first); `components/ui/*`
(incl. `VirtualList`); `features/auth/LoginView.vue`; `features/notifications/NotificationsView.vue`;
`renderers/NotificationCardRenderer.vue` (config-driven card); `stores/{session,feed}.ts` (Pinia,
`shallowRef` for the large list); `api/{client,sse}.ts`; Playwright `frontend/e2e/feed.spec.ts`.

- [ ] **Invoke `design-system` skill**, define tokens, build the UI primitives (loading/empty/error
      states are mandatory).
- [ ] Login screen posts to auth; on success routes to the feed. Feed subscribes to `/sse`, renders
      config-driven cards in a virtualized list, loads incrementally (keyset pagination endpoint
      `GET /notifications?cursor=...`). FR-6: read/delivered status stored + reflected.
- [ ] Playwright: log in → trigger simulator → assert a new card appears (happy path) + a login-failure
      case. **Run `/verify` or `browser-tester`** — do not mark done on `tsc` alone.
- [ ] `docs-writer` subagent: create `docs/api/notifications.md` + `docs/api/auth.md`. Commit.

**End of Week 1:** functional end-to-end demo. Tag/PR via `/open-pr` after `/code-review`.

---

# Week 2 — Basic admin + organized feed (task breakdown)

**Demo:** an admin disables a module for everyone (it stops appearing); the feed is categorized,
priority-ordered, and filterable. **Expand each task into TDD steps at week start.**

- **T1 Module auto-discovery (FR-7):** `MODULES` table (migration); on first publish, upsert the module
  row. Test: a never-seen module publishing creates exactly one `MODULES` row (idempotent upsert).
- **T2 Global policy engine (FR-3, FR-8-basic):** `GLOBAL_SETTINGS` + `MODULE_SETTINGS` tables;
  `pipeline/policy.ts` reads them (cached in memory, invalidated on change) and suppresses before
  delivery. Test: module disabled → matching notifications recorded suppressed, not delivered.
- **T3 Basic Admin panel (FR-8):** `features/admin/*` + admin routes (`requireAdmin`); enable/disable a
  module, feature kill-switches (summarization/chatbot/grouping/actions flags in `GLOBAL_SETTINGS`).
  Admin UI is JSON-form-driven (`json-form-conventions` skill). Playwright: admin toggles a module →
  feed reflects it. **security-reviewer** (admin authz).
- **T4 Categorization (FR-9):** derive/store `category` (from module/domain); group the feed by it.
- **T5 Prioritization (FR-10):** order feed by priority; test ordering incl. ties by recency.
- **T6 Filtering (FR-11):** server-side filter endpoint (module/category/date/keyword via FTS); wire a
  config-driven `FilterRenderer`. Test: filter narrows results correctly; keyset pagination still holds.
- Docs: update `docs/api/admin.md`, `docs/api/notifications.md`. `/code-review` → PR.

---

# Week 3 — AI features (task breakdown)

**Demo:** summarize unread on demand + on a schedule; ask the chatbot about your notifications.

- **T1 LLM adapter (decision):** `ai/llm/adapter.ts` (provider-agnostic streaming interface),
  `ai/llm/anthropic.ts` (default; `ANTHROPIC_API_KEY` from validated env, never in code),
  `ai/llm/ollama.ts` (optional). Test with a fake provider implementing the interface (no network in
  unit tests). **Read the `claude-api` skill before writing the Anthropic client** (model ids/params).
- **T2 Retriever interface (decision):** `ai/retrieval/retriever.ts` + `retrieval/fts.ts` (FTS over the
  user's own notifications, identity-scoped). Test: returns top matches for a query; scoped to the user.
- **T3 Summarization (FR-13):** `ai/summarize.ts` — on-demand endpoint + `workers/scheduled-summary.ts`
  (cron/interval). Test the assembly (unread → prompt) with a fake LLM; assert scheduling triggers.
- **T4 Q&A chatbot (FR-14):** `ai/qa.ts` + `CHAT_SESSIONS`/`CHAT_MESSAGES` tables; retrieve → prompt →
  stream; persist turns; context preserved across a session. `features/chat/ChatPanel.vue`.
- **T5 Admin AI config (FR-15):** enable/disable AI, summarization mode (on-demand/scheduled/both) +
  frequency, in `GLOBAL_SETTINGS`; JSON-form admin UI; policy respects the kill-switches from Week 2.
- Playwright: summarize + ask a question (happy path) + an AI-disabled case. `/verify`. Docs:
  `docs/api/ai.md`. `/code-review` → PR.

---

# Week 4 — Audiences + preferences + interaction (task breakdown)

**Demo:** notifications targeted to global/team/role/user reach the right people; a user's prefs filter
their feed; similar notifications group; snooze/act/navigate work.

- **T1 Audience resolution (FR-16):** `pipeline/audience.ts` — resolve `{scope,id}` → recipient user
  ids (global→all; team→`USER_TEAM`; role→`USER_ROLE`; user→that id). Fan-out uses this (replaces the
  Week-1 global-only shortcut). Tests: one case per scope, incl. a user in multiple teams/roles.
- **T2 Per-user preferences (FR-17):** `USER_PREFERENCES` table; `pipeline/preferences.ts` applies the
  per-user layer; `features/settings/*` JSON-form panel. **Test the precedence rule explicitly:** a
  global disable is NOT overridden by a per-user enable (suppressions stack); a per-user snooze further
  restricts. (This is the signed-off rule — cover it directly.)
- **T3 Grouping/clumping (FR-18):** `pipeline/grouping.ts` — text/metadata matching key; feed renders a
  group as one thread. Test: N similar → one group; dissimilar stay separate.
- **T4 Snooze (FR-19):** by type + module, server-enforced; test a snoozed notification is withheld
  until expiry.
- **T5 Actions + navigate (FR-20, FR-21):** inline actions call back to the originating module (its
  simulator in the prototype), which owns the action's authz; open → navigate. Playwright happy + error.
- `/verify`, docs (`docs/api/preferences.md`), **security-reviewer** (audience/authz scoping), PR.

---

# Week 5 — Hardening + admin expansion (task breakdown)

**Demo:** durable Redis intake + dead-letter handling; expanded admin (audit, observability,
broadcasts, export/import, global controls, TTL); performance pass; production-auth seam documented.

- **T1 Redis Streams intake (NFR-1):** `intake/redis-consumer.ts` behind the **same `IntakeBoundary`**
  (no pipeline rewrite) — consumer group `notifications-service`, stream `notifications-events`,
  `XACK`-after-commit, `MAXLEN ~`. Follow `redis-streams.md`. **Tests required by the rules:** duplicate
  message (idempotent) + malformed message (logged/dead-lettered, consumer survives).
- **T2 Dead-letter management (FR-29):** `intake/dead-letter.ts` (XPENDING/retry-count → dead-letter
  stream after N) + admin view to retry/discard + alert threshold.
- **T3 Per-module governance expanded (FR-22):** priority ceiling, per-module rate limit (NFR-5),
  snooze-for-everyone w/ expiry, disable actions.
- **T4 Admin broadcasts (FR-23):** admin composes a system-wide notification through the pipeline.
- **T5 Observability + resource usage (FR-24):** AI usage (runs/tokens) + per-module health
  (volume/failures/dead-letter counts) in the admin panel.
- **T6 Audit log (FR-25):** `ADMIN_AUDIT_LOG` — who/what/when/old→new on every admin change.
- **T7 Config export/import (FR-26):** snapshot `GLOBAL_SETTINGS`+`MODULE_SETTINGS` as one artifact;
  import/diff.
- **T8 Global controls + lifecycle (FR-27, FR-28):** quiet hours / maintenance / master pause (critical
  exempt); default TTL + auto-archive of read (Postgres partition drop/retention).
- **T9 Performance pass (NFR-2):** confirm keyset pagination (no OFFSET), FTS GIN index, config/prefs
  caching, virtualization; a rough load check toward the 100k-notifications directional goal.
- **T10 Production seam (deferred item):** document + stub the swap of prototype auth → host-app
  identity and simulators → real modules (a clear interface boundary, not an implementation).
- **T11 Stretch:** vector retrieval (pgvector) behind the existing retriever interface, if time allows.
- Full `/code-review` + `security-reviewer` (Redis consumer, migrations, admin authz); docs sync; PR.

---

## Verification (per milestone)

- **Automated:** `pnpm lint && pnpm typecheck && pnpm test` clean; `pnpm test:e2e` for the week's flow.
- **Behavioral:** `/verify` (or `browser-tester`) drives the week's demo in a real browser — the demo in
  each milestone's header is the acceptance check. Passing `tsc`/units is necessary, not sufficient, for UI.
- **Data:** `db-reader` subagent to confirm rows/migrations for backend tasks.
- **Review gates:** `code-reviewer` after each non-trivial task; `security-reviewer` before merging
  auth (wk1/3), audience/authz (wk4), and Redis/migrations (wk5); `frontend-design-reviewer` after UI.
- **Docs:** each new endpoint/resource has a `docs/api/<resource>.md` (via `docs-writer`), kept in sync.

## Self-review notes (coverage)

FR-1…FR-29 are each assigned to a week above (see the milestone map + task FR tags). NFR-1 (wk5 Redis),
NFR-2 (wk1/2 pagination+virtualization, wk5 pass), NFR-3 (wk1 validation), NFR-4 (wk1/3/4 authz +
security-reviewer), NFR-5 (wk5 rate limit), NFR-6 (design-system throughout), NFR-7 (generic
contract/adapters throughout). Sign-off gate covers the contract + precedence rule before feature code.
