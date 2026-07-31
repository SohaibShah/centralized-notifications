# Scheduled AI Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move AI summaries from on-demand generation to scheduled, per-user-local pre-generation that is persisted with a timestamp, shown in the panel, and refreshable via a reload button.

**Architecture:** Reuse `SummaryEngine.summarize(principal)` unchanged. Add a `user_summaries` store + a pure `computeDueSummaries()` timing function in `packages/core` (identity-free). Add the timer + user enumeration in `backend/` (the host owns identity). `GET /notifications/summary` becomes a read; `POST /notifications/summary/refresh` is the reload button.

**Tech Stack:** TypeScript (strict), Node/Fastify, `packages/core` domain lib, `packages/server-fastify` routes, `packages/vue` UI, Vue 3 `<script setup>`, PostgreSQL, Vitest, Playwright.

## Global Constraints

- **`packages/core` stays identity-free & env-free.** No `FROM users` in core; `packages/core/test/boundary.test.ts` must stay green. The scheduler, user enumeration, and process timer live in `backend/`.
- **Two migration dirs kept in parity.** `user_summaries` and `global_settings.summary_time` go in **BOTH** `packages/core/migrations/` and `backend/migrations/`. `users.timezone` is **backend-only** (`users` is host-owned). `backend/test/schema-parity.test.ts` must pass — add `"user_summaries"` to its `SHARED_TABLES`.
- **Forms are JSON-driven.** The admin time field is added to `packages/vue/src/forms/features.form.ts` + rendered by `<FormRenderer>` — never a hand-placed input.
- **Design system + a11y:** use existing tokens (`text-muted`, `text-ai`, `text-danger`, `text-faint`, etc.), honor reduced-motion, label controls.
- **Coverage rule:** only users with unread notifications get a model call; idle users get a cheap `basedOn: 0` marker (already how `SummaryEngine.summarize` returns for an empty set — no `provider.complete` call).
- **Manual reload updates the shared stored summary + `generated_at`** (not ephemeral).
- **Per task:** a Vitest test in the same task; `pnpm lint`, `pnpm typecheck`, `pnpm build` clean before "done". Conventional Commits. **No AI commit trailers.**
- **`summary_time` format:** `'HH:MM'` 24-hour, validated by `/^([01]\d|2[0-3]):[0-5]\d$/`, default `'08:00'`.

---

## File Structure

**Create**

- `packages/core/migrations/007_user_summaries.sql`, `packages/core/migrations/008_summary_time.sql`
- `backend/migrations/015_user_summaries.sql`, `backend/migrations/016_summary_time.sql`, `backend/migrations/017_users_timezone.sql`
- `packages/core/src/ai/summary-store.ts` — `createSummaryStore(query)` (get/upsert by `user_key`)
- `packages/core/src/ai/summary-store.spec.ts`
- `packages/core/src/ai/schedule.ts` — pure `computeDueSummaries(...)`
- `packages/core/src/ai/schedule.spec.ts`
- `backend/src/summary/schedule-repo.ts` — `listSummaryScheduleRows()`
- `backend/src/summary/scheduler.ts` — `runSummaryTick` + `startSummaryScheduler`
- `backend/src/summary/scheduler.spec.ts`
- `frontend/e2e/summary.spec.ts`

**Modify**

- `packages/core/src/types.ts` — `Settings.summaryTime`, new `StoredSummary`
- `packages/core/src/policy/store.ts` — load + map `summary_time`
- `packages/core/src/service.ts` — `getStoredSummary` / `refreshSummary` + interface
- `packages/core/src/index.ts` — export `computeDueSummaries` + types (if barrel-exported)
- `packages/server-fastify/src/routes/summary.ts` — GET read + POST refresh
- `packages/server-fastify/src/routes/admin.ts` — `summaryTime` in patch schema + features payload
- `backend/src/config/env.ts` — `SUMMARY_SCHEDULER_ENABLED`
- `backend/src/server.ts` — start/stop the scheduler
- `backend/src/auth/seed.ts` — seed per-user timezones
- `backend/test/schema-parity.test.ts` — add `user_summaries` to `SHARED_TABLES`
- `packages/vue/src/state/summary.ts` — read + refresh + timestamp state
- `packages/vue/src/state/settings.ts` — expose `summaryTime`
- `packages/vue/src/components/panel/InboxTab.vue` (+ `.spec.ts`) — stored summary UI
- `packages/vue/src/forms/types.ts` — add `"time"` field type
- `packages/vue/src/forms/features.form.ts` — add the summary-time field
- `docs/api/notifications.md` — summary read + refresh (via `docs-writer`)

---

## Task 1: Schema — `user_summaries`, `summary_time`, `users.timezone`, parity

**Files:**

- Create: `packages/core/migrations/007_user_summaries.sql`, `packages/core/migrations/008_summary_time.sql`
- Create: `backend/migrations/015_user_summaries.sql`, `backend/migrations/016_summary_time.sql`, `backend/migrations/017_users_timezone.sql`
- Modify: `backend/test/schema-parity.test.ts:20-26`, `backend/src/auth/seed.ts`
- Test: `backend/test/schema-parity.test.ts` (extended)

**Interfaces:**

- Produces: table `user_summaries(user_key text PK, summary text, based_on int, generated_at timestamptz)`; column `global_settings.summary_time text NOT NULL DEFAULT '08:00'`; column `users.timezone text NOT NULL DEFAULT 'UTC'`.

- [ ] **Step 1: Write the `user_summaries` migration in both dirs (identical DDL).**

`packages/core/migrations/007_user_summaries.sql` **and** `backend/migrations/015_user_summaries.sql`:

```sql
-- Per-user persisted AI summary (latest only). Keyed by user_key (text), identity-free like
-- notification_reads/action_dispatches. based_on = notifications summarized (0 = caught-up marker).
CREATE TABLE user_summaries (
  user_key     text PRIMARY KEY,
  summary      text NOT NULL,
  based_on     integer NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the `summary_time` migration in both dirs (identical DDL).**

`packages/core/migrations/008_summary_time.sql` **and** `backend/migrations/016_summary_time.sql`:

```sql
-- Admin-configured daily summary time-of-day (24h 'HH:MM', local to each user's timezone).
ALTER TABLE global_settings ADD COLUMN summary_time text NOT NULL DEFAULT '08:00';
```

- [ ] **Step 3: Write the backend-only `users.timezone` migration.**

`backend/migrations/017_users_timezone.sql`:

```sql
-- Per-user IANA timezone (host-owned users table; not part of the library schema).
-- Editing this via UI is deferred to the per-user settings page; seeded with demo values.
ALTER TABLE users ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';
```

- [ ] **Step 4: Seed varied timezones so staggered generation is visible.**

In `backend/src/auth/seed.ts`, add a `timezone` to each `USERS` entry and set it on upsert.

Change each `USERS` entry (line 23-34) to include `timezone`:

```ts
const USERS = [
  {
    username: "admin",
    displayName: "Admin User",
    roles: ["admin"],
    teams: [] as string[],
    timezone: "America/New_York",
  },
  {
    username: "priya",
    displayName: "Priya Nair",
    roles: ["privacy-analyst"],
    teams: ["privacy-ops"],
    timezone: "Asia/Kolkata",
  },
  {
    username: "sam",
    displayName: "Sam Okafor",
    roles: ["security-reviewer"],
    teams: ["security"],
    timezone: "Europe/London",
  },
  {
    username: "alex",
    displayName: "Alex Chen",
    roles: ["access-approver"],
    teams: [] as string[],
    timezone: "Asia/Singapore",
  },
  {
    username: "jordan",
    displayName: "Jordan Lee",
    roles: [] as string[],
    teams: ["privacy-ops"],
    timezone: "America/Los_Angeles",
  },
];
```

Change the user upsert (line 52-59) to write timezone:

```ts
const { rows } = await query<{ id: string }>(
  `INSERT INTO users (username, display_name, password_hash, timezone)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE
         SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash,
             timezone = EXCLUDED.timezone
       RETURNING id`,
  [user.username, user.displayName, passwordHash, user.timezone],
);
```

- [ ] **Step 5: Add `user_summaries` to the schema-parity table list.**

In `backend/test/schema-parity.test.ts`, extend `SHARED_TABLES` (line 20-26):

```ts
const SHARED_TABLES = [
  "notifications",
  "notification_reads",
  "modules",
  "global_settings",
  "action_dispatches",
  "user_summaries",
];
```

- [ ] **Step 6: Apply migrations and run the parity test.**

Run: `pnpm --filter @notifications/backend migrate`
Expected: completes, applies 015/016/017.
Run: `pnpm --filter @notifications/backend test -- schema-parity`
Expected: PASS — `user_summaries` and `global_settings` columns match between the fresh library schema and the reference migration history.

- [ ] **Step 7: Commit**

```bash
git add packages/core/migrations backend/migrations backend/test/schema-parity.test.ts backend/src/auth/seed.ts
git commit -m "feat(db): user_summaries table, summary_time setting, users.timezone"
```

---

## Task 2: `Settings.summaryTime` in core

**Files:**

- Modify: `packages/core/src/types.ts:35-41`, `packages/core/src/policy/store.ts:42-63,155-176`
- Test: `packages/core/src/policy/store.spec.ts` (existing; add cases) — if no such file exists, create `packages/core/src/policy/store.spec.ts`

**Interfaces:**

- Consumes: `global_settings.summary_time` (Task 1).
- Produces: `Settings.summaryTime: string`; `getSettings()` returns it (default `'08:00'`); `updateSettings({ summaryTime })` persists it.

- [ ] **Step 1: Write/extend the failing test.**

In `packages/core/src/policy/store.spec.ts`, add (mirror the existing test harness in that file for constructing a `PolicyStore` over a fake/real query):

```ts
it("returns summaryTime with an '08:00' default and round-trips an update", async () => {
  // uses the same DB/fake harness the other PolicyStore tests use
  const store = makeStore(); // existing helper in this spec
  expect((await store.getSettings()).summaryTime).toBe("08:00");
  await store.updateSettings({ summaryTime: "06:30" });
  expect((await store.getSettings()).summaryTime).toBe("06:30");
});
```

If the file/harness does not exist, create it following `packages/core/src/policy/` test conventions (a `pg-mem` or test-pool `query`), seeding a `global_settings` singleton row.

- [ ] **Step 2: Run it — expect FAIL** (`summaryTime` missing on `Settings`).

Run: `pnpm --filter @notifications/core test -- store`
Expected: FAIL (type error / undefined `summaryTime`).

- [ ] **Step 3: Add `summaryTime` to `Settings`.**

`packages/core/src/types.ts` (interface `Settings`, line 35-41):

```ts
export interface Settings {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
  retentionDays: number;
  /** Admin-configured daily summary time-of-day, 'HH:MM' 24h, applied in each user's own tz. */
  summaryTime: string;
}
```

- [ ] **Step 4: Load and map the column in `PolicyStore`.**

`packages/core/src/policy/store.ts` — extend the SELECT typing + query (line 42-51) to include `summary_time`:

```ts
const s = await this.query<{
  ai_summary_enabled: boolean;
  chatbot_enabled: boolean;
  grouping_enabled: boolean;
  actions_enabled: boolean;
  retention_days: number;
  summary_time: string;
}>(
  `SELECT ai_summary_enabled, chatbot_enabled, grouping_enabled, actions_enabled, retention_days,
              summary_time
         FROM global_settings WHERE id = true`,
);
```

Add to the returned `settings` object (after `retentionDays`, line 60):

```ts
        retentionDays: row?.retention_days ?? 30,
        summaryTime: row?.summary_time ?? "08:00",
```

Add to the `updateSettings` map (line 156-162):

```ts
const map: Record<keyof Settings, string> = {
  aiSummaryEnabled: "ai_summary_enabled",
  chatbotEnabled: "chatbot_enabled",
  groupingEnabled: "grouping_enabled",
  actionsEnabled: "actions_enabled",
  retentionDays: "retention_days",
  summaryTime: "summary_time",
};
```

- [ ] **Step 5: Run the test — expect PASS.**
      Run: `pnpm --filter @notifications/core test -- store`
      Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/policy/store.ts packages/core/src/policy/store.spec.ts
git commit -m "feat(core): summaryTime in Settings (global_settings.summary_time)"
```

---

## Task 3: Summary store + `getStoredSummary`/`refreshSummary`

**Files:**

- Create: `packages/core/src/ai/summary-store.ts`, `packages/core/src/ai/summary-store.spec.ts`
- Modify: `packages/core/src/types.ts` (add `StoredSummary`), `packages/core/src/service.ts`
- Test: `packages/core/src/ai/summary-store.spec.ts`, plus service cases in an existing service/ai spec

**Interfaces:**

- Consumes: `SummaryEngine.summarize(principal)` → `{ summary, basedOn }`; `user_summaries` table.
- Produces:
  - `interface StoredSummary { summary: string; basedOn: number; generatedAt: string /* ISO */ }`
  - `createSummaryStore(query: QueryFn): { get(userKey): Promise<StoredSummary | null>; upsert(userKey, s: StoredSummary): Promise<void> }`
  - `service.getStoredSummary({ principal }): Promise<StoredSummary | null>`
  - `service.refreshSummary({ principal }): Promise<StoredSummary>`

- [ ] **Step 1: Write the failing store test.**

`packages/core/src/ai/summary-store.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSummaryStore } from "./summary-store";

describe("summary store", () => {
  it("upsert then get returns the row", async () => {
    const rows: Record<string, unknown> = {};
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT")) {
        rows[params![0] as string] = {
          summary: params![1],
          based_on: params![2],
          generated_at: new Date(params![3] as string),
        };
        return { rows: [], rowCount: 1 };
      }
      const r = rows[params![0] as string];
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }) as unknown as import("../db").QueryFn;
    const store = createSummaryStore(query);
    expect(await store.get("u1")).toBeNull();
    await store.upsert("u1", {
      summary: "hi",
      basedOn: 3,
      generatedAt: "2026-07-31T08:00:00.000Z",
    });
    expect(await store.get("u1")).toEqual({
      summary: "hi",
      basedOn: 3,
      generatedAt: "2026-07-31T08:00:00.000Z",
    });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).
      Run: `pnpm --filter @notifications/core test -- summary-store`
      Expected: FAIL "Cannot find module './summary-store'".

- [ ] **Step 3: Implement the store.**

`packages/core/src/ai/summary-store.ts`:

```ts
import type { QueryFn } from "../db";
import type { StoredSummary } from "../types";

interface Row {
  summary: string;
  based_on: number;
  generated_at: Date;
}

/** Latest-only per-user persisted summary, keyed by user_key (identity-free — no join to users). */
export function createSummaryStore(query: QueryFn): {
  get(userKey: string): Promise<StoredSummary | null>;
  upsert(userKey: string, s: StoredSummary): Promise<void>;
} {
  return {
    async get(userKey) {
      const { rows } = await query<Row>(
        "SELECT summary, based_on, generated_at FROM user_summaries WHERE user_key = $1",
        [userKey],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        summary: r.summary,
        basedOn: r.based_on,
        generatedAt: new Date(r.generated_at).toISOString(),
      };
    },
    async upsert(userKey, s) {
      await query(
        `INSERT INTO user_summaries (user_key, summary, based_on, generated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_key) DO UPDATE
           SET summary = EXCLUDED.summary, based_on = EXCLUDED.based_on, generated_at = EXCLUDED.generated_at`,
        [userKey, s.summary, s.basedOn, s.generatedAt],
      );
    },
  };
}
```

- [ ] **Step 4: Add `StoredSummary` to types.**

`packages/core/src/types.ts` (after `Settings`):

```ts
/** A persisted AI summary for one user. `basedOn` = notifications summarized (0 = caught-up). */
export interface StoredSummary {
  summary: string;
  basedOn: number;
  generatedAt: string; // ISO
}
```

- [ ] **Step 5: Run store test — expect PASS.**
      Run: `pnpm --filter @notifications/core test -- summary-store`
      Expected: PASS.

- [ ] **Step 6: Write the failing service test.**

Add to the existing summary service spec (search for where `summarize` is tested, e.g. `packages/core/src/ai/summarize.spec.ts` or a service spec) a block using the same harness that builds a service/engine with a fake provider + test query. Assert:

```ts
it("refreshSummary generates + persists, and getStoredSummary reads it back", async () => {
  // harness: service built with a fake provider returning "digest text", settings.aiSummaryEnabled=true,
  // and a principal with one unread notification seeded.
  const before = await service.getStoredSummary({ principal });
  expect(before).toBeNull();
  const res = await service.refreshSummary({ principal });
  expect(res.basedOn).toBeGreaterThan(0);
  expect(typeof res.generatedAt).toBe("string");
  const stored = await service.getStoredSummary({ principal });
  expect(stored).toEqual(res);
});

it("refreshSummary writes a based_on:0 marker with NO provider call when nothing is unread", async () => {
  // harness: principal with zero unread; provider.complete is a spy.
  const res = await service.refreshSummary({ principal: emptyPrincipal });
  expect(res.basedOn).toBe(0);
  expect(providerCompleteSpy).not.toHaveBeenCalled();
  expect((await service.getStoredSummary({ principal: emptyPrincipal }))?.basedOn).toBe(0);
});
```

(Use whatever service/engine test harness the repo already has for `summarize`; reuse its fake provider + seeded notifications rather than inventing a new one.)

- [ ] **Step 7: Run it — expect FAIL** (`refreshSummary`/`getStoredSummary` not on the service).
      Run: `pnpm --filter @notifications/core test`
      Expected: FAIL.

- [ ] **Step 8: Wire the service methods.**

`packages/core/src/service.ts`:

- Add to the `NotificationService` interface (after the `summarize` declaration, ~line 75):

```ts
  /** Read the caller's persisted summary (scheduled or last manual refresh). Null = none yet. */
  getStoredSummary(args: { principal: Principal }): Promise<StoredSummary | null>;
  /** Generate the caller's summary now, persist it with a fresh generatedAt, and return it. Same
   *  gating/rate-limit as `summarize`. Nothing unread → a based_on:0 marker, no provider call. */
  refreshSummary(args: { principal: Principal }): Promise<StoredSummary>;
```

- Import `StoredSummary` in the `./types` import list (line 14-20).
- Import the store at top: `import { createSummaryStore } from "./ai/summary-store";`
- In `createNotificationService`, after `summaryEngine` is built (line 111), add:

```ts
const summaryStore = createSummaryStore(query);
```

- Add the two methods to the returned object (after `summarize:` line 142):

```ts
    getStoredSummary: (args) => summaryStore.get(args.principal.userKey),
    refreshSummary: async (args) => {
      const r = await summaryEngine.summarize(args.principal); // reuses gating + rate-limit + caught-up
      const generatedAt = new Date().toISOString();
      await summaryStore.upsert(args.principal.userKey, {
        summary: r.summary,
        basedOn: r.basedOn,
        generatedAt,
      });
      return { summary: r.summary, basedOn: r.basedOn, generatedAt };
    },
```

- [ ] **Step 9: Run tests + boundary — expect PASS.**
      Run: `pnpm --filter @notifications/core test`
      Expected: PASS, including `boundary.test.ts` (summary-store references no `users` table).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/ai/summary-store.ts packages/core/src/ai/summary-store.spec.ts packages/core/src/types.ts packages/core/src/service.ts packages/core/src/ai/summarize.spec.ts
git commit -m "feat(core): persisted summary store + getStoredSummary/refreshSummary"
```

---

## Task 4: Pure `computeDueSummaries` timing function

**Files:**

- Create: `packages/core/src/ai/schedule.ts`, `packages/core/src/ai/schedule.spec.ts`
- Modify: `packages/core/src/index.ts` (export `computeDueSummaries` + `DueUser`)

**Interfaces:**

- Produces:
  - `interface DueUser { userKey: string; timezone: string; lastGeneratedAt: string | null }`
  - `computeDueSummaries<T extends DueUser>(input: { users: T[]; now: Date; summaryTime: string }): T[]`

- [ ] **Step 1: Write the failing test.**
      `packages/core/src/ai/schedule.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeDueSummaries, type DueUser } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("computeDueSummaries", () => {
  // 2026-07-31T02:45:00Z → Kolkata (+5:30) local 08:15, Kathmandu (+5:45) 08:30, London (BST) 03:45.
  const now = at("2026-07-31T02:45:00.000Z");
  const time = "08:00";

  it("due at/after local target when never generated", () => {
    const users: DueUser[] = [
      { userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null }, // 08:15 ≥ 08:00 → due
      { userKey: "ktm", timezone: "Asia/Kathmandu", lastGeneratedAt: null }, // 08:30 ≥ 08:00 → due
      { userKey: "lon", timezone: "Europe/London", lastGeneratedAt: null }, // 03:45 < 08:00 → not due
    ];
    expect(computeDueSummaries({ users, now, summaryTime: time }).map((u) => u.userKey)).toEqual([
      "kol",
      "ktm",
    ]);
  });

  it("not due again if already generated today in the user's own tz", () => {
    const users: DueUser[] = [
      { userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: "2026-07-31T02:40:00.000Z" }, // local 08:10 today
    ];
    expect(computeDueSummaries({ users, now, summaryTime: time })).toEqual([]);
  });

  it("due again when the last generation was a previous local day (catch-up)", () => {
    const users: DueUser[] = [
      { userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: "2026-07-30T02:40:00.000Z" }, // yesterday local
    ];
    expect(computeDueSummaries({ users, now, summaryTime: time }).map((u) => u.userKey)).toEqual([
      "kol",
    ]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).
      Run: `pnpm --filter @notifications/core test -- schedule`
      Expected: FAIL.

- [ ] **Step 3: Implement the pure function.**
      `packages/core/src/ai/schedule.ts`:

```ts
/** One candidate for scheduled generation. Identity-free — the host supplies these rows. */
export interface DueUser {
  userKey: string;
  timezone: string;
  lastGeneratedAt: string | null;
}

/** Local calendar date ('YYYY-MM-DD') + minutes-since-midnight for `now` in `timeZone`. */
function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // en-CA hour12:false yields "24" for midnight in some ICU builds — normalize to 0.
  const hour = get("hour") === "24" ? 0 : Number(get("hour"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The subset of `users` whose summary is due: in the user's own timezone, the local time is at/after
 * `summaryTime` today AND they have not been generated yet today (no prior summary, or the prior one
 * was on an earlier local date). Fires at the first tick after local `summaryTime`, recovers if a tick
 * was missed earlier that local day, and never double-fires within a local day.
 */
export function computeDueSummaries<T extends DueUser>(input: {
  users: T[];
  now: Date;
  summaryTime: string;
}): T[] {
  const target = toMinutes(input.summaryTime);
  return input.users.filter((u) => {
    const { date, minutes } = localParts(input.now, u.timezone);
    if (minutes < target) return false;
    if (!u.lastGeneratedAt) return true;
    return localParts(new Date(u.lastGeneratedAt), u.timezone).date < date;
  });
}
```

- [ ] **Step 4: Export from the core barrel.**
      In `packages/core/src/index.ts`, add (next to other AI exports):

```ts
export { computeDueSummaries, type DueUser } from "./ai/schedule";
```

- [ ] **Step 5: Run tests + boundary — expect PASS.**
      Run: `pnpm --filter @notifications/core test -- schedule` then `pnpm --filter @notifications/core test`
      Expected: PASS (including `boundary.test.ts` — `schedule.ts` touches no DB/identity).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai/schedule.ts packages/core/src/ai/schedule.spec.ts packages/core/src/index.ts
git commit -m "feat(core): pure computeDueSummaries per-user-tz scheduling decision"
```

---

## Task 5: API — GET reads stored, POST refresh

**Files:**

- Modify: `packages/server-fastify/src/routes/summary.ts`
- Test: the existing summary route test (search `packages/server-fastify` for a `summary` route spec; extend it)

**Interfaces:**

- Consumes: `service.getStoredSummary`, `service.refreshSummary` (Task 3).
- Produces:
  - `GET /notifications/summary` → `200 { summary, basedOn, generatedAt } | { summary: null, basedOn: 0, generatedAt: null }`; `404` when disabled.
  - `POST /notifications/summary/refresh` → `200 { summary, basedOn, generatedAt }`; `404/501/429/502` per the AI errors; route `rateLimit` keyed by userKey.

- [ ] **Step 1: Write failing route tests.**
      Extend the summary route spec (mirror its existing harness that builds a Fastify app with a fake `service` + `requirePrincipal`):

```ts
it("GET returns the stored summary shape (null when none)", async () => {
  service.getStoredSummary = vi.fn(async () => null);
  const res = await app.inject({ method: "GET", url: "/notifications/summary", ...authHeaders });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ summary: null, basedOn: 0, generatedAt: null });
});

it("POST /refresh returns the freshly generated summary", async () => {
  service.refreshSummary = vi.fn(async () => ({
    summary: "digest",
    basedOn: 2,
    generatedAt: "2026-07-31T08:00:00.000Z",
  }));
  const res = await app.inject({
    method: "POST",
    url: "/notifications/summary/refresh",
    ...authHeaders,
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ summary: "digest", basedOn: 2 });
});

it("POST /refresh maps AiDisabledError to 404", async () => {
  service.refreshSummary = vi.fn(async () => {
    throw new AiDisabledError();
  });
  const res = await app.inject({
    method: "POST",
    url: "/notifications/summary/refresh",
    ...authHeaders,
  });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run — expect FAIL.**
      Run: `pnpm --filter @notifications/server-fastify test -- summary`
      Expected: FAIL.

- [ ] **Step 3: Rewrite the route file.**
      `packages/server-fastify/src/routes/summary.ts`:

```ts
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
  type NotificationService,
} from "@notifications/core";

/** Summary read (persisted) + manual refresh (regenerate + persist). Gated by `requirePrincipal`;
 *  the core service enforces the aiSummaryEnabled flag + provider availability + per-recipient rate. */
export function notificationSummaryRoute(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;

  app.get("/notifications/summary", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    try {
      const stored = await service.getStoredSummary({ principal });
      if (!stored) return reply.code(200).send({ summary: null, basedOn: 0, generatedAt: null });
      return reply.code(200).send(stored);
    } catch (err) {
      if (err instanceof AiDisabledError)
        return reply.code(404).send({ error: "ai summary disabled" });
      throw err;
    }
  });

  app.post(
    "/notifications/summary/refresh",
    {
      preHandler: requirePrincipal,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.principal?.userKey ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal;
      if (!principal) return reply.code(401).send({ error: "authentication required" });
      try {
        return reply.code(200).send(await service.refreshSummary({ principal }));
      } catch (err) {
        if (err instanceof AiDisabledError)
          return reply.code(404).send({ error: "ai summary disabled" });
        if (err instanceof AiNotConfiguredError)
          return reply.code(501).send({ error: "ai not configured" });
        if (err instanceof AiRateLimitError) return reply.code(429).send({ error: "rate limited" });
        if (err instanceof AiProviderError)
          return reply.code(502).send({ error: "summary unavailable" });
        throw err;
      }
    },
  );
}
```

Note: `getStoredSummary` never throws `AiNotConfigured/RateLimit/Provider` (it's a DB read), so GET only maps `AiDisabledError`. If the core `getStoredSummary` does not itself gate on `aiSummaryEnabled`, the GET's 404 branch is harmless dead code — keep the frontend gate (Task 9) as the real disable path; leave the try/catch for symmetry.

- [ ] **Step 4: Run — expect PASS.**
      Run: `pnpm --filter @notifications/server-fastify test -- summary`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server-fastify/src/routes/summary.ts packages/server-fastify/src/routes/summary.spec.ts
git commit -m "feat(server-fastify): GET reads stored summary, POST /refresh regenerates"
```

---

## Task 6: Admin `summaryTime` — patch schema + features payload

**Files:**

- Modify: `packages/server-fastify/src/routes/admin.ts:15-23,84-90`
- Test: the existing admin route spec (extend)

**Interfaces:**

- Consumes: `Settings.summaryTime` (Task 2).
- Produces: `PATCH /admin/settings` accepts `summaryTime` (HH:MM); `GET /settings/features` includes `summaryTime`.

- [ ] **Step 1: Write failing tests.**

```ts
it("PATCH /admin/settings accepts a valid summaryTime and rejects a bad one", async () => {
  const ok = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    ...adminHeaders,
    payload: { summaryTime: "06:30" },
  });
  expect(ok.statusCode).toBe(204);
  const bad = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    ...adminHeaders,
    payload: { summaryTime: "6:30pm" },
  });
  expect(bad.statusCode).toBe(400);
});

it("GET /settings/features includes summaryTime", async () => {
  service.getSettings = vi.fn(async () => ({
    aiSummaryEnabled: true,
    chatbotEnabled: true,
    groupingEnabled: true,
    actionsEnabled: true,
    retentionDays: 30,
    summaryTime: "08:00",
  }));
  const res = await app.inject({ method: "GET", url: "/settings/features", ...authHeaders });
  expect(res.json()).toMatchObject({ summaryTime: "08:00" });
});
```

- [ ] **Step 2: Run — expect FAIL.**
      Run: `pnpm --filter @notifications/server-fastify test -- admin`
      Expected: FAIL.

- [ ] **Step 3: Extend the patch schema.**
      `packages/server-fastify/src/routes/admin.ts`, add to `settingsPatchSchema` (line 16-22):

```ts
    retentionDays: z.number().int().positive().optional(),
    summaryTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "summaryTime must be 'HH:MM' 24-hour")
      .optional(),
```

- [ ] **Step 4: Add `summaryTime` to the features payload.**
      `packages/server-fastify/src/routes/admin.ts`, GET `/settings/features` (line 84-90):

```ts
app.get("/settings/features", { preHandler: requirePrincipal }, async (_req, reply) => {
  const { aiSummaryEnabled, chatbotEnabled, groupingEnabled, actionsEnabled, summaryTime } =
    await service.getSettings();
  return reply
    .code(200)
    .send({ aiSummaryEnabled, chatbotEnabled, groupingEnabled, actionsEnabled, summaryTime });
});
```

- [ ] **Step 5: Run — expect PASS.**
      Run: `pnpm --filter @notifications/server-fastify test -- admin`
      Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server-fastify/src/routes/admin.ts packages/server-fastify/src/routes/admin.spec.ts
git commit -m "feat(server-fastify): admin summaryTime (validated) + expose it in features"
```

---

## Task 7: Backend scheduler (host-owned)

**Files:**

- Create: `backend/src/summary/schedule-repo.ts`, `backend/src/summary/scheduler.ts`, `backend/src/summary/scheduler.spec.ts`
- Modify: `backend/src/config/env.ts:8-31`, `backend/src/server.ts:45-72`

**Interfaces:**

- Consumes: `computeDueSummaries`/`DueUser` (Task 4); `service.getSettings`, `service.refreshSummary` (Tasks 2-3); `getUserWithRolesTeams` + `toPrincipal`; `query` from `backend/src/db/pool`.
- Produces:
  - `ScheduleRow = DueUser & { id: string }`; `listSummaryScheduleRows(): Promise<ScheduleRow[]>`
  - `runSummaryTick(deps): Promise<void>` and `startSummaryScheduler(deps): () => void`

- [ ] **Step 1: Write the failing scheduler-tick test (fully injected, no DB, no real timer).**
      `backend/src/summary/scheduler.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runSummaryTick } from "./scheduler";
import type { ScheduleRow } from "./schedule-repo";

const rows: ScheduleRow[] = [
  { id: "1", userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null }, // due at 02:45Z
  { id: "2", userKey: "lon", timezone: "Europe/London", lastGeneratedAt: null }, // not due (03:45 local)
];
const now = () => new Date("2026-07-31T02:45:00.000Z");

it("generates only for due users when enabled", async () => {
  const generate = vi.fn(async () => {});
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => rows,
    generate,
    now,
  });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0].userKey).toBe("kol");
});

it("does nothing when aiSummaryEnabled is false", async () => {
  const generate = vi.fn(async () => {});
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: false, summaryTime: "08:00" }),
    listRows: async () => rows,
    generate,
    now,
  });
  expect(generate).not.toHaveBeenCalled();
});

it("one user's failure does not abort the batch", async () => {
  const three: ScheduleRow[] = [
    { id: "1", userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null },
    { id: "2", userKey: "ktm", timezone: "Asia/Kathmandu", lastGeneratedAt: null },
  ];
  const generate = vi.fn(async (r: ScheduleRow) => {
    if (r.userKey === "kol") throw new Error("boom");
  });
  const onError = vi.fn();
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => three,
    generate,
    now,
    onError,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run — expect FAIL** (modules missing).
      Run: `pnpm --filter @notifications/backend test -- scheduler`
      Expected: FAIL.

- [ ] **Step 3: Implement the repo.**
      `backend/src/summary/schedule-repo.ts`:

```ts
import type { DueUser } from "@notifications/core";
import { query } from "../db/pool";

/** A scheduling candidate: the library's DueUser plus the host user id (to rebuild a Principal). */
export type ScheduleRow = DueUser & { id: string };

/** One row per user: their tz + when their summary was last generated (null if never). userKey =
 *  username, matching the principal adapter. Reads user_summaries (core's table) by user_key. */
export async function listSummaryScheduleRows(): Promise<ScheduleRow[]> {
  const { rows } = await query<{
    id: string;
    username: string;
    timezone: string;
    generated_at: Date | null;
  }>(
    `SELECT u.id, u.username, u.timezone, s.generated_at
       FROM users u
       LEFT JOIN user_summaries s ON s.user_key = u.username`,
  );
  return rows.map((r) => ({
    id: r.id,
    userKey: r.username,
    timezone: r.timezone,
    lastGeneratedAt: r.generated_at ? new Date(r.generated_at).toISOString() : null,
  }));
}
```

- [ ] **Step 4: Implement the scheduler.**
      `backend/src/summary/scheduler.ts`:

```ts
import { computeDueSummaries } from "@notifications/core";
import type { ScheduleRow } from "./schedule-repo";

export interface SchedulerDeps {
  getSettings: () => Promise<{ aiSummaryEnabled: boolean; summaryTime: string }>;
  listRows: () => Promise<ScheduleRow[]>;
  generate: (row: ScheduleRow) => Promise<void>;
  now?: () => Date;
  onError?: (userKey: string, err: unknown) => void;
}

/** One scheduling pass: skip entirely when disabled; else generate for each due user, isolating
 *  per-user failures so one bad provider call can't abort the batch. */
export async function runSummaryTick(deps: SchedulerDeps): Promise<void> {
  const settings = await deps.getSettings();
  if (!settings.aiSummaryEnabled) return;
  const now = (deps.now ?? (() => new Date()))();
  const rows = await deps.listRows();
  const due = computeDueSummaries({ users: rows, now, summaryTime: settings.summaryTime });
  for (const row of due) {
    try {
      await deps.generate(row);
    } catch (err) {
      (deps.onError ?? ((k, e) => console.error(`[summary-scheduler] ${k} failed`, e)))(
        row.userKey,
        err,
      );
    }
  }
}

const FIFTEEN_MIN = 15 * 60 * 1000;

/** Start the periodic scheduler (default every 15 min, to honor half-hour tz offsets). Returns a
 *  stop function. The caller wires `generate` to principal reconstruction + service.refreshSummary. */
export function startSummaryScheduler(deps: SchedulerDeps & { intervalMs?: number }): () => void {
  const tick = () => void runSummaryTick(deps);
  const handle = setInterval(tick, deps.intervalMs ?? FIFTEEN_MIN);
  tick(); // run once at startup (same-day catch-up)
  return () => clearInterval(handle);
}
```

- [ ] **Step 5: Run — expect PASS.**
      Run: `pnpm --filter @notifications/backend test -- scheduler`
      Expected: PASS.

- [ ] **Step 6: Add the env flag.**
      `backend/src/config/env.ts`, add inside `envSchema` (after `AI_API_KEY`, line 30):

```ts
  // Master switch for the in-process daily-summary scheduler. Defaults on; set "false" to disable
  // (e.g. a deploy that runs the scheduler elsewhere). Never runs under NODE_ENV=test regardless.
  SUMMARY_SCHEDULER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
```

- [ ] **Step 7: Start/stop the scheduler in `server.ts`.**
      `backend/src/server.ts`:
- Add imports:

```ts
import { getUserWithRolesTeams } from "./auth/repository";
import { listSummaryScheduleRows } from "./summary/schedule-repo";
import { startSummaryScheduler } from "./summary/scheduler";
```

- After the `app.get("/health", …)` line (line 69), before `return app;`:

```ts
const env = getEnv();
if (env.NODE_ENV !== "test" && env.SUMMARY_SCHEDULER_ENABLED) {
  const stop = startSummaryScheduler({
    getSettings: () => service.getSettings(),
    listRows: listSummaryScheduleRows,
    generate: async (row) => {
      const user = await getUserWithRolesTeams(row.id);
      if (user) await service.refreshSummary({ principal: toPrincipal(user) });
    },
  });
  app.addHook("onClose", async () => stop());
}
```

- [ ] **Step 8: Verify typecheck + the existing backend suite still passes** (scheduler must not start under `NODE_ENV=test`).
      Run: `pnpm --filter @notifications/backend typecheck && pnpm --filter @notifications/backend test`
      Expected: PASS; no hanging timers in tests (guarded by `NODE_ENV !== "test"`).

- [ ] **Step 9: Commit**

```bash
git add backend/src/summary backend/src/config/env.ts backend/src/server.ts
git commit -m "feat(backend): in-process per-user-tz summary scheduler"
```

---

## Task 8: Frontend summary store — read + refresh + timestamp

**Files:**

- Modify: `packages/vue/src/state/summary.ts`, `packages/vue/src/state/settings.ts`
- Test: `packages/vue/src/state/summary.spec.ts` (create/extend), `packages/vue/src/state/settings.spec.ts` (extend if present)

**Interfaces:**

- Consumes: `GET /notifications/summary` → `{ summary, basedOn, generatedAt } | { summary: null, basedOn: 0, generatedAt: null }`; `POST /notifications/summary/refresh`; `GET /settings/features` now returns `summaryTime`.
- Produces: summary state `{ status, summary, basedOn, generatedAt, refreshing, error, fetchStored(), refresh() }`; settings state adds `summaryTime`.

- [ ] **Step 1: Write failing store tests.**
      `packages/vue/src/state/summary.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSummaryState } from "./summary";

const makeTransport = (over: Partial<Record<"get" | "post", unknown>> = {}) =>
  ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over }) as never;

describe("summary state", () => {
  it("fetchStored → empty when the server has no summary", async () => {
    const s = createSummaryState({
      transport: makeTransport({
        get: vi.fn(async () => ({ summary: null, basedOn: 0, generatedAt: null })),
      }),
    });
    await s.fetchStored();
    expect(s.status).toBe("empty");
  });

  it("fetchStored → ready with a generatedAt", async () => {
    const s = createSummaryState({
      transport: makeTransport({
        get: vi.fn(async () => ({
          summary: "digest",
          basedOn: 3,
          generatedAt: "2026-07-31T08:00:00.000Z",
        })),
      }),
    });
    await s.fetchStored();
    expect(s.status).toBe("ready");
    expect(s.summary).toBe("digest");
    expect(s.generatedAt).toBe("2026-07-31T08:00:00.000Z");
  });

  it("refresh POSTs and updates the summary + timestamp", async () => {
    const post = vi.fn(async () => ({
      summary: "fresh",
      basedOn: 5,
      generatedAt: "2026-07-31T09:00:00.000Z",
    }));
    const s = createSummaryState({ transport: makeTransport({ post }) });
    await s.refresh();
    expect(post).toHaveBeenCalledWith("/notifications/summary/refresh", {});
    expect(s.summary).toBe("fresh");
    expect(s.generatedAt).toBe("2026-07-31T09:00:00.000Z");
    expect(s.refreshing).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
      Run: `pnpm --filter @notifications/vue test -- summary`
      Expected: FAIL.

- [ ] **Step 3: Rewrite the summary store.**
      `packages/vue/src/state/summary.ts`:

```ts
import { reactive, ref } from "vue";
import { ApiError } from "../transport/cookie-transport";
import type { Transport } from "../transport/types";

interface StoredSummaryResponse {
  summary: string | null;
  basedOn: number;
  generatedAt: string | null;
}

/**
 * The current user's persisted AI summary. Read on panel open via `fetchStored`; regenerated on
 * demand via `refresh` (the reload button), which updates the shared stored summary + timestamp
 * server-side. States: idle → loading → ready | empty | error; `refreshing` drives the reload button.
 */
export function createSummaryState(deps: { transport: Transport }) {
  const status = ref<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const summary = ref("");
  const basedOn = ref(0);
  const generatedAt = ref<string | null>(null);
  const refreshing = ref(false);
  const error = ref<string | null>(null);

  function apply(res: StoredSummaryResponse): void {
    if (!res.generatedAt) {
      status.value = "empty";
      summary.value = "";
      basedOn.value = 0;
      generatedAt.value = null;
      return;
    }
    summary.value = res.summary ?? "";
    basedOn.value = res.basedOn;
    generatedAt.value = res.generatedAt;
    status.value = "ready";
  }

  async function fetchStored(): Promise<void> {
    if (status.value === "loading") return;
    status.value = "loading";
    error.value = null;
    try {
      apply(await deps.transport.get<StoredSummaryResponse>("/notifications/summary"));
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "Couldn't load the summary";
      status.value = "error";
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing.value) return;
    refreshing.value = true;
    error.value = null;
    try {
      apply(await deps.transport.post<StoredSummaryResponse>("/notifications/summary/refresh", {}));
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "Couldn't refresh the summary";
      if (status.value !== "ready") status.value = "error";
    } finally {
      refreshing.value = false;
    }
  }

  return reactive({
    status,
    summary,
    basedOn,
    generatedAt,
    refreshing,
    error,
    fetchStored,
    refresh,
  });
}

export type SummaryState = ReturnType<typeof createSummaryState>;
```

- [ ] **Step 4: Add `summaryTime` to the settings store.**
      `packages/vue/src/state/settings.ts`:
- Extend the response read. Keep `FeatureFlags` as the flags-only shape, add a separate `summaryTime` ref:

```ts
export function createSettingsState(deps: { transport: Transport }) {
  const flags = reactive<FeatureFlags>({
    aiSummaryEnabled: true,
    chatbotEnabled: true,
    groupingEnabled: true,
    actionsEnabled: true,
  });
  const summaryTime = ref("08:00");
  const loaded = ref(false);

  async function load(): Promise<void> {
    const data = await deps.transport.get<FeatureFlags & { summaryTime?: string }>(
      "/settings/features",
    );
    flags.aiSummaryEnabled = data.aiSummaryEnabled;
    flags.chatbotEnabled = data.chatbotEnabled;
    flags.groupingEnabled = data.groupingEnabled;
    flags.actionsEnabled = data.actionsEnabled;
    if (data.summaryTime) summaryTime.value = data.summaryTime;
    loaded.value = true;
  }

  return reactive({ flags, summaryTime, loaded, load });
}
```

- [ ] **Step 5: Run — expect PASS.**
      Run: `pnpm --filter @notifications/vue test -- summary && pnpm --filter @notifications/vue test -- settings`
      Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/vue/src/state/summary.ts packages/vue/src/state/summary.spec.ts packages/vue/src/state/settings.ts
git commit -m "feat(vue): summary store reads stored summary + reload; settings exposes summaryTime"
```

---

## Task 9: InboxTab — stored summary UI (timestamp + reload)

**Files:**

- Modify: `packages/vue/src/components/panel/InboxTab.vue`, `packages/vue/src/components/panel/InboxTab.spec.ts`
- Reference: `packages/vue/src/lib/time.ts` (`relativeTime`, `exactTime`)

**Interfaces:**

- Consumes: `useSummary()` new shape (Task 8); `settings.summaryTime`.

- [ ] **Step 1: Write/adjust failing component tests.**
      In `InboxTab.spec.ts` (mirror its existing mount harness), replace the old summary-block assertions with:

```ts
it("shows the stored summary + a generated-at timestamp when ready", async () => {
  // harness: provide a summary state stub { status:'ready', summary:'digest', basedOn:3,
  // generatedAt:'2026-07-31T08:00:00.000Z', refreshing:false, fetchStored, refresh }
  const wrapper = mountInbox({ summary: readySummary });
  await wrapper.find('[data-test="ai-summary-toggle"]').trigger("click");
  expect(wrapper.find('[data-test="ai-summary-text"]').text()).toContain("digest");
  expect(wrapper.find('[data-test="ai-summary-timestamp"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="ai-summary-reload"]').exists()).toBe(true);
});

it("shows the empty state with the schedule time when no summary exists", async () => {
  const wrapper = mountInbox({ summary: emptySummary, summaryTime: "08:00" });
  await wrapper.find('[data-test="ai-summary-toggle"]').trigger("click");
  expect(wrapper.find('[data-test="ai-summary-empty"]').text()).toContain("08:00");
});

it("reload calls summary.refresh", async () => {
  const refresh = vi.fn();
  const wrapper = mountInbox({ summary: { ...readySummary, refresh } });
  await wrapper.find('[data-test="ai-summary-toggle"]').trigger("click");
  await wrapper.find('[data-test="ai-summary-reload"]').trigger("click");
  expect(refresh).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL.**
      Run: `pnpm --filter @notifications/vue test -- InboxTab`
      Expected: FAIL.

- [ ] **Step 3: Rewire the script block.**
      In `packages/vue/src/components/panel/InboxTab.vue` `<script setup>`:
- Add imports: `import { RotateCw } from "@lucide/vue";` and `import { relativeTime, exactTime } from "../../lib/time";`
- Replace `toggleSummary` and the `watch`/`refreshTimer` block (lines 26-45) with:

```ts
function toggleSummary(): void {
  aiOpen.value = !aiOpen.value;
  bloomCount.value++;
  // Open shows the STORED summary (pre-generated on schedule) — fetch once, don't regenerate.
  if (aiOpen.value && summary.status === "idle") void summary.fetchStored();
}
```

- Remove the `onUnmounted(() => clearTimeout(refreshTimer))` line and the now-unused `watch`, `onUnmounted`, `feed.counts.unread` debounce. (Keep other imports that are still used.)

- [ ] **Step 4: Rewrite the summary detail markup.**
      Replace the `#ai-summary-detail` inner block (lines 105-124) with:

```html
<div
  v-if="summary.status === 'loading'"
  data-test="ai-summary-loading"
  class="flex items-center gap-1.5 text-ai motion-safe:animate-pulse"
>
  <Icon :icon="Sparkles" :size="13" />
  <span class="font-medium">Loading your summary…</span>
</div>

<div v-else-if="summary.status === 'ready'" class="flex flex-col gap-1.5">
  <p v-if="summary.basedOn > 0" data-test="ai-summary-text">{{ summary.summary }}</p>
  <p v-else data-test="ai-summary-caughtup" class="text-muted">You're all caught up.</p>
  <div class="flex items-center gap-2 text-[11px] text-faint">
    <time
      v-if="summary.generatedAt"
      data-test="ai-summary-timestamp"
      :datetime="summary.generatedAt"
      :title="exactTime(summary.generatedAt)"
      class="font-mono tabular-nums"
    >
      Generated {{ relativeTime(summary.generatedAt) }}
    </time>
    <button
      type="button"
      data-test="ai-summary-reload"
      class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-ai hover:bg-sunken disabled:opacity-50"
      :disabled="summary.refreshing"
      :aria-busy="summary.refreshing ? 'true' : undefined"
      @click="summary.refresh()"
    >
      <Icon
        :icon="RotateCw"
        :size="12"
        :class="{ 'motion-safe:animate-spin': summary.refreshing }"
      />
      Reload
    </button>
  </div>
</div>

<p v-else-if="summary.status === 'empty'" data-test="ai-summary-empty" class="text-muted">
  No summary yet — the daily summary runs at {{ settings.summaryTime }}.
  <button
    type="button"
    data-test="ai-summary-reload"
    class="text-ai underline"
    :disabled="summary.refreshing"
    @click="summary.refresh()"
  >
    Generate now
  </button>
</p>

<p v-else-if="summary.status === 'error'" data-test="ai-summary-error" class="text-danger">
  Couldn't load the summary — is the local model running?
  <button type="button" data-test="ai-summary-retry" class="underline" @click="summary.refresh()">
    Retry
  </button>
</p>
```

- Add `data-test="ai-summary-toggle"` to the disclosure `<button>` (line 80-85) so the tests can target it.

- [ ] **Step 5: Run — expect PASS.**
      Run: `pnpm --filter @notifications/vue test -- InboxTab`
      Expected: PASS.

- [ ] **Step 6: Verify in a browser.**
      Use the `browser-tester` subagent (stack up via `pnpm dev`): open the panel → expand AI summary → confirm the stored summary + "Generated …" timestamp + a working Reload that updates the timestamp; confirm the empty state shows the schedule time for a fresh user.

- [ ] **Step 7: Commit**

```bash
git add packages/vue/src/components/panel/InboxTab.vue packages/vue/src/components/panel/InboxTab.spec.ts
git commit -m "feat(vue): InboxTab shows stored summary + timestamp + reload"
```

---

## Task 10: Admin — summary-time field (JSON form)

**Files:**

- Modify: `packages/vue/src/forms/types.ts:6-7`, `packages/vue/src/forms/features.form.ts`
- Test: `packages/vue/src/admin/FeaturesPanel.spec.ts` (extend) or `packages/vue/src/forms/features.form` render test

**Interfaces:**

- Consumes: `Settings.summaryTime` via `GET /admin/settings` (already returned by `getSettings`); `PATCH /admin/settings` (Task 6).
- Produces: a `"time"` form field type; the Features form renders/saves `summaryTime`.

- [ ] **Step 1: Write the failing test.**
      In `FeaturesPanel.spec.ts` (mirror its harness that stubs `transport.get`/`patch`), assert the time input renders and its value is submitted:

```ts
it("renders the summary-time field from /admin/settings and submits it", async () => {
  const get = vi.fn(async () => ({
    aiSummaryEnabled: true,
    chatbotEnabled: true,
    groupingEnabled: true,
    actionsEnabled: true,
    retentionDays: 30,
    summaryTime: "08:00",
  }));
  const patch = vi.fn(async () => undefined);
  const wrapper = mountFeatures({ get, patch });
  await flushPromises();
  const input = wrapper.find('input[name="summaryTime"]');
  expect(input.exists()).toBe(true);
  expect((input.element as HTMLInputElement).value).toBe("08:00");
  await input.setValue("06:30");
  await wrapper.find("form").trigger("submit");
  expect(patch).toHaveBeenCalledWith(
    "/admin/settings",
    expect.objectContaining({ summaryTime: "06:30" }),
  );
});
```

- [ ] **Step 2: Run — expect FAIL.**
      Run: `pnpm --filter @notifications/vue test -- FeaturesPanel`
      Expected: FAIL.

- [ ] **Step 3: Add the `"time"` field type.**
      `packages/vue/src/forms/types.ts` (line 6-7):

```ts
export type FieldType =
  "text" | "email" | "password" | "number" | "textarea" | "select" | "checkbox" | "switch" | "time";
```

(`TextField.vue` already renders `:type="field.type"` for non-textarea fields, so `type: "time"` produces a native `<input type="time">` — no change needed there.)

- [ ] **Step 4: Add the field to the features form.**
      `packages/vue/src/forms/features.form.ts`, add as the last entry in `fields` (after `actionsEnabled`):

```ts
    {
      name: "summaryTime",
      label: "Daily summary time",
      type: "time",
      hint: "When each user's AI summary is generated, in their own timezone (24-hour).",
    },
```

- [ ] **Step 5: Run — expect PASS.**
      Run: `pnpm --filter @notifications/vue test -- FeaturesPanel`
      Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/vue/src/forms/types.ts packages/vue/src/forms/features.form.ts packages/vue/src/admin/FeaturesPanel.spec.ts
git commit -m "feat(vue): admin daily-summary-time field (JSON form 'time' type)"
```

---

## Task 11: e2e + API docs

**Files:**

- Create: `frontend/e2e/summary.spec.ts`
- Modify: `docs/api/notifications.md` (via `docs-writer`)

**Interfaces:**

- Consumes: everything above; runs against the reference app with `AI_PROVIDER=fake`. The scheduler does not run under `NODE_ENV=test`, so e2e drives only the read + manual refresh.

- [ ] **Step 1: Write the e2e happy path + empty state.**
      `frontend/e2e/summary.spec.ts` (mirror `frontend/e2e/dispatch.spec.ts` login helper + intake publish):

```ts
import { expect, test } from "@playwright/test";

const DEV_USER = "admin";
const DEV_PASSWORD = "notify-dev-2026";

async function login(page) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(DEV_USER);
  await page.locator('input[name="password"]').fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("AI summary: reload generates a summary and stamps a time", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  await page.locator('[data-test="ai-summary-toggle"]').click();

  // Fresh user may have no stored summary → empty state names the schedule time; reload generates one.
  await page.locator('[data-test="ai-summary-reload"]').first().click();
  await expect(page.locator('[data-test="ai-summary-timestamp"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-test="ai-summary-timestamp"]')).toContainText(/Generated/);
});
```

(If a summary already exists from seed/dev, the test still passes — reload updates the timestamp. Keep it resilient to either start state.)

- [ ] **Step 2: Run the e2e.**
      Run: `pnpm test:e2e -- summary`
      Expected: PASS (with `AI_PROVIDER=fake`, `NODE_ENV=test` in the Playwright webServer env).

- [ ] **Step 3: Update API docs.**
      Dispatch the `docs-writer` subagent to update `docs/api/notifications.md`: `GET /notifications/summary` now returns the persisted `{ summary, basedOn, generatedAt }` (or the null shape) and no longer generates; document the new `POST /notifications/summary/refresh` (auth, rate limit, 200/401/404/501/429/502), and add `summaryTime` to the `GET /settings/features` and `PATCH /admin/settings` shapes.

- [ ] **Step 4: Whole-repo green.**
      Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
      Expected: all clean/green.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/summary.spec.ts docs/api/notifications.md
git commit -m "test(e2e): scheduled-summary read + reload; docs(api): summary endpoints"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** persistence (Task 1,3) · per-user-tz timing (Task 4) · host scheduler + enumeration + `aiSummaryEnabled` gate (Task 7) · GET-read + POST-refresh (Task 5) · admin `summary_time` (Task 1,2,6,10) · `users.timezone` seed (Task 1) · frontend stored-summary + timestamp + reload + empty/caught-up (Task 8,9) · coverage rule / caught-up marker (Task 3) · manual-reload-updates-shared (Task 3,8) · tests incl. +5:30/+5:45 (Task 4) and scheduler disabled-gate (Task 7) · docs (Task 11) · migration parity (Task 1). ✔ No gaps.
- **Type consistency:** `StoredSummary { summary; basedOn; generatedAt }`, `DueUser`/`ScheduleRow`, `Settings.summaryTime`, and the GET null-shape `{ summary: null, basedOn: 0, generatedAt: null }` are used identically across core, server, and frontend. ✔
- **Out of scope kept out:** per-user tz editing UI, summary history, multi-day-outage catch-up, multi-node coordination, streaming. ✔
