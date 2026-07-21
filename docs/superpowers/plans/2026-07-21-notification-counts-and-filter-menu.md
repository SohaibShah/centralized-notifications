# Notification counts + filter-menu changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move sort into the filter dropdown, stop the dropdown being clipped by the panel, and source the unread/priority counts from the server so they're accurate over the whole dataset (not just the loaded window).

**Architecture:** A new `GET /notifications/counts` aggregate feeds a `counts` snapshot in the feed store, kept fresh by `fetchCounts()` (on load + panel open), exact optimistic deltas (read/unread actions), and SSE increments. The filter dropdown gains a "Sort by" radio section and is teleported to `<body>` to escape the popover's `overflow-hidden`.

**Tech Stack:** TypeScript (strict), Fastify, PostgreSQL, zod, Vue 3, Pinia, Vitest.

## Global Constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before any task is "done".
- New logic carries a Vitest test in the same task (`testing.md`).
- Parameterized SQL only; `requireUser` on the new endpoint; per-user reads via the `notification_reads` LEFT JOIN.
- Count semantics: **absolute** — total UNREAD of each priority across the whole dataset, ignoring active filters. `unread` = sum of the four priority counts.
- Counts never go negative (clamp at 0). Trimming the loaded window never adjusts counts.
- No AI-attribution commit trailers. Conventional Commits.
- Additive API change → branch stays local (mentor gate; no push/PR).
- Backend tests need Postgres up (`docker compose up -d`); `migrate()` runs in `beforeAll`.
- Single-file runs: `pnpm --filter @notifications/backend exec vitest run <path>` /
  `pnpm --filter @notifications/frontend exec vitest run <path>`.
- Branch `feat/notification-counts` (created off `main`, which includes the feed-sorting work).

---

### Task 1: Teleport the filter dropdown (fix clipping)

**Files:**

- Modify: `frontend/src/features/notifications/components/FilterMenu.vue`
- Test: `frontend/src/features/notifications/components/FilterMenu.spec.ts` (create)

**Interfaces:**

- Produces: the FilterMenu dropdown renders under `<body>` (teleported), `position: fixed`, anchored to the trigger; unchanged store API.

- [ ] **Step 1: Write the failing test**

Create `FilterMenu.spec.ts`. Use the `teleport` stub so the teleported panel renders in place and is findable:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import FilterMenu from "./FilterMenu.vue";

function mountMenu() {
  return mount(FilterMenu, { global: { stubs: { teleport: true } } });
}

describe("FilterMenu", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("teleports the dropdown to the document body when open", () => {
    const wrapper = mountMenu();
    expect(wrapper.find('[aria-label="Filter notifications"]').exists()).toBe(false); // closed
    wrapper.get('button[aria-haspopup="true"]').trigger("click");
    return wrapper.vm.$nextTick().then(() => {
      const panel = wrapper.find('[aria-label="Filter notifications"]');
      expect(panel.exists()).toBe(true);
      // Teleported: fixed-positioned, not absolute-in-panel.
      expect(panel.attributes("style") ?? "").toContain("position: fixed");
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/components/FilterMenu.spec.ts`
Expected: FAIL (dropdown is `absolute`, no `position: fixed`).

- [ ] **Step 3: Implement the teleport + fixed positioning**

In `FilterMenu.vue` script, add refs + a positioner and extend the open watcher / cleanup:

```ts
const triggerBtn = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

function positionMenu() {
  const el = triggerBtn.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  menuStyle.value = {
    position: "fixed",
    top: `${r.bottom + 6}px`,
    right: `${window.innerWidth - r.right}px`,
  };
}
```

Replace `onDocumentPointer` so a click inside the teleported panel counts as "inside":

```ts
function onDocumentPointer(event: MouseEvent) {
  const t = event.target as Node;
  if (root.value?.contains(t) || menu.value?.contains(t)) return;
  close();
}
```

Replace the open watcher + unmount cleanup:

```ts
watch(open, async (isOpen) => {
  if (isOpen) {
    positionMenu();
    document.addEventListener("mousedown", onDocumentPointer);
    window.addEventListener("resize", positionMenu);
    await nextTick();
    searchInput.value?.focus();
  } else {
    document.removeEventListener("mousedown", onDocumentPointer);
    window.removeEventListener("resize", positionMenu);
    search.value = "";
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointer);
  window.removeEventListener("resize", positionMenu);
});
```

In the template: add `ref="triggerBtn"` to the trigger `<button>`. Wrap the dropdown in a Teleport, drop `absolute right-0 mt-1.5`, bind the style, add the ref, and raise the z-index above the popover's `z-40`:

```html
<Teleport to="body">
  <div
    v-if="open"
    ref="menu"
    :style="menuStyle"
    class="z-50 w-64 rounded-lg border border-line-strong bg-surface shadow-lg shadow-black/5"
    role="group"
    aria-label="Filter notifications"
    @keydown.esc="close"
  >
    <!-- (existing search input + option lists unchanged) -->
  </div>
</Teleport>
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/components/FilterMenu.spec.ts && pnpm --filter @notifications/frontend typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/notifications/components/FilterMenu.vue frontend/src/features/notifications/components/FilterMenu.spec.ts
git commit -m "fix(notifications): teleport the filter dropdown so a short panel can't clip it"
```

---

### Task 2: "Sort by" radio section in the dropdown; remove the sort select from InboxTab

**Files:**

- Modify: `frontend/src/features/notifications/components/FilterMenu.vue`
- Test: `frontend/src/features/notifications/components/FilterMenu.spec.ts`
- Modify: `frontend/src/features/notifications/panel/InboxTab.vue`
- Test: `frontend/src/features/notifications/panel/InboxTab.spec.ts`

**Interfaces:**

- Consumes: `feed.sort`, `feed.setSort`, `FeedSort` (already in shared).
- Produces: sort radios `data-test="feed-sort-<value>"` in the dropdown; the chips row no longer has a sort control.

- [ ] **Step 1: Write the failing tests**

Add to `FilterMenu.spec.ts`:

```ts
import { useFeedStore } from "@/stores/feed";
import { vi } from "vitest";

it("renders Sort-by radios that reflect feed.sort and call setSort on change", async () => {
  const feed = useFeedStore();
  const spy = vi.spyOn(feed, "setSort").mockResolvedValue();
  const wrapper = mountMenu();
  await wrapper.get('button[aria-haspopup="true"]').trigger("click");
  const newest = wrapper.get('[data-test="feed-sort-newest"]');
  expect((newest.element as HTMLInputElement).checked).toBe(true); // default
  await wrapper.get('[data-test="feed-sort-priority-high"]').setValue();
  expect(spy).toHaveBeenCalledWith("priority-high");
});
```

Replace the InboxTab sort-select test (`InboxTab.spec.ts`, the "renders a sort select…" case) with an assertion that the select is gone:

```ts
it("no longer renders a sort select in the chips row (moved to the filter menu)", () => {
  const feed = useFeedStore();
  feed.status = "ready";
  const wrapper = mount(InboxTab);
  expect(wrapper.find('[data-test="feed-sort"]').exists()).toBe(false);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/components/FilterMenu.spec.ts src/features/notifications/panel/InboxTab.spec.ts`
Expected: FilterMenu radio test FAILS (no radios); InboxTab test FAILS (select still present).

- [ ] **Step 3: Implement**

In `FilterMenu.vue`, import the type and add the section as the **first** block inside the scrollable body (`<div class="max-h-72 overflow-y-auto p-1.5">`, before the Priority `<template>`):

```ts
import type { FeedSort } from "@notifications/shared";

const sortOptions: { value: FeedSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "priority-high", label: "Priority: high → low" },
  { value: "priority-low", label: "Priority: low → high" },
];
```

```html
<p class="px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-faint">Sort by</p>
<label
  v-for="o in sortOptions"
  :key="o.value"
  class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-sunken"
>
  <input
    type="radio"
    name="feed-sort"
    class="accent-accent"
    :data-test="`feed-sort-${o.value}`"
    :value="o.value"
    :checked="feed.sort === o.value"
    @change="feed.setSort(o.value)"
  />
  {{ o.label }}
</label>
<div class="my-1 border-t border-line" aria-hidden="true" />
```

In `InboxTab.vue`: delete the `<label>Sort … <select data-test="feed-sort">…</select></label>` block; change the chips row wrapper back to `class="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3"` (drop `flex-wrap`); remove the now-unused `import type { FeedSort } ...`.

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/components/FilterMenu.spec.ts src/features/notifications/panel/InboxTab.spec.ts && pnpm --filter @notifications/frontend typecheck && pnpm lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/notifications/components/FilterMenu.vue frontend/src/features/notifications/components/FilterMenu.spec.ts frontend/src/features/notifications/panel/InboxTab.vue frontend/src/features/notifications/panel/InboxTab.spec.ts
git commit -m "feat(notifications): move feed sort into the filter dropdown as a Sort-by section"
```

---

### Task 3: Backend `GET /notifications/counts` + shared type

**Files:**

- Modify: `packages/shared/src/notification.ts`
- Modify: `backend/src/http/notifications/routes.ts`
- Test: `backend/test/notifications.test.ts`

**Interfaces:**

- Produces: `interface NotificationCounts { unread: number; unreadByPriority: Record<NotificationPriority, number> }`; `GET /notifications/counts` → `NotificationCounts`.

- [ ] **Step 1: Add the shared type**

In `packages/shared/src/notification.ts`, after the `NotificationPage` interface:

```ts
/**
 * Unread notification counts for the current user, aggregated server-side over the whole
 * dataset (not the loaded feed window). `unread` is the sum of `unreadByPriority`. Absolute
 * for now (ignores active filters); shaped to grow optional filter params later.
 */
export interface NotificationCounts {
  unread: number;
  unreadByPriority: Record<NotificationPriority, number>;
}
```

Rebuild shared so backend/frontend see it: `pnpm --filter @notifications/shared build`.

- [ ] **Step 2: Write the failing test**

Append a nested `describe` inside `describe("GET /notifications", …)` in `backend/test/notifications.test.ts` (it has `app`, `PW`, and imports `hashPassword`, `query`). Delta-based, since notifications are global (every user counts every row) — isolate on a fresh user + id prefix and assert deltas:

```ts
describe("GET /notifications/counts", () => {
  const CP = "test-counts-";
  const CU = "t_counts";
  let cookie: string;
  let cUserId: string;

  beforeAll(async () => {
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${CP}%`]);
    await query("DELETE FROM users WHERE username = $1", [CU]);
    const { rows } = await query<{ id: string }>(
      "INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'Counts', $2) RETURNING id",
      [CU, await hashPassword(PW)],
    );
    cUserId = rows[0]!.id;
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: CU, password: PW },
    });
    const sc = login.headers["set-cookie"];
    cookie = ((Array.isArray(sc) ? sc[0] : sc) ?? "").split(";")[0] ?? "";
  });

  afterAll(async () => {
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${CP}%`]);
    await query("DELETE FROM users WHERE username = $1", [CU]);
  });

  function getCounts() {
    return app
      .inject({ method: "GET", url: "/notifications/counts", headers: { cookie } })
      .then((res) => ({ statusCode: res.statusCode, body: res.json() as NotificationCounts }));
  }

  it("401s without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/notifications/counts" });
    expect(res.statusCode).toBe(401);
  });

  it("counts unread by priority (delta), excluding read and suppressed rows", async () => {
    const before = (await getCounts()).body;
    await query(
      `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope, suppressed)
       VALUES ($1,'test','t','','critical',true,'global',false),
              ($2,'test','t','','critical',true,'global',false),
              ($3,'test','t','','high',true,'global',false),
              ($4,'test','t','','critical',true,'global',true)`,
      [`${CP}c1`, `${CP}c2`, `${CP}h1`, `${CP}sup`],
    );
    const after = (await getCounts()).body;
    expect(after.unreadByPriority.critical - before.unreadByPriority.critical).toBe(2); // suppressed excluded
    expect(after.unreadByPriority.high - before.unreadByPriority.high).toBe(1);
    expect(after.unread - before.unread).toBe(3);

    await query("INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2)", [
      cUserId,
      `${CP}c1`,
    ]);
    const afterRead = (await getCounts()).body;
    expect(afterRead.unreadByPriority.critical - before.unreadByPriority.critical).toBe(1);
    expect(afterRead.unread - before.unread).toBe(2);
  });
});
```

Add `NotificationCounts` to the top-of-file type import from `@notifications/shared`.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/notifications.test.ts`
Expected: the counts tests FAIL (404 — route not registered).

- [ ] **Step 4: Implement the route**

In `backend/src/http/notifications/routes.ts`:

- Extend the shared imports: add `NOTIFICATION_PRIORITIES` (value) and `type NotificationCounts`, `type NotificationPriority`.
- Register the route (e.g. after the bulk-read route, still inside `notificationRoutes`):

```ts
app.get("/notifications/counts", { preHandler: requireUser }, async (req, reply) => {
  const user = req.user;
  if (!user) return reply.code(401).send({ error: "authentication required" });

  const { rows } = await query<{ priority: NotificationPriority; n: number }>(
    `SELECT n.priority, count(*)::int AS n
       FROM notifications n
       LEFT JOIN notification_reads r
         ON r.notification_id = n.id AND r.user_id = $1
      WHERE n.suppressed = false AND r.user_id IS NULL
      GROUP BY n.priority`,
    [user.id],
  );

  const unreadByPriority = Object.fromEntries(
    NOTIFICATION_PRIORITIES.map((p) => [p, 0]),
  ) as Record<NotificationPriority, number>;
  for (const row of rows) unreadByPriority[row.priority] = row.n;
  const unread = NOTIFICATION_PRIORITIES.reduce((sum, p) => sum + unreadByPriority[p], 0);

  const body: NotificationCounts = { unread, unreadByPriority };
  return reply.code(200).send(body);
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @notifications/backend exec vitest run test/notifications.test.ts && pnpm --filter @notifications/backend typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/notification.ts backend/src/http/notifications/routes.ts backend/test/notifications.test.ts
git commit -m "feat(notifications): GET /notifications/counts aggregate (unread by priority)"
```

---

### Task 4: Feed store — counts state, fetchCounts, optimistic deltas, SSE increment

**Files:**

- Modify: `frontend/src/stores/feed.ts`
- Test: `frontend/src/stores/feed.spec.ts`

**Interfaces:**

- Consumes: `GET /notifications/counts` (Task 3); `NotificationCounts` (Task 3).
- Produces: `feed.counts` (Ref<NotificationCounts>), `feed.fetchCounts()`; optimistic count deltas on read actions + SSE.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/stores/feed.spec.ts`:

```ts
import type { NotificationCounts } from "@notifications/shared";

const counts = (unread: number, by: Partial<Record<string, number>> = {}): NotificationCounts => ({
  unread,
  unreadByPriority: { critical: 0, high: 0, normal: 0, low: 0, ...by },
});

describe("feed counts", () => {
  it("fetchCounts populates the counts snapshot", async () => {
    getMock.mockResolvedValueOnce(counts(5, { critical: 2, high: 3 }));
    const feed = useFeedStore();
    await feed.fetchCounts();
    expect(feed.counts.unread).toBe(5);
    expect(feed.counts.unreadByPriority.critical).toBe(2);
  });

  it("markRead applies an exact optimistic delta by priority", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false, priority: "critical" })]));
    await feed.load();
    feed.counts = counts(4, { critical: 2, high: 2 });
    await feed.markRead("a");
    expect(feed.counts.unread).toBe(3);
    expect(feed.counts.unreadByPriority.critical).toBe(1);
  });

  it("markRead reverts the count delta when the POST fails", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false, priority: "high" })]));
    await feed.load();
    feed.counts = counts(2, { high: 2 });
    postMock.mockRejectedValueOnce(new Error("500"));
    await feed.markRead("a");
    expect(feed.counts.unread).toBe(2);
    expect(feed.counts.unreadByPriority.high).toBe(2);
  });

  it("markUnread increments the count by priority", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: true, priority: "high" })]));
    await feed.load();
    feed.counts = counts(1, { high: 1 });
    await feed.markUnread("a");
    expect(feed.counts.unread).toBe(2);
    expect(feed.counts.unreadByPriority.high).toBe(2);
  });

  it("an SSE batch increments counts for genuinely-new unread items only", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", priority: "critical" })], null));
    feed.connect();
    await feed.load();
    feed.counts = counts(1, { critical: 1 });
    sseState.onBatch!([
      liveNotif({ id: "x", priority: "critical" }),
      liveNotif({ id: "a", priority: "critical" }), // already loaded → not counted
    ]);
    expect(feed.counts.unread).toBe(2);
    expect(feed.counts.unreadByPriority.critical).toBe(2);
  });

  it("counts never go negative", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false, priority: "low" })]));
    await feed.load();
    feed.counts = counts(0);
    await feed.markRead("a");
    expect(feed.counts.unread).toBe(0);
    expect(feed.counts.unreadByPriority.low).toBe(0);
  });
});
```

Also update the existing **setSort** test (it asserts `getMock` was called once). `load()` now also calls `fetchCounts()`, so a `setSort` triggers two GETs (page + counts). Change that assertion to target the page request specifically:

```ts
// was: expect(getMock).toHaveBeenCalledTimes(1);
expect(getMock.mock.calls.some((c) => String(c[0]).includes("sort=oldest"))).toBe(true);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/stores/feed.spec.ts`
Expected: the new counts tests FAIL (`fetchCounts`/`counts` undefined).

- [ ] **Step 3: Implement**

In `frontend/src/stores/feed.ts`:

- Import the type: add `NotificationCounts` to the `@notifications/shared` type import; also import `NotificationPriority` (already imported).
- Add state (near `sort`):

```ts
function emptyByPriority(): Record<NotificationPriority, number> {
  return { critical: 0, high: 0, normal: 0, low: 0 };
}
const counts = ref<NotificationCounts>({ unread: 0, unreadByPriority: emptyByPriority() });

/** Apply an exact delta to the unread total and one priority bucket; clamp at 0. */
function adjustCount(priority: NotificationPriority, delta: number): void {
  const byPriority = { ...counts.value.unreadByPriority };
  byPriority[priority] = Math.max(0, byPriority[priority] + delta);
  counts.value = { unread: Math.max(0, counts.value.unread + delta), unreadByPriority: byPriority };
}

/** Refresh the authoritative counts snapshot. Best-effort — a failure keeps the last snapshot. */
async function fetchCounts(): Promise<void> {
  try {
    counts.value = await api.get<NotificationCounts>("/notifications/counts");
  } catch {
    console.warn("[feed] failed to refresh counts; keeping the last snapshot");
  }
}
```

- In `load()`, after `status.value = "ready"`, refresh counts: `await fetchCounts();` (inside the `try`, before the closing brace). Do **not** call it in `loadMore()`.
- In `reset()`, also reset counts: `counts.value = { unread: 0, unreadByPriority: emptyByPriority() };`.
- `markRead(id)`: after `setRead(id, true); stick(id);`, add `adjustCount(target.read ? "low" : target.priority, ...)` — simpler: capture the priority before the flip and decrement:

```ts
async function markRead(id: string): Promise<void> {
  const target = items.value.find((n) => n.id === id);
  if (!target || target.read) return;
  const prio = target.priority;
  setRead(id, true);
  stick(id);
  adjustCount(prio, -1); // optimistic: one fewer unread of this priority
  try {
    await api.post(`/notifications/${encodeURIComponent(id)}/read`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      remove(id); // gone server-side — it's no longer unread-existing, so keep the decrement
      return;
    }
    setRead(id, false);
    unstick(id);
    adjustCount(prio, +1); // revert
    console.warn(`[feed] failed to mark ${id} read; reverted`);
  }
}
```

- `markUnread(id)`: mirror — capture `prio`, `adjustCount(prio, +1)` after the optimistic `setRead(id, false)`, and `adjustCount(prio, -1)` in the catch (revert), alongside the existing read-flag revert.
- `markAllReadInScope()`: capture the flipped items' priorities and decrement each; revert each on failure:

```ts
async function markAllReadInScope(): Promise<void> {
  const targets = visibleItems.value.filter((n) => !n.read);
  if (targets.length === 0) return;
  for (const n of targets) {
    setRead(n.id, true);
    adjustCount(n.priority, -1);
  }
  try {
    await api.post("/notifications/read", { ids: targets.map((n) => n.id) });
  } catch {
    for (const n of targets) {
      setRead(n.id, false);
      adjustCount(n.priority, +1);
    }
    console.warn("[feed] mark-all-read failed; reverted");
  }
}
```

- `onLiveBatch(batch)`: compute the fresh (new-to-`seen`) items before `addFront`, and increment counts for them (live arrivals are unread):

```ts
function onLiveBatch(batch: Notification[]): void {
  const incoming = batch.map(toFeed);
  const fresh = incoming.filter((n) => !seen.has(n.id));
  for (const n of fresh) adjustCount(n.priority, +1);
  const freshCriticals = fresh.filter((n) => n.priority === "critical");
  addFront(incoming); // dedupes on `seen` internally
  if (freshCriticals.length > 0) for (const cb of criticalSubs) cb(freshCriticals);
}
```

- Export `counts` and `fetchCounts` in the return object.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @notifications/frontend exec vitest run src/stores/feed.spec.ts && pnpm --filter @notifications/frontend typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/feed.ts frontend/src/stores/feed.spec.ts
git commit -m "feat(feed): server-sourced counts snapshot with optimistic deltas + SSE increments"
```

---

### Task 5: Wire the surfaces to `feed.counts`; retire the loaded-window `unreadCount`

**Files:**

- Modify: `frontend/src/features/notifications/NotificationBell.vue`
- Modify: `frontend/src/features/notifications/NotificationPopover.vue`
- Modify: `frontend/src/features/notifications/components/FeedList.vue`
- Modify: `frontend/src/features/notifications/panel/InboxTab.vue`
- Modify: `frontend/src/features/notifications/components/FilterMenu.vue`
- Modify: `frontend/src/stores/feed.ts` (remove `unreadCount`)
- Tests: `frontend/src/stores/feed.spec.ts`, `frontend/src/features/notifications/NotificationBell.spec.ts`, `.../components/FeedList.spec.ts`, `.../panel/InboxTab.spec.ts`

**Interfaces:**

- Consumes: `feed.counts` (Task 4).
- Produces: bell badge, needs-action header, chips, and filter-menu priority rows all read `feed.counts`. `feed.unreadCount` no longer exists.

- [ ] **Step 1: Write / adjust the failing tests**

`NotificationBell.spec.ts` — drive the badge off counts (add/adjust a test):

```ts
it("shows the unread badge from the server counts snapshot", async () => {
  const feed = useFeedStore();
  feed.counts = { unread: 3, unreadByPriority: { critical: 1, high: 2, normal: 0, low: 0 } };
  const wrapper = mount(NotificationBell);
  expect(wrapper.text()).toContain("3");
});
```

`FeedList.spec.ts` — the needs-action count comes from a prop now. Add/adjust to pass `unread` and assert the header reflects it (see the prop change in Step 2). If FeedList reads the store instead of a prop, set `feed.counts` in the test.

`InboxTab.spec.ts` — a chip shows its count:

```ts
it("shows unread counts on the chips from feed.counts", () => {
  const feed = useFeedStore();
  feed.status = "ready";
  feed.counts = { unread: 5, unreadByPriority: { critical: 2, high: 3, normal: 0, low: 0 } };
  const wrapper = mount(InboxTab);
  expect(wrapper.text()).toContain("2"); // critical chip count
  expect(wrapper.text()).toContain("3"); // high chip count
});
```

`feed.spec.ts` — remove the now-dangling `expect(feed.unreadCount)...` lines (the surrounding tests keep their read-flag/group/POST assertions). The counts tally behavior is covered by the Task 4 counts tests.

- [ ] **Step 2: Implement**

**`feed.ts`** — remove the `unreadCount` computed and its entry in the return object.

**`NotificationBell.vue`** — replace `feed.unreadCount` with `feed.counts.unread` in the `badge` computed, the `v-if`, and the aria-label.

**`NotificationPopover.vue`** — in `onMounted`, after `feed.flushSessionReads()`, add `feed.fetchCounts();` (reconcile on open). In its spec, spy `fetchCounts` (`vi.spyOn(feed, "fetchCounts").mockResolvedValue()`) so mounting doesn't hit the network.

**`FeedList.vue`** — replace the `unreadInNeedsAction` computed with a prop. Add `unread: number` to `defineProps`, drop the `unreadInNeedsAction` computed, and use `props.unread` for the header count + the "Mark all read" button's `v-if`. Header pill text: `{{ props.unread }} unread`.

**`InboxTab.vue`** — pass `:unread="feed.counts.unread"` to `<FeedList>`. Add count badges to the Critical and High chips (render only when `> 0`), reusing the existing count-pill styling:

```html
<Chip :active="feed.priorities.has('critical')" @click="feed.togglePriority('critical')">
  Critical
  <span v-if="feed.counts.unreadByPriority.critical > 0" class="ml-1 font-mono text-[11px] tabular-nums">
    {{ feed.counts.unreadByPriority.critical }}
  </span>
</Chip>
```

(Same for High. The "Unread" chip shows `feed.counts.unread` when `> 0`, same pattern.)

**`FilterMenu.vue`** — in the Priority rows, append a right-aligned per-priority count when `> 0`:

```html
<span class="ml-auto font-mono text-[11px] tabular-nums text-faint" v-if="feed.counts.unreadByPriority[p] > 0">
  {{ feed.counts.unreadByPriority[p] }}
</span>
```

- [ ] **Step 3: Run the full frontend suite + typecheck + lint**

Run: `pnpm --filter @notifications/frontend typecheck && pnpm lint && pnpm --filter @notifications/frontend test`
Expected: PASS, clean. (Confirms no lingering `unreadCount` reference anywhere.)

- [ ] **Step 4: Browser check**

`/verify` or `browser-tester`: log in (admin / notify-dev-2026), publish a burst, reload. Confirm: the bell badge, "Needs action" count, and Critical/High chip counts all reflect the true totals; opening the filter dropdown shows per-priority counts and the "Sort by" radios; the dropdown is fully visible (not clipped) even with an empty/short feed; marking items read decrements the counts live; a new SSE critical increments them.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(notifications): show accurate server counts on bell, header, chips, and filter menu"
```

---

### Task 6: API docs

**Files:**

- Modify: `docs/api/notifications.md`

- [ ] **Step 1: Dispatch docs-writer**

Per `api-documentation.md`, delegate to the **docs-writer** subagent. Brief it: a new endpoint `GET /notifications/counts` (`requireUser`) returns `{ unread, unreadByPriority: { critical, high, normal, low } }` — the current user's UNREAD counts aggregated server-side over the whole dataset (not the loaded window). `unread` is the sum. Excludes read rows (per-user `notification_reads`) and suppressed rows. Absolute for now (ignores active filters). 401 without a session. Update the existing notifications doc; don't create a new file.

- [ ] **Step 2: Commit**

```bash
git add docs/api/notifications.md
git commit -m "docs(api): document GET /notifications/counts"
```

---

## Final verification

1. Postgres up; `pnpm --filter @notifications/backend test`, `pnpm --filter @notifications/frontend test`, `pnpm --filter @notifications/shared test` green.
2. `pnpm lint && pnpm typecheck` clean.
3. Reviews: `code-reviewer` (counts freshness/optimistic-delta correctness + the teleport lifecycle are the risks), `frontend-design-reviewer` + `browser-tester` (sort-in-dropdown, count badges, un-clipped menu), `security-reviewer` (new endpoint: parameterized SQL, `requireUser`, per-user read scoping). `docs-writer` already ran (Task 6).
4. `superpowers:finishing-a-development-branch` (mentor gate still precedes any push).

## Self-review notes (coverage check)

- Spec Part 1 (sort → dropdown radios; remove select) → Task 2. ✅
- Spec Part 2 (teleport, fixed positioning, outside-click, keep popover overflow-hidden) → Task 1. ✅
- Spec Part 3 endpoint + shared type → Task 3; store counts/fetchCounts/deltas/SSE → Task 4; surfaces + retire `unreadCount` → Task 5; docs → Task 6. ✅
- Absolute semantics, zero-fill, suppressed/read exclusion → Task 3 SQL + test. ✅
- Freshness: load + panel-open reconcile + optimistic deltas + SSE increment; trimming untouched; no per-click round-trip → Task 4 + Task 5 (popover onMounted). ✅
- Type consistency: `NotificationCounts` defined in Task 3, consumed in Tasks 4/5; `adjustCount`/`fetchCounts`/`counts` defined in Task 4, consumed in Task 5; `FeedSort` (existing) consumed in Task 2; `FeedList` gains an `unread` prop in Task 5 (InboxTab passes it).
- Order honors the user's ask: filter-menu changes (Tasks 1–2) before counts (Tasks 3–5).
