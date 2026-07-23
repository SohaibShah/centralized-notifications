# BE Client Library Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the notification backend into two importable packages (`@notifications/core`, framework-agnostic; `@notifications/server-fastify`, a mountable HTTP+SSE plugin) with `backend/` rewired as the reference consumer, so any Node host can drop the system in with its own identity, DB pool, and module catalog.

**Architecture:** `@notifications/core` exposes `createNotificationService({ pool, config })` returning a service whose read methods take an already-resolved `Principal`; it references zero identity tables and reads no `process.env`. `@notifications/server-fastify` mounts the routes and wires the host's `auth`/`intakeAuth` adapters to the core. The current `backend/` keeps identity/login/sessions and consumes both packages exactly as a third party would. Full identity decouple: read-state re-keys to an opaque `user_key`, and live delivery matches each connected subscriber's `Principal` in-memory (retiring `resolveRecipients`' identity-table queries).

**Tech Stack:** TypeScript (strict, ESM), pnpm workspaces, Fastify 5, node-pg, zod 3, tsup, Vitest, Playwright (unchanged).

## Global Constraints

- TS strict everywhere; `pnpm lint` + `pnpm typecheck` clean before any task is "done". `any` needs an inline justification.
- New logic carries a Vitest test in the same task (`testing.md`).
- Parameterized SQL only. **`packages/core` must contain NO reference to `users` / `user_teams` / `user_roles` / session tables** and NO `process.env` read (enforced by the boundary test, Task 22).
- No secrets in code; the reference app validates env at startup and passes values in.
- No AI-attribution commit trailers. Conventional Commits (`feat:`, `refactor:`, `chore:`, `docs:`, `test:`).
- `docs/api/*` kept in sync via the **docs-writer** subagent where request/response/side-effect shapes move.
- `Principal = { userKey: string; roles: string[]; teamKeys: string[] }`. User-scope audience keys on `userKey` (= username in the reference app).
- Library-owned tables keep their current names (`notifications`, `notification_reads`, `modules`, `global_settings`); a configurable table prefix is out of scope.
- **Mentor sign-off on the public API (`createNotificationService` config, the plugin options, `Principal`, `migrate(pool)`, the library's reserved table set) is required BEFORE execution begins.** Do not start Task 1 until that sign-off is recorded.

## Migration strategy (read before Unit E/G — it governs two tasks)

The reference app has an existing dev DB with `backend/migrations/001–010` already applied under the `schema_migrations` ledger. The library ships a **fresh, consolidated** migration set for brand-new hosts. These two must never run the same DDL against the same DB:

- **Fresh host** runs `@notifications/core`'s `migrate(pool)`, which applies `packages/core/migrations/*.sql` under a distinct ledger table `notifications_schema_migrations`, building the final library schema (`notifications`, `notification_reads` keyed on `user_key`, `modules` state, `global_settings`, indexes) from zero.
- **Reference app** keeps its historical `backend/migrations/001–010` (immutable history) and adds forward **transform** migrations (`011`, `012`) to converge its existing schema to the library's target. Its migrate script runs **only** `backend/migrations` — it does NOT call the library's `migrate(pool)` (its history already built those tables).
- A **schema-parity test** (Task 21) guards drift: a DB built by the library's `migrate(pool)` and a DB built by the reference app's full migration history must produce matching definitions for the shared tables.

---

## File Structure

**`packages/core/` (`@notifications/core`) — new**

- `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- `src/index.ts` — public exports: `createNotificationService`, `migrate`, and all public types
- `src/types.ts` — `Principal`, `NotificationServiceConfig`, `ModuleCatalogEntry`, `ModulePolicyView`, `Settings`, `NotificationService`
- `src/db.ts` — `createDb(pool)` → `{ query }` bound to the injected pool; `QueryFn` type
- `src/service.ts` — `createNotificationService` (assembles context + methods)
- `src/audience/match.ts` — `audienceWhere(principal, params)` (SQL) + `matchAudience(principal, audience)` (in-memory)
- `src/delivery/hub.ts`, `src/delivery/coalescing-buffer.ts` — moved; `Subscriber` keyed on `principal`
- `src/pipeline/validate.ts`, `persist.ts`, `ingest.ts` — moved, pool injected
- `src/policy/store.ts` — module state reconcile, `resolveModule`, `listModules`, `setModuleEnabled`, `touchModule`, `getSettings`, `updateSettings`, in-process cache
- `src/read/feed.ts` — `list`, cursor codec; `src/read/counts.ts`; `src/read/read-state.ts` — `markRead`/`markReadBulk`/`markUnread`
- `src/migrate.ts` — `migrate(pool)`
- `migrations/*.sql` — the library's fresh schema
- `test/*.test.ts`

**`packages/server-fastify/` (`@notifications/server-fastify`) — new**

- `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- `src/index.ts` — `notificationFastifyPlugin`, `NotificationPluginOptions`
- `src/plugin.ts` — registers the route groups with injected adapters
- `src/routes/notifications.ts`, `sse.ts`, `intake.ts`, `admin.ts`
- `test/*.test.ts` — `app.inject` + a fake auth adapter

**`backend/` (reference app) — rewired**

- Keep: `src/auth/*`, `src/config/*`, `src/db/pool.ts`, `src/scripts/*`, `src/sim/*`, `src/http/admin/maintenance.ts`, `src/http/admin/simulate.ts`
- New: `src/reference/principal-adapter.ts` — `toPrincipal(user: SessionUser): Principal`
- Rewrite: `src/server.ts` — register the plugin with adapters; `src/index.ts` unchanged
- Delete after moves: `src/pipeline/*` (moved), `src/delivery/*` (moved), `src/http/notifications/routes.ts` (moved), `src/http/sse/*` (moved), `src/http/admin/routes.ts` (moved), `src/audience/*` (moved)
- New migrations: `backend/migrations/011_notification_reads_userkey.sql`, `012_modules_drop_label.sql`
- `src/db/migrate.ts` unchanged (still runs `backend/migrations`)

---

## Unit A — Scaffold `@notifications/core` (context + types)

### Task 1: Scaffold the core package

**Files:**

- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`

**Interfaces:**

- Produces: the `@notifications/core` package resolves in the workspace and builds.

- [ ] **Step 1: Write `package.json`** (mirror `packages/shared/package.json`'s publishable shape)

```json
{
  "name": "@notifications/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": { ".": { "types": "./src/index.ts", "import": "./src/index.ts" } },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "files": ["src", "dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": { "@notifications/shared": "workspace:*", "pg": "^8.22.0", "zod": "^3.24.1" },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/pg": "^8.20.0",
    "tsup": "^8.3.5",
    "typescript": "^5.7.3",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** — copy `backend/tsconfig.json` verbatim (same strict/ESM settings), adjusting only relative paths if any. Write `tsup.config.ts` and `vitest.config.ts` by copying `backend/`'s equivalents (or `packages/shared/`'s if `backend/` has none).

- [ ] **Step 3: Write a placeholder `src/index.ts`**

```ts
export const CORE_PACKAGE = "@notifications/core" as const;
```

- [ ] **Step 4: Install + verify the workspace resolves**

Run: `pnpm install && pnpm --filter @notifications/core typecheck`
Expected: install links the package; typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "chore(core): scaffold @notifications/core package"
```

### Task 2: DB context + public types

**Files:**

- Create: `packages/core/src/db.ts`, `packages/core/src/types.ts`, `packages/core/test/db.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Produces:
  - `type QueryFn = <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<QueryResult<T>>`
  - `createDb(pool: Pool): { query: QueryFn }`
  - `interface Principal { userKey: string; roles: string[]; teamKeys: string[] }`
  - `interface ModuleCatalogEntry { id: string; label: string }`
  - `interface Settings { aiSummaryEnabled: boolean; chatbotEnabled: boolean; groupingEnabled: boolean; actionsEnabled: boolean; retentionDays: number }`
  - `interface NotificationServiceConfig { modules: ModuleCatalogEntry[]; adminRole?: string /* default "admin" */ }`

- [ ] **Step 1: Write the failing test** `packages/core/test/db.test.ts`

```ts
import pg from "pg";
import { afterAll, expect, test } from "vitest";
import { createDb } from "../src/db";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
afterAll(() => pool.end());

test("createDb.query runs a parameterized query against the injected pool", async () => {
  const db = createDb(pool);
  const { rows } = await db.query<{ n: number }>("SELECT $1::int AS n", [7]);
  expect(rows[0]?.n).toBe(7);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test`
Expected: FAIL — cannot find `../src/db`.

- [ ] **Step 3: Implement `src/db.ts`**

```ts
import type pg from "pg";
import type { Pool, QueryResult, QueryResultRow } from "pg";

export type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/** Bind a query helper to a host-provided pool. The single place core touches pg. */
export function createDb(pool: Pool): { query: QueryFn } {
  return { query: (text, params) => pool.query(text, params) as ReturnType<QueryFn> };
}
```

- [ ] **Step 4: Implement `src/types.ts`** (exact shapes from the Interfaces block above), then re-export from `src/index.ts`:

```ts
export { createDb, type QueryFn } from "./db";
export type { Principal, ModuleCatalogEntry, Settings, NotificationServiceConfig } from "./types";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL pnpm --filter @notifications/core test` (a local Postgres from `docker compose up -d` must be running)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core && git commit -m "feat(core): injected DB context + public types"
```

---

## Unit B — Delivery hub with Principal matching (retire resolveRecipients)

### Task 3: In-memory audience matching

**Files:**

- Create: `packages/core/src/audience/match.ts`, `packages/core/test/audience-match.test.ts`

**Interfaces:**

- Consumes: `Principal` (Task 2), `Audience` (from `@notifications/shared`).
- Produces:
  - `matchAudience(principal: Principal, audience: Audience): boolean` — the in-memory twin of the SQL `audienceWhere`.
  - `audienceWhere(principal: Principal, params: unknown[]): string` — moved verbatim from `backend/src/audience/principal.ts:35-44` (SQL fragment; still pushes `teamKeys, roles, userKey`).

- [ ] **Step 1: Write the failing test** `packages/core/test/audience-match.test.ts`

```ts
import { expect, test } from "vitest";
import { matchAudience } from "../src/audience/match";

const p = { userKey: "priya", roles: ["privacy-analyst"], teamKeys: ["privacy"] };

test("global matches everyone", () => {
  expect(matchAudience(p, { scope: "global" })).toBe(true);
});
test("team matches only members", () => {
  expect(matchAudience(p, { scope: "team", id: "privacy" })).toBe(true);
  expect(matchAudience(p, { scope: "team", id: "security" })).toBe(false);
});
test("role matches only holders", () => {
  expect(matchAudience(p, { scope: "role", id: "privacy-analyst" })).toBe(true);
  expect(matchAudience(p, { scope: "role", id: "admin" })).toBe(false);
});
test("user matches only the userKey", () => {
  expect(matchAudience(p, { scope: "user", id: "priya" })).toBe(true);
  expect(matchAudience(p, { scope: "user", id: "sam" })).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test audience-match`
Expected: FAIL — cannot find `../src/audience/match`.

- [ ] **Step 3: Implement `src/audience/match.ts`**

```ts
import type { Audience } from "@notifications/shared";
import type { Principal } from "../types";

/**
 * In-memory audience check — the exact twin of the SQL `audienceWhere`, used by the delivery
 * hub to decide whether a connected subscriber should receive a published notification. Keeping
 * the two in lockstep is what makes "what you receive live" == "what your feed shows".
 */
export function matchAudience(p: Principal, a: Audience): boolean {
  switch (a.scope) {
    case "global":
      return true;
    case "team":
      return a.id !== undefined && p.teamKeys.includes(a.id);
    case "role":
      return a.id !== undefined && p.roles.includes(a.id);
    case "user":
      return a.id !== undefined && a.id === p.userKey;
  }
}

/** SQL audience predicate — moved from backend/src/audience/principal.ts. Pushes teamKeys, roles,
 *  userKey onto `params`; the caller aliases the notifications table as `n`. */
export function audienceWhere(p: Principal, params: unknown[]): string {
  params.push(p.teamKeys, p.roles, p.userKey);
  const t = params.length - 2,
    r = params.length - 1,
    u = params.length;
  return `(n.audience_scope = 'global'
        OR (n.audience_scope = 'team' AND n.audience_id = ANY($${t}::text[]))
        OR (n.audience_scope = 'role' AND n.audience_id = ANY($${r}::text[]))
        OR (n.audience_scope = 'user' AND n.audience_id = $${u}::text))`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @notifications/core test audience-match`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): in-memory + SQL audience matching"
```

### Task 4: Move the delivery hub; key subscribers on Principal

**Files:**

- Create: `packages/core/src/delivery/hub.ts`, `packages/core/src/delivery/coalescing-buffer.ts`, `packages/core/test/hub.test.ts`
- Reference (moved from): `backend/src/delivery/hub.ts`, `backend/src/http/sse/coalescing-buffer.ts`

**Interfaces:**

- Consumes: `matchAudience` (Task 3), `Notification` (shared), `Principal`.
- Produces:
  - `interface Subscriber { principal: Principal; deliver(n: Notification): void }`
  - `class DeliveryHub { subscribe(s: Subscriber): () => void; publish(n: Notification): void; get subscriberCount(): number }`
  - `publish(n)` delivers to every subscriber whose `principal` matches `n.audience` (global → all). **`broadcast` / `publishToRecipients` are removed.**
  - `CoalescingBuffer<T>` — moved verbatim from `backend/src/http/sse/coalescing-buffer.ts` (no changes).

- [ ] **Step 1: Write the failing test** `packages/core/test/hub.test.ts`

```ts
import { expect, test, vi } from "vitest";
import type { Notification } from "@notifications/shared";
import { DeliveryHub } from "../src/delivery/hub";

const n = (audience: Notification["audience"]): Notification =>
  ({
    id: "x",
    module: "dsr",
    title: "t",
    description: "",
    priority: "high",
    snoozable: false,
    audience,
    createdAt: new Date().toISOString(),
    read: false,
  }) as Notification;

test("publish delivers a team notification only to matching subscribers", () => {
  const hub = new DeliveryHub();
  const priya = vi.fn(),
    sam = vi.fn();
  hub.subscribe({
    principal: { userKey: "priya", roles: [], teamKeys: ["privacy"] },
    deliver: priya,
  });
  hub.subscribe({ principal: { userKey: "sam", roles: [], teamKeys: ["security"] }, deliver: sam });
  hub.publish(n({ scope: "team", id: "privacy" }));
  expect(priya).toHaveBeenCalledOnce();
  expect(sam).not.toHaveBeenCalled();
});

test("publish delivers a global notification to all subscribers", () => {
  const hub = new DeliveryHub();
  const a = vi.fn(),
    b = vi.fn();
  hub.subscribe({ principal: { userKey: "a", roles: [], teamKeys: [] }, deliver: a });
  hub.subscribe({ principal: { userKey: "b", roles: [], teamKeys: [] }, deliver: b });
  hub.publish(n({ scope: "global" }));
  expect(a).toHaveBeenCalledOnce();
  expect(b).toHaveBeenCalledOnce();
});

test("a throwing subscriber does not abort the publish loop", () => {
  const hub = new DeliveryHub();
  const ok = vi.fn();
  hub.subscribe({
    principal: { userKey: "x", roles: [], teamKeys: [] },
    deliver: () => {
      throw new Error("boom");
    },
  });
  hub.subscribe({ principal: { userKey: "y", roles: [], teamKeys: [] }, deliver: ok });
  expect(() => hub.publish(n({ scope: "global" }))).not.toThrow();
  expect(ok).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test hub`
Expected: FAIL — cannot find `../src/delivery/hub`.

- [ ] **Step 3: Move the coalescing buffer** — copy `backend/src/http/sse/coalescing-buffer.ts` to `packages/core/src/delivery/coalescing-buffer.ts` unchanged.

- [ ] **Step 4: Implement `src/delivery/hub.ts`** (adapt the moved hub: `userId`→`principal`, `broadcast`/`publishToRecipients`→`publish`, keep `safeDeliver`)

```ts
import type { Notification } from "@notifications/shared";
import type { Principal } from "../types";
import { matchAudience } from "../audience/match";

export interface Subscriber {
  principal: Principal;
  deliver(notification: Notification): void;
}

/** In-process fan-out bus. Routing only — no transport (coalescing lives in the SSE layer).
 *  A distributed pub/sub transport (multi-instance) is a documented future seam. */
export class DeliveryHub {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** Deliver to every connected subscriber whose principal matches the notification's audience. */
  publish(notification: Notification): void {
    for (const s of this.subscribers) {
      if (matchAudience(s.principal, notification.audience)) this.safeDeliver(s, notification);
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private safeDeliver(s: Subscriber, n: Notification): void {
    try {
      s.deliver(n);
    } catch (err) {
      console.warn(`[delivery] subscriber threw during deliver: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @notifications/core test hub`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add packages/core && git commit -m "feat(core): principal-matched delivery hub; retire resolveRecipients"
```

---

## Unit C — Ingest pipeline in core

### Task 5: Move validate + persist

**Files:**

- Create: `packages/core/src/pipeline/validate.ts`, `packages/core/src/pipeline/persist.ts`, `packages/core/test/persist.test.ts`
- Reference (moved from): `backend/src/pipeline/validate.ts`, `backend/src/pipeline/persist.ts`

**Interfaces:**

- Consumes: `QueryFn` (Task 2), `Notification`/`notificationSchema` (shared).
- Produces:
  - `validate(raw): { ok: true; data: Notification } | { ok: false; error: string }` — moved verbatim (pure, no I/O).
  - `persist(query: QueryFn, n: Notification, suppressed: boolean): Promise<"accepted" | "duplicate">` — moved, but takes `query` as its first arg instead of importing the global pool.

- [ ] **Step 1: Write the failing test** `packages/core/test/persist.test.ts` — seed a notification via `persist(db.query, n, false)`, assert `"accepted"`, re-run, assert `"duplicate"`. (Use `createDb(pool)` with the test pool; use a unique `id` per run; clean up in `afterAll`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test persist`
Expected: FAIL — module not found.

- [ ] **Step 3: Move `validate.ts` unchanged.** Move `persist.ts` changing only its signature: replace `import { query } from "../db/pool"` with a `query: QueryFn` first parameter (`export async function persist(query: QueryFn, n: Notification, suppressed: boolean)`), leaving the SQL body identical.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @notifications/core test persist`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): move validate + pool-injected persist`

### Task 6: Move ingest (delivery via the new hub)

**Files:**

- Create: `packages/core/src/pipeline/ingest.ts`, `packages/core/test/ingest.test.ts`
- Reference: `backend/src/pipeline/ingest.ts`, `backend/src/intake/boundary.ts` (move `IngestResult`/`IngestStatus` types into `packages/core/src/pipeline/ingest.ts` or a sibling `boundary.ts`)

**Interfaces:**

- Consumes: `validate`, `persist`, the policy store's `resolveModule` + `touchModule` (Task 7 — **this task depends on Task 7's `resolveModule`/`touchModule` signatures**; implement Task 7 first if building strictly in order), `DeliveryHub` (Task 4), `QueryFn`.
- Produces:
  - `type IngestDeps = { query: QueryFn; hub: DeliveryHub; policy: PolicyStore }`
  - `ingest(deps: IngestDeps, raw: unknown): Promise<IngestResult>` — same validate→resolveModule→persist→deliver flow as `backend/src/pipeline/ingest.ts:16-50`, except the delivery branch becomes `if (enabled) deps.hub.publish(result.data)` (no `resolveRecipients`), and `resolveModule`/`persist`/`touchModule` are called through `deps`.

- [ ] **Step 1: Write the failing test** `packages/core/test/ingest.test.ts`

```ts
// Uses a real DB pool + a fresh PolicyStore (Task 7) with a catalog containing "dsr".
// Asserts: a valid "dsr" notification → status "accepted" and hub.publish called once;
// an unknown module → status "invalid" and hub.publish NOT called; a malformed payload → "invalid".
```

(Write the concrete assertions using `vi.spyOn(hub, "publish")` and a unique id per run.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test ingest`
Expected: FAIL — module not found.

- [ ] **Step 3: Move `ingest.ts`** with the `IngestDeps` signature and the `hub.publish` delivery branch (drop the `resolveRecipients` import; keep the `touchModule` best-effort try/catch and the value-free logging).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @notifications/core test ingest`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): pool/hub-injected ingest pipeline`

---

## Unit D — Policy + settings store (library-owned state, host-config catalog)

### Task 7: Policy store — module state + settings, catalog from config

**Files:**

- Create: `packages/core/src/policy/store.ts`, `packages/core/test/policy-store.test.ts`
- Reference: `backend/src/pipeline/policy.ts`, `backend/src/pipeline/modules.ts`, `backend/src/http/admin/routes.ts`

**Interfaces:**

- Consumes: `QueryFn`, `NotificationServiceConfig` (its `modules` catalog), `Settings`.
- Produces a `PolicyStore` class (constructed with `{ query, catalog: ModuleCatalogEntry[] }`):
  - `reconcile(): Promise<void>` — inserts a `modules` state row (`enabled = true` default) for each catalog id not yet present.
  - `resolveModule(id): Promise<{ known: boolean; enabled: boolean }>` — `known` = id is in the **config catalog**; `enabled` = not disabled in the state table. (Cached; `invalidate()` clears.)
  - `touchModule(id): Promise<void>` — `UPDATE modules SET last_seen_at = now() WHERE key = $1`.
  - `listModules(): Promise<ModulePolicyView[]>` — catalog `label` (from config) ⨝ state (`enabled`, `last_seen_at`) ⨝ per-module notification aggregate (total/suppressed/by-priority), sorted by `last_seen_at DESC`. `ModulePolicyView = { id; label; enabled; lastSeenAt: string | null; total; suppressed; byPriority: Record<NotificationPriority, number> }`.
  - `setModuleEnabled(id, enabled): Promise<void>` — `UPDATE modules SET enabled = $2 WHERE key = $1`; then `invalidate()`. Returns without error even if the id isn't in state (the plugin does the 404 check).
  - `getSettings(): Promise<Settings>`; `updateSettings(patch: Partial<Settings>): Promise<void>` — writes the mapped columns of the single `global_settings` row (see `backend/src/http/admin/routes.ts:91-114` for the column map), then `invalidate()`.

**Note (catalog `known` semantics):** `known` now derives from the injected catalog, NOT a `knownModules` DB set. The `modules` table holds state only; a module absent from config is unknown even if a stale state row exists.

- [ ] **Step 1: Write the failing test** `packages/core/test/policy-store.test.ts` — with a catalog `[{id:"dsr",label:"DSR"}]`: `reconcile()` then `resolveModule("dsr")` → `{known:true,enabled:true}`; `resolveModule("nope")` → `{known:false,...}`; `setModuleEnabled("dsr",false)` then `resolveModule("dsr")` → `enabled:false`; `getSettings()` returns defaults; `updateSettings({aiSummaryEnabled:false})` then `getSettings().aiSummaryEnabled` → false. (Guard the settings assertions so they restore state in `afterAll`, since `global_settings` is a shared singleton row.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test policy-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/policy/store.ts`** — port the cache + SQL from `policy.ts`/`modules.ts`/`admin/routes.ts`, replacing the `knownModules` DB read with the config catalog, and moving the `listModules` aggregate SQL from `admin/routes.ts:36-49` (join `label` from config in JS, or leave `label` out of SQL and merge from config in the mapper).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @notifications/core test policy-store`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): policy+settings store (host-config catalog, library state)`

---

## Unit E — Read path + read-state re-key

### Task 8: Library migration set (fresh-install schema)

**Files:**

- Create: `packages/core/migrations/001_notifications.sql`, `002_notification_reads.sql`, `003_modules.sql`, `004_global_settings.sql`, `005_indexes.sql`, and `packages/core/src/migrate.ts`
- Reference: the corresponding `backend/migrations/00X` files, consolidated to their **final** shape.

**Interfaces:**

- Produces: `migrate(pool: Pool): Promise<void>` — forward-only runner over `packages/core/migrations/*.sql` recorded in a `notifications_schema_migrations` ledger (copy `backend/src/db/migrate.ts`'s logic; change the ledger table name and the migrations dir).
- The fresh schema encodes the **final** library shape: `notification_reads` keyed on `user_key text` (PK `(user_key, notification_id)`, **no** users FK); `modules(key, enabled, last_seen_at)` (no `label`); `notifications` + `global_settings` as today; all existing feed/counts indexes.

- [ ] **Step 1: Write the failing test** `packages/core/test/migrate.test.ts` — connect to a **scratch** database (create `notif_core_migrate_test` via an admin connection, or use a schema), run `migrate(pool)`, assert `notification_reads` has a `user_key` column and no `user_id`, and `modules` has no `label` column (query `information_schema.columns`). Drop the scratch DB/schema in `afterAll`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test migrate`
Expected: FAIL — `migrate` not found.

- [ ] **Step 3: Author the consolidated `.sql` files** in final shape and implement `src/migrate.ts`. Export `migrate` from `src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @notifications/core test migrate`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): fresh-install migration set + migrate(pool)`

### Task 9: Read path — list + counts (keyed on user_key)

**Files:**

- Create: `packages/core/src/read/feed.ts`, `packages/core/src/read/counts.ts`, `packages/core/test/read.test.ts`
- Reference: `backend/src/http/notifications/routes.ts` (the `GET /notifications` handler `:144-227` and `GET /notifications/counts` `:318-342`, plus the cursor codec `:39-131`).

**Interfaces:**

- Consumes: `QueryFn`, `Principal`, `audienceWhere` (Task 3), shared types (`FeedSort`, `NotificationPage`, `NotificationCounts`).
- Produces:
  - `list(query: QueryFn, args: { principal: Principal; cursor?: string; limit?: number; sort?: FeedSort }): Promise<{ ok: true; page: NotificationPage } | { ok: false; error: "invalid cursor" }>`
  - `counts(query: QueryFn, args: { principal: Principal }): Promise<NotificationCounts>`
  - The read LEFT JOIN keys on `user_key`: `LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_key = $1`, and `$1 = principal.userKey` (was `user.id`). The cursor codec, keyset predicates, sort branches, and `toFeedNotification` move **unchanged** except the read-join column.

- [ ] **Step 1: Write the failing test** `packages/core/test/read.test.ts` — seed a global + a team notification (via `persist`), build two principals (a member and a non-member), assert `list` returns the member both and the non-member only the global; mark one read (insert a `notification_reads` row keyed on `userKey`) and assert its `read` flag flips and `counts.unread` drops by one. (Keyset paging correctness is already covered by the reference-app tests that move in Task 18; this task covers the audience + read-key behavior.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test read`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the handlers into `list`/`counts` functions** — lift the body of the two route handlers, drop the Fastify `req`/`reply` plumbing (return values / a typed result instead of `reply.code().send()`), key the read join on `user_key = principal.userKey`, and validate/decode the cursor as today (return `{ ok:false, error:"invalid cursor" }` on mismatch so the plugin maps it to 400).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @notifications/core test read`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): audience-scoped list + counts keyed on user_key`

### Task 10: Read-state writes (markRead / bulk / unread), keyed on user_key

**Files:**

- Create: `packages/core/src/read/read-state.ts`, `packages/core/test/read-state.test.ts`
- Reference: `backend/src/http/notifications/routes.ts` handlers `:236-309`.

**Interfaces:**

- Consumes: `QueryFn`, `Principal`, `audienceWhere`.
- Produces:
  - `markRead(query, { principal, id }): Promise<{ ok: true } | { ok: false; error: "not found" }>` — audience-scoped existence check (`SELECT 1 FROM notifications n WHERE n.id = $1 AND <audienceWhere>`) then `INSERT INTO notification_reads (user_key, notification_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`. Out-of-audience id → `{ ok:false, error:"not found" }` (no oracle).
  - `markUnread(query, { principal, id }): Promise<void>` — `DELETE FROM notification_reads WHERE user_key = $1 AND notification_id = $2`.
  - `markReadBulk(query, { principal, ids }): Promise<void>` — `INSERT ... SELECT $1, n.id FROM notifications n WHERE n.id = ANY($2::text[]) AND <audienceWhere> ON CONFLICT DO NOTHING`.

- [ ] **Step 1: Write the failing test** `packages/core/test/read-state.test.ts` — assert: marking-read an in-audience id inserts a row and is idempotent; marking-read an out-of-audience id returns `{ok:false,error:"not found"}` and inserts **nothing**; `markReadBulk` inserts only in-audience ids; `markUnread` removes the row.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test read-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/read/read-state.ts`** — port the three handlers, keying every `notification_reads` access on `user_key = principal.userKey`.

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): read-state writes keyed on user_key (no existence oracle)`

---

## Unit F — Assemble the service

### Task 11: `createNotificationService`

**Files:**

- Create: `packages/core/src/service.ts`, `packages/core/test/service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: all of Units B–E.
- Produces:
  - `createNotificationService(opts: { pool: Pool; config: NotificationServiceConfig }): NotificationService`
  - `interface NotificationService {`
    `ingest(raw): Promise<IngestResult>;`
    `list(args): Promise<NotificationPage>;` _(throws a typed `InvalidCursorError` the plugin maps to 400)_
    `counts(args): Promise<NotificationCounts>;`
    `markRead(args): Promise<void>;` _(throws `NotFoundError` → 404)_ `markReadBulk(args): Promise<void>; markUnread(args): Promise<void>;`
    `listModules(): Promise<ModulePolicyView[]>; setModuleEnabled(id, enabled): Promise<void>;`
    `getSettings(): Promise<Settings>; updateSettings(patch): Promise<void>;`
    `readonly delivery: DeliveryHub;`
    `readonly adminRole: string;`
    `ready(): Promise<void>; /* runs policy.reconcile() once */` `}`
- The factory builds `const { query } = createDb(pool)`, a `DeliveryHub`, a `PolicyStore({ query, catalog: config.modules })`, and closes the read/write/ingest functions over `query`/`hub`/`policy`.

- [ ] **Step 1: Write the failing test** `packages/core/test/service.test.ts` — construct the service with the test pool + a `[{id:"dsr",label:"DSR"}]` catalog, `await svc.ready()`, then drive one happy path end-to-end: `svc.ingest(validGlobalDsrPayload)` → subscribe a principal to `svc.delivery` first and assert it receives the publish; `svc.list({principal})` includes it; `svc.markRead({principal,id})` then `svc.counts({principal}).unread` reflects it.

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/core test service` — Expected: FAIL.

- [ ] **Step 3: Implement `src/service.ts`** and export `createNotificationService` + `NotificationService` + `InvalidCursorError`/`NotFoundError` from `src/index.ts`. `list`/`markRead` translate the `{ ok:false }` results into the typed errors.

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Full core gate**

Run: `pnpm --filter @notifications/core test && pnpm --filter @notifications/core typecheck && pnpm --filter @notifications/core build`
Expected: all green; `dist/` emitted.

- [ ] **Step 6: Commit** — `feat(core): createNotificationService assembles the domain`

---

## Unit G — `@notifications/server-fastify`

### Task 12: Scaffold the plugin package + options

**Files:**

- Create: `packages/server-fastify/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`

**Interfaces:**

- Produces:
  - `interface NotificationPluginOptions { service: NotificationService; auth: (req: FastifyRequest) => Promise<Principal | null> | Principal | null; intakeAuth: (req: FastifyRequest) => Promise<boolean> | boolean }`
  - `notificationFastifyPlugin: FastifyPluginAsync<NotificationPluginOptions>` (placeholder that registers nothing yet).
- `package.json` mirrors core's shape; deps: `@notifications/core`, `@notifications/shared`, `zod`; peer/dep `fastify: ^5.2.1`.

- [ ] **Step 1: Write the placeholder plugin + options types.** `pnpm install`.
- [ ] **Step 2: Verify** — Run: `pnpm --filter @notifications/server-fastify typecheck` — Expected: PASS.
- [ ] **Step 3: Commit** — `chore(server-fastify): scaffold plugin package + options`

### Task 13: An auth preHandler + the notifications routes

**Files:**

- Create: `packages/server-fastify/src/plugin.ts`, `src/routes/notifications.ts`, `test/notifications.route.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: `NotificationService`, `NotificationPluginOptions`.
- Produces: a `requirePrincipal` preHandler (calls `opts.auth(req)`; 401 + `{error:"authentication required"}` when null; decorates `req.principal`), and the mounted routes: `GET /notifications`, `GET /notifications/counts`, `POST /notifications/:id/read`, `POST /notifications/read`, `DELETE /notifications/:id/read`. Query/param/body validation stays at the route (reuse the zod schemas from `backend/src/http/notifications/routes.ts:20-32`). `list` throwing `InvalidCursorError` → 400; `markRead` throwing `NotFoundError` → 404. Sets `maxParamLength: 256` on the routes (or documents it as a host requirement).

- [ ] **Step 1: Write the failing test** `test/notifications.route.test.ts`

```ts
// Build a Fastify app, register the plugin with a REAL createNotificationService (test pool +
// {id:"dsr"} catalog) and a FAKE auth adapter: auth: (req) => ({ userKey: req.headers["x-test-user"],
// roles: [], teamKeys: (req.headers["x-test-teams"] ?? "").split(",").filter(Boolean) }).
// Seed via svc.ingest. Assert app.inject GET /notifications with x-test-user=priya returns the
// global + priya's team items and not others; a missing auth → 401; a bad cursor → 400.
```

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/server-fastify test notifications.route` — Expected: FAIL.
- [ ] **Step 3: Implement `plugin.ts` + `routes/notifications.ts`** and register them from `notificationFastifyPlugin`.
- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server-fastify): auth preHandler + notification read routes`

### Task 14: SSE route

**Files:**

- Create: `packages/server-fastify/src/routes/sse.ts`, `test/sse.route.test.ts`
- Reference: `backend/src/http/sse/routes.ts`.

**Interfaces:**

- Produces: `GET /sse` — moved from the reference SSE route, subscribing to `service.delivery` with `{ principal, deliver }` (was `{ userId }`). Coalescing/heartbeat/backpressure/cleanup logic moves unchanged (it imports `CoalescingBuffer` from `@notifications/core` or keeps a local copy — prefer importing from core).

- [ ] **Step 1: Write the failing test** `test/sse.route.test.ts` — inject `GET /sse` with a fake principal, then `service.ingest` a matching global notification and assert the response stream receives an `event: notifications` frame containing it; ingest a non-matching team notification and assert it does NOT arrive. (Use a manual `inject` with a payload stream reader, or subscribe to `service.delivery` directly if a full SSE stream read is impractical in the harness — assert at the hub boundary.)

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement `routes/sse.ts`.**
- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server-fastify): SSE route subscribing by principal`

### Task 15: Intake route (`POST /internal/publish`) with injected intakeAuth

**Files:**

- Create: `packages/server-fastify/src/routes/intake.ts`, `test/intake.route.test.ts`
- Reference: `backend/src/intake/http-intake.ts`.

**Interfaces:**

- Produces: `POST /internal/publish` — gate on `opts.intakeAuth(req)` (401/403 when false), then `service.ingest(req.body)` and map `IngestResult.status` to the same HTTP shape the current `http-intake.ts` returns.

- [ ] **Step 1: Write the failing test** `test/intake.route.test.ts` — with `intakeAuth: (req) => req.headers["x-internal-token"] === "secret"`: a request without the token → rejected; with it, a valid `dsr` payload → accepted and appears in `service.list` for a matching principal; a malformed payload → the invalid status shape (still 2xx/4xx exactly as today — match `http-intake.ts`).

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement `routes/intake.ts`** matching `http-intake.ts`'s response contract.
- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server-fastify): intake route with injected intakeAuth`

### Task 16: Admin routes + `/settings/features`

**Files:**

- Create: `packages/server-fastify/src/routes/admin.ts`, `test/admin.route.test.ts`
- Reference: `backend/src/http/admin/routes.ts`.

**Interfaces:**

- Produces: `GET /admin/modules` (→ `service.listModules()`), `PATCH /admin/modules/:key` (404 if the id isn't in `listModules`; else `service.setModuleEnabled`), `GET /admin/settings` (→ `service.getSettings()`), `PATCH /admin/settings` (zod-validated patch → `service.updateSettings`), `GET /settings/features` (→ subset of `getSettings()` the frontend reads). Admin routes gate on `req.principal.roles.includes(service.adminRole)` (403 otherwise), reusing `requirePrincipal` for auth. Reuse the zod schemas from `admin/routes.ts:7-19`.

- [ ] **Step 1: Write the failing test** `test/admin.route.test.ts` — a principal WITHOUT the admin role → 403 on `GET /admin/modules`; WITH it → 200 listing the catalog module(s); `PATCH /admin/modules/:key {enabled:false}` → 204 and a subsequent `service.resolveModule`/`listModules` shows disabled; `PATCH /admin/settings {aiSummaryEnabled:false}` → 204 and `GET /settings/features` reflects it. Restore settings in `afterAll`.

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement `routes/admin.ts`.**
- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Full plugin gate + commit**

Run: `pnpm --filter @notifications/server-fastify test && pnpm --filter @notifications/server-fastify typecheck && pnpm --filter @notifications/server-fastify build`
Expected: green. Commit — `feat(server-fastify): admin + settings routes gated by adminRole`

---

## Unit H — Reference-app rewiring

### Task 17: Transform migrations (re-key read-state; drop modules.label)

**Files:**

- Create: `backend/migrations/011_notification_reads_userkey.sql`, `backend/migrations/012_modules_drop_label.sql`

**Interfaces:**

- Produces: forward migrations converging the reference DB to the library's target schema.

- [ ] **Step 1: Write `011_notification_reads_userkey.sql`** — add `user_key text`; backfill `UPDATE notification_reads r SET user_key = u.username FROM users u WHERE u.id = r.user_id;`; make `user_key NOT NULL`; drop the old PK and the `user_id` FK/column; add PK `(user_key, notification_id)`. (This migration is the reason the reference app — which owns `users` — does the backfill; the library's fresh schema never has `user_id`.)

- [ ] **Step 2: Write `012_modules_drop_label.sql`** — `ALTER TABLE modules DROP COLUMN label;` (catalog `label` is now host config).

- [ ] **Step 3: Apply + verify**

Run: `docker compose up -d && pnpm --filter @notifications/backend migrate`
Expected: `applied migration: 011...`, `012...`; a spot-check query shows `notification_reads.user_key` populated and no `user_id`. (Confirm with the `db-reader` subagent.)

- [ ] **Step 4: Commit** — `feat(backend): migrate notification_reads to user_key; drop modules.label`

### Task 18: Rewire `backend/` onto the packages

**Files:**

- Create: `backend/src/reference/principal-adapter.ts`
- Modify: `backend/src/server.ts`, `backend/package.json`, `backend/src/http/admin/maintenance.ts` + `simulate.ts` (repoint any pipeline imports), `backend/src/scripts/*`, `backend/src/sim/*`
- Delete: `backend/src/pipeline/*`, `backend/src/delivery/*`, `backend/src/audience/*`, `backend/src/http/notifications/routes.ts`, `backend/src/http/sse/*`, `backend/src/http/admin/routes.ts`, `backend/src/intake/http-intake.ts` + `boundary.ts` (moved/replaced)

**Interfaces:**

- Consumes: `@notifications/core` (`createNotificationService`), `@notifications/server-fastify` (`notificationFastifyPlugin`).
- Produces:
  - `toPrincipal(user: SessionUser): Principal` in `principal-adapter.ts` (`{ userKey: user.username, roles: user.roles, teamKeys: user.teamIds }`).
  - A rewritten `server.ts` that: builds `const service = createNotificationService({ pool: getPool(), config: { modules: REFERENCE_CATALOG, adminRole: "admin" } })`; `await service.ready()`; registers session + auth routes as today; registers `notificationFastifyPlugin` with `{ service, auth: async (req) => { const u = await getSessionUser(req); return u ? toPrincipal(u) : null }, intakeAuth: (req) => req.headers["x-internal-token"] === getEnv().INTERNAL_INTAKE_TOKEN }`; keeps `maintenanceRoutes`/`simulateRoutes` behind `isSimulatorEnabled()` (repointed to `service.ingest` / the DB pool as needed); keeps `/health`.
  - `REFERENCE_CATALOG: ModuleCatalogEntry[]` — the current seeded module set (ids + labels) declared as reference-app config (source it from the existing seed/migration 007 module list).
  - `backend/package.json` gains `@notifications/core` + `@notifications/server-fastify` as `workspace:*` deps; drops now-unused deps only if nothing else uses them.

- [ ] **Step 1: Implement `principal-adapter.ts` + a unit test** (`toPrincipal` maps the three fields).
- [ ] **Step 2: Rewrite `server.ts`** as above; delete the moved source files; repoint `maintenance.ts`/`simulate.ts`/`sim/*`/`scripts/*` imports to the service or the retained pool.
- [ ] **Step 3: Run the reference app's own gate**

Run: `pnpm --filter @notifications/backend typecheck && pnpm --filter @notifications/backend test`
Expected: green (some backend tests move to core in Task 19; a red here that's "test file references a deleted module" is resolved there — sequence Task 19 alongside this one and gate them together).

- [ ] **Step 4: Boot + smoke test**

Run: `pnpm dev` (backend+frontend) → log in as `admin` → open the bell → `pnpm --filter @notifications/backend sim:publish:http 5` → cards appear live; disable a module in `/admin` → its publishes are suppressed. (Use the `browser-tester` subagent.)

- [ ] **Step 5: Commit** — `refactor(backend): consume core + server-fastify as the reference app`

### Task 19: Relocate the moved tests

**Files:**

- Move/adapt: the behavior in `backend/test/{notifications,sse,audience,admin,policy}.test.ts` that now tests core logic → `packages/core/test/*` (driven against the service or the units, no HTTP); keep the route-level assertions in `packages/server-fastify/test/*`; keep auth/session tests in `backend/test/*`.

- [ ] **Step 1: Inventory** `backend/test/*` and classify each test: domain (→ core), route/plugin (→ server-fastify, largely covered by Tasks 13–16), or identity/session (stays). List the mapping.
- [ ] **Step 2: Port the domain tests** not already re-created in Units B–F (notably the keyset paging / cross-sort-cursor-400 cases from `notifications.test.ts`) into `packages/core/test/`, driven against `svc.list`.
- [ ] **Step 3: Delete the obsolete `backend/test` files** whose behavior now lives in the packages; keep `auth`/`session` tests.
- [ ] **Step 4: Full monorepo gate**

Run: `pnpm -r test && pnpm typecheck && pnpm lint`
Expected: green across `@notifications/{shared,core,server-fastify,backend,frontend}`.

- [ ] **Step 5: Commit** — `test: relocate domain tests to core; route tests to server-fastify`

---

## Unit I — Honesty tests + docs

### Task 20: Foreign-host scoping test

**Files:**

- Create: `packages/server-fastify/test/foreign-host.test.ts`

**Interfaces:**

- Consumes: the plugin + a real service.

- [ ] **Step 1: Write the test** — register the plugin with an `auth` adapter driven by a **non-session, arbitrary** identity model (e.g. reads `x-fake-userkey`/`x-fake-roles`/`x-fake-teams` headers) and NO users table involved. Seed global/team/role/user notifications via `service.ingest`. Assert, via `app.inject`, that four different fabricated principals each get exactly their audience across `GET /notifications`, `GET /notifications/counts`, `POST /:id/read` (404 for out-of-audience), and that a `GET /sse` subscriber receives only matching live publishes. This proves identity is injected, not owned.

- [ ] **Step 2: Run it** — Run: `pnpm --filter @notifications/server-fastify test foreign-host` — Expected: PASS.
- [ ] **Step 3: Commit** — `test(server-fastify): foreign-host injected-identity scoping proof`

### Task 21: Schema-parity test

**Files:**

- Create: `packages/core/test/schema-parity.test.ts` (or a root `scripts/schema-parity.ts` invoked by a test)

**Interfaces:**

- Produces: a test that builds two scratch DBs — one via `@notifications/core`'s `migrate(pool)`, one by applying the reference app's full `backend/migrations` history — and asserts the shared library-owned tables (`notifications`, `notification_reads`, `modules`, `global_settings`) have matching column sets, types, PKs, and the feed/counts indexes. Guards drift between the fresh-install schema and the transform-migration path.

- [ ] **Step 1: Write the test** — introspect `information_schema.columns` + `pg_indexes` for the four tables in each DB and diff. Drop both scratch DBs in `afterAll`.
- [ ] **Step 2: Run it** — Expected: PASS (fix any real drift in the Task 8 fresh set or the Task 17 transforms until it does).
- [ ] **Step 3: Commit** — `test: schema parity between library migrate() and reference migration history`

### Task 22: Core-has-no-identity-table boundary test

**Files:**

- Create: `packages/core/test/boundary.test.ts`

- [ ] **Step 1: Write the test** — read every `.ts` under `packages/core/src` and assert none contains the identifiers `user_teams`, `user_roles`, `FROM users`, `JOIN users`, `process.env`, or `secure-session`. (A regex scan; fail with the offending file:line.)
- [ ] **Step 2: Run it** — Expected: PASS.
- [ ] **Step 3: Commit** — `test(core): boundary test — core references no identity table or env`

### Task 23: Docs

**Files:**

- Update via **docs-writer**: `docs/api/notifications.md`, `docs/api/sse.md`, `docs/api/admin.md` (routes now served by the plugin — request/response shapes unchanged, but note the auth/intakeAuth adapter contract and the `user_key` read-state keying).
- Create via **docs-writer**: `packages/core/README.md` (`createNotificationService`/`migrate` usage), `packages/server-fastify/README.md` (`notificationFastifyPlugin` options + a wiring example), and a short `docs/architecture/be-library-integration.md` (how the reference app wires the packages — the canonical example).

- [ ] **Step 1: Dispatch docs-writer** with the final public API (from `packages/core/src/index.ts` + the plugin options) to write/update the above. Do not hand-write these in the main session.
- [ ] **Step 2: Verify** the API docs match the shipped routes/handlers; commit — `docs: BE library API + integration docs`

---

## Verification (whole-branch, before finishing)

1. `docker compose up -d`; `pnpm --filter @notifications/backend migrate` (applies 011/012).
2. `pnpm -r test` (shared/core/server-fastify/backend/frontend units) — green, including the three honesty tests + schema parity.
3. `pnpm typecheck && pnpm lint && pnpm -r build` — clean; `packages/core` and `packages/server-fastify` emit `dist/`.
4. `pnpm dev` → log in as `admin` → live SSE feed works, sorting/filters/counts work, `/admin` module toggle suppresses, feature-flag toggle reflects in the UI. (`browser-tester`.)
5. `pnpm test:e2e` — the existing Playlist suite passes against the reassembled reference app (single clean run; the dev-server login rate limit means don't re-run within a minute).
6. Reviews: `code-reviewer` (whole branch), then `security-reviewer` (identity re-key + the injected auth/intakeAuth boundary + the migration backfill). Then `/code-review` → `/open-pr`.

## Out of scope (deliberate)

Vue component library (task 1); the AI features (tasks 2/4 — only the `ai` config slot is reserved, not built); Redis-distributed multi-instance delivery (in-process hub stays; documented seam); non-Fastify adapter; registry publishing (packages stay private, publishable-shaped); configurable table prefix; per-tenant physical partitioning.

## Self-Review

- **Spec coverage:** package layout → Tasks 1,12,18; core service API → Tasks 2–11; identity decouple (read-state re-key → 8,9,10,17; retire resolveRecipients → 3,4,6; no env in core → 2,22); injected config + LLM seam → Task 2 (`NotificationServiceConfig`; `ai` slot reserved, noted out-of-scope); Fastify adapter/auth/admin gating → Tasks 12–16; module catalog=host config + library state → Task 7; settings library-owned → Tasks 7,16; DB/migration ownership → Tasks 8,17,21; maintenance/simulate stay reference-app → Task 18; testing strategy (core/plugin/reference split + 3 honesty tests) → Tasks 19,20,21,22; docs → Task 23; mentor gate → Global Constraints. No gaps found.
- **Placeholder scan:** the two spots that read as prose-only (Task 6 Step 1, Task 14 Step 1) name the exact assertions and tools to use; all code steps carry real code or exact move/SQL instructions.
- **Type consistency:** `Principal`/`QueryFn`/`NotificationService`/`ModulePolicyView`/`Settings`/`NotificationServiceConfig`/`NotificationPluginOptions` are defined once (Tasks 2, 7, 11, 12) and referenced consistently; `matchAudience`/`audienceWhere`/`persist(query,…)`/`ingest(deps,…)`/`list(query,…)` signatures are stable across the tasks that consume them.
- **Ordering note:** Task 6 (ingest) consumes Task 7 (policy store); build Task 7 before Task 6 if implementing strictly in order (flagged in Task 6 Interfaces). Tasks 18 and 19 gate together (deleting moved source breaks moved tests until they relocate).
