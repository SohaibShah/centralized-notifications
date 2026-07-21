# Server-side Feed Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user sort the feed (Newest / Oldest / Priority high→low / Priority low→high), with the ordering and keyset pagination owned by the server.

**Architecture:** `GET /notifications` gains a `sort` param that drives `ORDER BY` and a sort-aware opaque keyset cursor. A generated `priority_rank` column + partial index keeps the priority sort keyset-fast. The feed store carries a `sort` ref, refetches page 1 on change (soft reset, SSE preserved), and the client stops re-sorting Needs action by priority so both groups preserve server order.

**Tech Stack:** TypeScript (strict), Fastify, PostgreSQL, zod, Vue 3, Pinia, Vitest.

## Global Constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before any task is "done".
- New logic carries a Vitest test in the same task (`testing.md`).
- Parameterized SQL only; keyset pagination — no OFFSET, no total count (NFR-2).
- No AI-attribution commit trailers. Conventional Commits.
- Sort values (verbatim): `newest` (default), `oldest`, `priority-high`, `priority-low`.
- `priority_rank`: critical=0, high=1, normal=2, low=3.
- Priority sorts tie-break newest-first within a level.
- Backend tests need Postgres up (`docker compose up -d`); `migrate()` runs in `beforeAll`.
- Single-file runs: `pnpm --filter @notifications/backend exec vitest run <path>` /
  `pnpm --filter @notifications/frontend exec vitest run <path>`.
- Branch `feat/feed-sorting` (created; spec committed).

---

### Task 1: Shared `FeedSort` contract

**Files:**

- Modify: `packages/shared/src/notification.ts`
- Test: `packages/shared/test/notification.test.ts`

**Interfaces:**

- Produces: `FEED_SORTS = ["newest","oldest","priority-high","priority-low"] as const`, `type FeedSort`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/test/notification.test.ts`:

```ts
import { FEED_SORTS } from "../src/notification";

describe("feed sorts", () => {
  it("exposes the four sort values with newest first", () => {
    expect(FEED_SORTS).toEqual(["newest", "oldest", "priority-high", "priority-low"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/shared test`
Expected: FAIL (`FEED_SORTS` is not exported).

- [ ] **Step 3: Add the contract**

In `packages/shared/src/notification.ts`, near the other `as const` unions (after `ACTION_KINDS`):

```ts
export const FEED_SORTS = ["newest", "oldest", "priority-high", "priority-low"] as const;
```

and near the other type exports:

```ts
export type FeedSort = (typeof FEED_SORTS)[number];
```

- [ ] **Step 4: Run test + typecheck + rebuild shared**

Run: `pnpm --filter @notifications/shared test && pnpm --filter @notifications/shared typecheck && pnpm --filter @notifications/shared build`
Expected: PASS, clean (build so backend/frontend see the new export).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/notification.ts packages/shared/test/notification.test.ts
git commit -m "feat(shared): add FeedSort contract (newest|oldest|priority-high|priority-low)"
```

---

### Task 2: Migration — generated `priority_rank` + index

**Files:**

- Create: `backend/migrations/008_priority_rank.sql`
- Create: `backend/test/priority-rank.test.ts`

**Interfaces:**

- Produces: `notifications.priority_rank smallint` (generated), and index `notifications_priority_keyset_idx`.

- [ ] **Step 1: Write the failing test**

`backend/test/priority-rank.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";

const P = "prank-";
describe("priority_rank generated column", () => {
  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${P}%`]);
    for (const [i, prio] of ["critical", "high", "normal", "low"].entries()) {
      await query(
        `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope)
         VALUES ($1,'test','t','',$2,true,'global')`,
        [`${P}${i}`, prio],
      );
    }
  });
  afterAll(async () => {
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${P}%`]);
    await closePool();
  });

  it("ranks critical<high<normal<low as 0..3", async () => {
    const { rows } = await query<{ priority: string; priority_rank: number }>(
      "SELECT priority, priority_rank FROM notifications WHERE id LIKE $1 ORDER BY priority_rank",
      [`${P}%`],
    );
    expect(rows.map((r) => [r.priority, r.priority_rank])).toEqual([
      ["critical", 0],
      ["high", 1],
      ["normal", 2],
      ["low", 3],
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/priority-rank.test.ts`
Expected: FAIL (column `priority_rank` does not exist).

- [ ] **Step 3: Write the migration**

`backend/migrations/008_priority_rank.sql`:

```sql
-- Server-side priority sorting. A generated rank column keeps the sort keyset-fast and lets the
-- ORDER BY / cursor WHERE reference one column instead of repeating a CASE. STORED so it's
-- indexable; immutable CASE over the same row's `priority`.
ALTER TABLE notifications
  ADD COLUMN priority_rank smallint
  GENERATED ALWAYS AS (
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high'     THEN 1
      WHEN 'normal'   THEN 2
      WHEN 'low'      THEN 3
    END
  ) STORED;

CREATE INDEX notifications_priority_keyset_idx
  ON notifications (priority_rank, created_at DESC, id DESC)
  WHERE suppressed = false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @notifications/backend exec vitest run test/priority-rank.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/008_priority_rank.sql backend/test/priority-rank.test.ts
git commit -m "feat(db): generated priority_rank column + keyset index for priority sorting"
```

---

### Task 3: Backend read path — `sort` param, ORDER BY, sort-aware cursor

**Files:**

- Modify: `backend/src/http/notifications/routes.ts`
- Test: `backend/test/notifications.test.ts`

**Interfaces:**

- Consumes: `FEED_SORTS`, `FeedSort` (Task 1); `priority_rank` (Task 2).
- Produces: `GET /notifications?sort=` returns rows in the requested order with a sort-scoped cursor.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` to `backend/test/notifications.test.ts` (it already imports `query`, `migrate`, `buildServer`, has `tsAt`, and a `sessionCookie`/`app` in the outer describe — reuse them by placing this block inside the existing `describe("GET /notifications", …)` after the seeded rows, or add a sibling describe that logs in the same way). Use a dedicated id prefix and assert order among _our_ ids only (the shared DB holds other rows):

```ts
const SP = "test-sort-";
async function seedSortSet() {
  await query("DELETE FROM notifications WHERE id LIKE $1", [`${SP}%`]);
  // (id, priority, created_at) — times ascending c<h<n<l by minute for deterministic ties
  const rows: [string, string, number][] = [
    [`${SP}crit-old`, "critical", 1],
    [`${SP}crit-new`, "critical", 4],
    [`${SP}high`, "high", 2],
    [`${SP}low`, "low", 3],
  ];
  for (const [id, prio, m] of rows) {
    await query(
      `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope, created_at)
         VALUES ($1,'test','t','',$2,true,'global',$3)`,
      [id, prio, tsAt(m)],
    );
  }
}
function mine(body: NotificationPage): string[] {
  return body.items.filter((n) => n.id.startsWith(SP)).map((n) => n.id);
}

it("sorts newest and oldest by time", async () => {
  await seedSortSet();
  const newest = mine((await list("?limit=100&sort=newest")).body);
  expect(newest).toEqual([`${SP}crit-new`, `${SP}low`, `${SP}high`, `${SP}crit-old`]);
  const oldest = mine((await list("?limit=100&sort=oldest")).body);
  expect(oldest).toEqual([...newest].reverse());
});

it("sorts by priority in both directions, newest within a level", async () => {
  await seedSortSet();
  const high = mine((await list("?limit=100&sort=priority-high")).body);
  expect(high).toEqual([`${SP}crit-new`, `${SP}crit-old`, `${SP}high`, `${SP}low`]);
  const low = mine((await list("?limit=100&sort=priority-low")).body);
  expect(low).toEqual([`${SP}low`, `${SP}high`, `${SP}crit-new`, `${SP}crit-old`]);
});

it("keyset-paginates priority-high with no overlap or skip", async () => {
  await seedSortSet();
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const qs = `?limit=2&sort=priority-high${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const { body } = await list(qs);
    seen.push(...body.items.filter((n) => n.id.startsWith(SP)).map((n) => n.id));
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  expect(seen).toEqual([`${SP}crit-new`, `${SP}crit-old`, `${SP}high`, `${SP}low`]);
  expect(new Set(seen).size).toBe(seen.length); // no dupes
});

it("rejects a cursor replayed under a different sort (400)", async () => {
  await seedSortSet();
  const first = (await list("?limit=1&sort=newest")).body;
  expect(first.nextCursor).toBeTruthy();
  const res = await list(`?limit=1&sort=oldest&cursor=${encodeURIComponent(first.nextCursor!)}`);
  expect(res.statusCode).toBe(400);
});
```

(Clean up `SP` rows in the outer `afterAll`: add `await query("DELETE FROM notifications WHERE id LIKE $1", [`${SP}%`]);`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/notifications.test.ts`
Expected: the new tests FAIL (`sort` ignored; cursor not sort-scoped).

- [ ] **Step 3: Implement — import + schema + cursor type**

In `backend/src/http/notifications/routes.ts`:

- Add to the shared import: `import { actionSchema, FEED_SORTS, type FeedSort } from "@notifications/shared";` (keep the existing type import line; add `FEED_SORTS`/`FeedSort`).
- Extend `listQuerySchema`:

```ts
const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: z.enum(FEED_SORTS).default("newest"),
});
```

- Replace the `Cursor` interface + `cursorSchema`:

```ts
interface Cursor {
  s: FeedSort;
  ts: string; // ISO created_at
  id: string;
  rank?: number; // priority_rank, only for the priority sorts
}

const cursorSchema = z.object({
  s: z.enum(FEED_SORTS),
  ts: z.string().datetime({ offset: true }),
  id: z.string().min(1),
  rank: z.number().int().min(0).max(3).optional(),
});
```

- [ ] **Step 4: Implement — FeedRow, SELECT, per-sort ORDER BY + keyset WHERE**

- Add `priority_rank: number;` to the `FeedRow` interface.
- In the handler, read `sort` and guard the cursor's sort:

```ts
const { cursor: rawCursor, limit, sort } = parsed.data;

let cursor: Cursor | null = null;
if (rawCursor !== undefined) {
  cursor = decodeCursor(rawCursor);
  if (!cursor || cursor.s !== sort) return reply.code(400).send({ error: "invalid cursor" });
}
```

- Build the order + keyset predicate per sort (replaces the current fixed `where`/ORDER BY):

```ts
const params: unknown[] = [user.id];
let where = "WHERE n.suppressed = false";
let orderBy: string;

if (sort === "newest" || sort === "oldest") {
  const [dir, cmp] = sort === "newest" ? ["DESC", "<"] : ["ASC", ">"];
  orderBy = `n.created_at ${dir}, n.id ${dir}`;
  if (cursor) {
    params.push(cursor.ts, cursor.id);
    where += ` AND (n.created_at, n.id) ${cmp} ($${params.length - 1}::timestamptz, $${params.length}::text)`;
  }
} else {
  // priority-high: rank ASC (critical first); priority-low: rank DESC. Newest-first within a level.
  const rankDir = sort === "priority-high" ? "ASC" : "DESC";
  const rankCmp = sort === "priority-high" ? ">" : "<";
  orderBy = `n.priority_rank ${rankDir}, n.created_at DESC, n.id DESC`;
  if (cursor) {
    params.push(cursor.rank, cursor.ts, cursor.id);
    const r = params.length - 2,
      t = params.length - 1,
      i = params.length;
    where +=
      ` AND (n.priority_rank ${rankCmp} $${r}::smallint` +
      ` OR (n.priority_rank = $${r}::smallint AND (n.created_at, n.id) < ($${t}::timestamptz, $${i}::text)))`;
  }
}

params.push(limit + 1);
const limitPlaceholder = `$${params.length}`;
```

- Add `n.priority_rank` to the SELECT column list; keep everything else the same, and use `ORDER BY ${orderBy}` and `LIMIT ${limitPlaceholder}`.
- Build `nextCursor` per sort from the last page row:

```ts
function cursorFor(s: FeedSort, row: FeedRow): Cursor {
  const base: Cursor = { s, ts: row.created_iso, id: row.id };
  return s === "priority-high" || s === "priority-low" ? { ...base, rank: row.priority_rank } : base;
}
// …
nextCursor: hasMore && last ? encodeCursor(cursorFor(sort, last)) : null,
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @notifications/backend exec vitest run test/notifications.test.ts && pnpm --filter @notifications/backend typecheck`
Expected: PASS (including the pre-existing newest/pagination tests), clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/notifications/routes.ts backend/test/notifications.test.ts
git commit -m "feat(feed): server-side sort (newest/oldest/priority) with a sort-scoped keyset cursor"
```

---

### Task 4: Feed store — `sort` state, `setSort`, drop client priority re-sort

**Files:**

- Modify: `frontend/src/stores/feed.ts`
- Test: `frontend/src/stores/feed.spec.ts`

**Interfaces:**

- Consumes: `FeedSort` (Task 1); `GET /notifications?sort=` (Task 3).
- Produces: `feed.sort` (Ref<FeedSort>), `feed.setSort(next)`; `groups` preserve load order.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/stores/feed.spec.ts`:

- Update the existing grouping test (currently "groups into Needs action (unread, urgency-sorted)…", asserting `["c1","n1"]`) to assert **load order** is preserved (no client priority re-sort):

```ts
it("groups into Needs action and Earlier, preserving load order (no client re-sort)", async () => {
  const feed = useFeedStore();
  feed.items = [
    feedItem({ id: "n1", priority: "normal", createdAt: "2026-07-01T00:00:00.000000Z" }),
    feedItem({ id: "c1", priority: "critical", createdAt: "2026-07-01T00:00:01.000000Z" }),
    feedItem({ id: "r1", read: true }),
  ];
  const groups = feed.groups;
  expect(groups.map((g) => g.key)).toEqual(["needs-action", "earlier"]);
  expect(groups[0]?.items.map((n) => n.id)).toEqual(["n1", "c1"]); // load order, not priority
  expect(groups[1]?.items.map((n) => n.id)).toEqual(["r1"]);
});
```

- Add a `setSort` test:

```ts
it("setSort clears the loaded window and refetches page 1 with the new sort", async () => {
  getMock.mockResolvedValue(page([feedItem({ id: "a" })], null));
  const feed = useFeedStore();
  await feed.load();
  expect(feed.sort).toBe("newest");
  getMock.mockClear();
  getMock.mockResolvedValueOnce(page([feedItem({ id: "z" })], null));
  await feed.setSort("oldest");
  expect(feed.sort).toBe("oldest");
  expect(getMock).toHaveBeenCalledTimes(1);
  expect(getMock.mock.calls[0][0]).toContain("sort=oldest");
  expect(feed.items.map((n) => n.id)).toEqual(["z"]); // window replaced, not appended
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/stores/feed.spec.ts`
Expected: the grouping test fails on `["c1","n1"]` vs `["n1","c1"]`; the setSort test fails (`setSort` undefined).

- [ ] **Step 3: Implement**

In `frontend/src/stores/feed.ts`:

- Import the type: add `FeedSort` to the `@notifications/shared` type import.
- Add state near the filters: `const sort = ref<FeedSort>("newest");`
- Thread `&sort=` into both requests:
  - `load()`: `` `/notifications?limit=${PAGE_SIZE}&sort=${sort.value}` ``
  - `loadMore()`: `` `/notifications?limit=${PAGE_SIZE}&sort=${sort.value}&cursor=${cursor}` ``
- Add `setSort` (place after `loadMore`):

```ts
/** Change the feed sort: soft-reset the loaded window (keep the SSE connection) and refetch
 *  page 1 in the new order. The keyset cursor is sort-scoped, so the old window is discarded. */
async function setSort(next: FeedSort): Promise<void> {
  if (next === sort.value) return;
  sort.value = next;
  seen.clear();
  items.value = [];
  nextCursor.value = null;
  await load(); // load() flushes session reads and refetches newest page in the new order
}
```

- In the `groups` computed, **remove** the `needsAction.sort(...)` call (the priority+recency re-sort) so Needs action preserves `visibleItems` order. Keep the partition loop and the sticky-read logic. (Earlier already preserves order.)
- Export `sort` and `setSort` in the store's return object.
- `reset()` should also reset sort to default: add `sort.value = "newest";` (so a re-login starts at the default order). `priorityRank` import may now be unused — remove it if so.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @notifications/frontend exec vitest run src/stores/feed.spec.ts && pnpm --filter @notifications/frontend typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/feed.ts frontend/src/stores/feed.spec.ts
git commit -m "feat(feed): store-level sort with soft-reset refetch; groups preserve server order"
```

---

### Task 5: Sort control in the panel

**Files:**

- Modify: `frontend/src/features/notifications/panel/InboxTab.vue`
- Test: `frontend/src/features/notifications/panel/InboxTab.spec.ts`

**Interfaces:**

- Consumes: `feed.sort`, `feed.setSort` (Task 4).
- Produces: a `data-test="feed-sort"` `<select>` in the chips row.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/features/notifications/panel/InboxTab.spec.ts`:

```ts
it("renders a sort select that calls setSort on change", async () => {
  const feed = useFeedStore();
  feed.status = "ready";
  const spy = vi.spyOn(feed, "setSort").mockResolvedValue();
  const wrapper = mount(InboxTab);
  const select = wrapper.get('[data-test="feed-sort"]');
  await select.setValue("priority-high");
  expect(spy).toHaveBeenCalledWith("priority-high");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/panel/InboxTab.spec.ts`
Expected: FAIL (no `[data-test="feed-sort"]`).

- [ ] **Step 3: Implement**

In `InboxTab.vue`, inside the chips row `<div class="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">`, add a right-aligned select after the last `<Chip>`:

```html
<select
  data-test="feed-sort"
  class="ml-auto rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] text-text"
  aria-label="Sort notifications"
  :value="feed.sort"
  @change="feed.setSort(($event.target as HTMLSelectElement).value as FeedSort)"
>
  <option value="newest">Newest</option>
  <option value="oldest">Oldest</option>
  <option value="priority-high">Priority: high → low</option>
  <option value="priority-low">Priority: low → high</option>
</select>
```

Add `import type { FeedSort } from "@notifications/shared";` to the script.

- [ ] **Step 4: Run test + typecheck + lint + full frontend suite**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/panel/InboxTab.spec.ts && pnpm --filter @notifications/frontend typecheck && pnpm lint && pnpm --filter @notifications/frontend test`
Expected: PASS, clean.

- [ ] **Step 5: Browser check**

`/verify` or `browser-tester`: the sort select renders in the chips row; switching to "Priority: high → low" reorders the feed (criticals first) and switching to "Oldest" reverses it. Confirm the change refetches (network) rather than only reordering the loaded window.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/notifications/panel/InboxTab.vue frontend/src/features/notifications/panel/InboxTab.spec.ts
git commit -m "feat(feed): sort select in the notifications panel"
```

---

### Task 6: API docs

**Files:**

- Modify: `docs/api/notifications.md`

- [ ] **Step 1: Dispatch docs-writer**

Per `api-documentation.md`, delegate to the **docs-writer** subagent. Brief it: `GET /notifications`
gains an optional `sort` query param — `newest` (default), `oldest`, `priority-high`
(critical→low, newest within a level), `priority-low` (low→critical). The opaque cursor is now
**sort-scoped**: a cursor issued under one sort, replayed under another, returns `400 invalid
cursor` (clients refetch page 1 when changing sort). Ordering + pagination are server-side (keyset,
no OFFSET). Update the existing notifications doc; don't create a new file.

- [ ] **Step 2: Commit**

```bash
git add docs/api/notifications.md
git commit -m "docs(api): document the feed sort param and sort-scoped cursor"
```

---

## Final verification

1. Postgres up; `pnpm --filter @notifications/backend test`, `pnpm --filter @notifications/frontend test`, `pnpm --filter @notifications/shared test` green.
2. `pnpm lint && pnpm typecheck` clean.
3. Reviews: `code-reviewer` (cursor/keyset correctness — the priority two-part WHERE is the risk), `frontend-design-reviewer` + `browser-tester` (the sort control + reorder), `security-reviewer` (read-path SQL still parameterized; the new cursor fields validated). `docs-writer` already ran (Task 6).
4. `superpowers:finishing-a-development-branch` (mentor gate still precedes any push).

## Self-review notes (coverage check)

- Spec sort semantics → Tasks 2 (rank) + 3 (ORDER BY/WHERE). ✅
- Spec sort options / default `newest` → Task 1 (contract) + 3 (schema default) + 5 (UI). ✅
- Spec cursor (sort-scoped, rank, cross-sort 400, two-part WHERE) → Task 3. ✅
- Spec grouping decision (sort within groups; drop client priority re-sort) → Task 4. ✅
- Spec store soft-reset + `&sort=` → Task 4. ✅
- Spec UI compact select → Task 5. ✅
- Spec docs → Task 6. ✅
- Type consistency: `FEED_SORTS`/`FeedSort` defined in Task 1, consumed in 3/4/5; `priority_rank` column (Task 2) referenced in Task 3 SELECT/ORDER BY/WHERE and cursor `rank`; `setSort` defined in Task 4, consumed in Task 5.
