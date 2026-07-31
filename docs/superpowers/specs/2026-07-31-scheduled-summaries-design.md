# Scheduled AI Summaries — Design

**Date:** 2026-07-31
**Branch:** `feat/scheduled-summaries` (off `main`)
**Status:** Approved design → ready for implementation plan

## Goal

Move the AI Summary from **on-demand** (generated whenever the user expands the panel) to
**scheduled, pre-generated** delivery: at an admin-configured time-of-day — in **each user's own
timezone** — the system generates that user's summary, persists it with a `generated_at`
timestamp, and shows it in the notifications panel all day. The user sees **when** it was generated
and can press a **reload** button to regenerate on demand.

## Why

A daily digest that lands in each recipient's local morning is the standard enterprise pattern
(Slack/M365/PagerDuty digests) and is what a global org (Securiti) needs — one org-wide fixed time
is meaningless across US/EU/India/APAC. Per-user-local generation also **spreads model load across
the day** instead of firing every user in a single burst.

## Decisions (locked with the user)

1. **Per-user timezone.** Admin sets one time-of-day; each user's summary fires at that time in
   their own tz. Per-user tz is stored on the user; editing it via UI is **out of scope here** and
   deferred to the upcoming per-user settings page (it seeds a default and demo values now).
2. **Coverage: only users with unread notifications** get a model-generated summary. Idle users get
   a cheap "caught up" marker (no model call) so the scheduler doesn't reconsider them every tick.
3. **Manual reload updates the shared stored summary + timestamp** (not an ephemeral per-session
   refresh) — the timestamp always reflects the last real generation, scheduled or manual.
4. **`aiSummaryEnabled` (existing global flag) stays the master gate.** Off ⇒ scheduler skips and
   the endpoints return 404, exactly as the on-demand endpoint does today.

## Architecture & the library boundary

The repo has two runtimes: the reusable **library** (`packages/core`, `server-fastify`, `shared`,
`vue`) which is **identity-free** (a boundary test forbids `FROM users` in `packages/core`), and the
**reference host** (`backend/`, `frontend/`) which owns identity, sessions, the AI provider, env,
and the process lifecycle.

Consequences for this feature:

- The **generation logic is reused unchanged**: `SummaryEngine.summarize(principal)` in
  `packages/core/src/ai/summarize.ts` already produces an audience-scoped summary for one principal.
- **Persistence** is keyed by `user_key text` (same identity-free pattern as `notification_reads`
  and `action_dispatches`), so it lives in `packages/core`.
- The **timing decision** is a pure, identity-free function in `packages/core` (data in, due-list
  out) — unit-testable without a clock or DB, and library-shaped per the mentor's direction.
- **User enumeration and the timer itself live in the host** (`backend/`), because enumerating users
  and reconstructing principals is identity work core is not allowed to do.

## Data model

Two migration dirs are kept in parity (`backend/migrations/` and `packages/core/migrations/`),
enforced by `backend/test/schema-parity.test.ts`. Rules below say which dir each change goes in.

1. **`user_summaries`** — new table, in **both** dirs (keyed by `user_key`, like `notification_reads`):

   ```sql
   CREATE TABLE user_summaries (
     user_key     text PRIMARY KEY,
     summary      text NOT NULL,          -- may be '' for a "caught up" marker
     based_on     integer NOT NULL,       -- notifications summarized; 0 = caught up
     generated_at timestamptz NOT NULL DEFAULT now()
   );
   ```

   Latest-only (upserted per user); no history.

2. **`global_settings.summary_time`** — new column, in **both** dirs:

   ```sql
   ALTER TABLE global_settings ADD COLUMN summary_time text NOT NULL DEFAULT '08:00';
   ```

   `'HH:MM'` 24-hour local time-of-day.

3. **`users.timezone`** — new column, **backend dir only** (the `users` table is host-owned and is
   not in the core migrations):
   ```sql
   ALTER TABLE users ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';
   ```
   IANA tz name. `backend/src/auth/seed.ts` seeds demo users with varied real zones (e.g.
   `admin`→`America/New_York`, `priya`→`Asia/Kolkata`, `sam`→`Europe/London`, `alex`→`Asia/Singapore`,
   `jordan`→`America/Los_Angeles`) so staggered generation is visible in the demo.

## Core: store, service, and the pure scheduler decision

**Types** (`packages/core/src/types.ts` / `ai`):

```ts
interface StoredSummary {
  summary: string;
  basedOn: number;
  generatedAt: string; /* ISO */
}
interface Settings {
  /* …existing… */ summaryTime: string; /* 'HH:MM' */
}
```

**Summary store** (`packages/core/src/ai/summary-store.ts`):

```ts
function createSummaryStore(query: QueryFn): {
  get(userKey: string): Promise<StoredSummary | null>;
  upsert(userKey: string, s: StoredSummary): Promise<void>; // INSERT … ON CONFLICT (user_key) DO UPDATE
};
```

**Service facade** (`packages/core/src/service.ts`):

```ts
getStoredSummary(args: { principal: Principal }): Promise<StoredSummary | null>; // reads the user's own row
refreshSummary(args: { principal: Principal }): Promise<StoredSummary>;          // generate (if unread) + persist
```

`refreshSummary` builds the audience-scoped context; **if `totalUnread === 0`** it upserts
`{ summary: '', basedOn: 0, generatedAt: now }` **without calling the model**; otherwise it calls
`SummaryEngine.summarize`, upserts `{ summary, basedOn, generatedAt: now }`, and returns it. It
preserves the existing gating (`AiDisabledError`→404, `AiNotConfiguredError`→501,
`AiRateLimitError`→429, `AiProviderError`→502) and the engine's 6-calls/recipient/min rate limit.

**Pure timing decision** (`packages/core/src/ai/schedule.ts`) — no DB, no `users`, just date math via
`Intl.DateTimeFormat` (no new dependency):

```ts
interface DueUser {
  userKey: string;
  timezone: string;
  lastGeneratedAt: string | null;
}
function computeDueSummaries(input: {
  users: DueUser[];
  now: Date;
  summaryTime: string; // 'HH:MM'
}): DueUser[];
```

A user is **due** when, in their timezone: their **local time-of-day ≥ `summaryTime` today** AND
(they have **no** prior summary OR their `lastGeneratedAt`, converted to their local date, is **before
today's local date**). This means the summary fires at the first tick at/after their local
`summaryTime`, **auto-recovers** if the server was down at that moment (still runs later the same
local day), and **never double-fires** (the "already generated today" guard; a manual reload sets
`generated_at` and therefore suppresses that day's scheduled run).

## Host: enumeration + in-process scheduler

- **`backend/src/auth/repository.ts`** — add `listSummaryScheduleRows(): Promise<Array<{ id: string;
userKey: string; timezone: string; lastGeneratedAt: string | null }>>`, one row per user:
  `SELECT u.id, u.username, u.timezone, s.generated_at FROM users u
 LEFT JOIN user_summaries s ON s.user_key = u.username`. (`userKey` = `username`, per the existing
  principal adapter.) The host may read `user_summaries` even though core owns it — the boundary rule
  only forbids **core** from reading `users`.
- **`backend/src/summary/scheduler.ts`** — `startSummaryScheduler(deps): () => void` (returns a stop
  fn). Every **15 minutes** (granularity chosen to honor +5:30/+5:45 offsets): read settings; if
  `!aiSummaryEnabled` skip the tick; load the schedule rows; `due = computeDueSummaries({ users, now,
summaryTime })`; for each due user reconstruct a `Principal` (`getUserWithRolesTeams(id)` →
  existing `principal-adapter`) and call `service.refreshSummary({ principal })`. Each user runs in a
  try/catch so one failure (e.g. a provider timeout) never aborts the batch; failures are logged
  without the summary body (PII discipline).
- **Lifecycle:** started from `backend/src/server.ts` after `service.ready()`; registered to stop via
  Fastify `onClose`. **Not started under tests** — gate on `NODE_ENV !== 'test'` plus an override env
  `SUMMARY_SCHEDULER_ENABLED` (validated in `backend/src/config/env.ts`, default on) so e2e/dev can
  disable it and the scheduler is driven directly in unit tests with an injected clock/interval.

## API (`packages/server-fastify` + docs)

- **`GET /notifications/summary`** (unchanged path, `requirePrincipal`) — now a **read** of the stored
  row: `200 { summary, basedOn, generatedAt } | { summary: null, basedOn: 0, generatedAt: null }`
  when the user has no summary yet. No generation, so no 501/429/502 here; still 404 when
  `aiSummaryEnabled` is off (consistent gating).
- **`POST /notifications/summary/refresh`** (new, `requirePrincipal`) — the reload button: calls
  `service.refreshSummary({ principal })`, returns `200 { summary, basedOn, generatedAt }`. Error
  mapping mirrors today's summary endpoint (404 disabled / 501 not configured / 429 rate-limited /
  502 provider error) and adds a Fastify route `rateLimit` keyed by `req.principal.userKey` (like the
  dispatch route) as a coarse guard on top of the engine's per-recipient limit.
- **`GET /settings/features`** — add `summaryTime` to the payload so the panel can show
  "runs at 8:00 AM" in its empty state. (`summaryTime` is not sensitive.)
- **`PATCH /admin/settings`** — extend the inline `settingsPatchSchema` with
  `summaryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()`; `updateSettings` and
  `getSettings` in `packages/core/src/policy/store.ts` map the new `summaryTime` ↔ `summary_time`
  column with the `'08:00'` default.
- Docs: `docs-writer` updates `docs/api/notifications.md` (summary read + refresh) and the admin
  settings doc (`summaryTime`).

## Frontend (`packages/vue` + reference app)

- **Summary store** (`packages/vue/src/state/summary.ts`) — reshaped:
  `state: { status: 'idle'|'loading'|'ready'|'empty'|'error'; summary: string; basedOn: number;
generatedAt: string | null; scheduleTime: string; refreshing: boolean; error: string | null }`.
  `fetchStored()` GETs on panel open/mount (no generation); `refresh()` POSTs `/notifications/summary/
refresh` with a button-local `refreshing` flag. The old expand-triggers-generation and
  debounced-on-unread-change behaviors are **removed**.
- **`InboxTab.vue`** — renders the stored summary with: a **timestamp** ("Generated 2h ago", exact
  time on hover via `lib/time`), a **reload button** (spinner while `refreshing`, accessible label),
  an **empty state** ("No summary yet — the daily summary runs at {scheduleTime}, or reload now"), and
  a **caught-up state** when `basedOn === 0` ("You're all caught up as of {time}"). Still wrapped in
  the `aiSummaryEnabled` gate. Design-system tokens; honors reduced-motion.
- **Admin UI** — add a `summaryTime` time input to the admin settings panel (the same panel that
  toggles the feature flags), wired through the existing `patch` client helper with save feedback.

## Testing

- **Core:** `summary-store` (upsert/get round-trip); `refreshSummary` (unread → model called + row
  stored; **0 unread → caught-up marker, model NOT called**; disabled/not-configured throw);
  `computeDueSummaries` pure unit — tz buckets including `Asia/Kolkata` (+5:30) and `Asia/Kathmandu`
  (+5:45), the done-today guard, catch-up when local time is well past `summaryTime`, skip before
  `summaryTime`, and the `lastGeneratedAt === null` first-run case, all with a fixed `now`. The core
  **boundary test stays green** (`schedule.ts` and `summary-store.ts` never reference `users`).
- **server-fastify:** `GET` returns the stored row / null-shape; `POST refresh` generates + persists;
  gating and error mapping (404/501/429/502); rate-limit config present.
- **backend:** scheduler drives `refreshSummary` only for due users and **skips entirely when
  `aiSummaryEnabled` is false**, using an injected clock/interval and a fake service (no real timer in
  the test); `listSummaryScheduleRows` query shape. `schema-parity.test.ts` passes.
- **e2e (frontend, `AI_PROVIDER=fake`, scheduler disabled):** panel shows a summary + timestamp after
  a reload; reload updates the timestamp; empty state before any generation; admin sets `summaryTime`
  and it persists. The scheduled fire itself is covered by the `computeDueSummaries`/scheduler units
  (deterministic clock), not e2e.
- Per `testing.md`: new business logic gets a Vitest test in the same task; the UI change is verified
  with `/verify` or `browser-tester` before "done".

## Out of scope (deliberate)

- **Per-user timezone editing UI** → the upcoming per-user settings page (this feature seeds a default
  - demo values only).
- **Summary history** — latest-only per user.
- **Catch-up across a full-day outage** — if the server is down for a user's entire local day, that
  day is skipped (the stale timestamp signals it; manual reload is available). Same-day recovery is
  handled; multi-day is not.
- **Multi-node scheduler coordination** — a single in-process timer suits the single-node prototype;
  running multiple backend instances would double-generate. A DB advisory lock is a future guard, not
  built now.
- **Streaming summaries** — generation stays single-shot (the streaming chatbot is a separate feature).
