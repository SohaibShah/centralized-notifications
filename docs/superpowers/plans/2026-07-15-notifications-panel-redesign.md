# Notification Panel Density Redesign + Critical Toast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bell popover fit ~5 unread at once (condensed chrome, compact expandable cards, collapsed read list, taller panel) and add a critical-only bottom-right toast.

**Architecture:** Extends the existing popover components on `chore/scaffold-monorepo`. Backend gains one bulk mark-read endpoint. The feed store gains `markAllReadInScope()` and an `onLiveCritical` subscription; a new panel-open store lifts the popover's open-state out of the bell so the toast can open it. A new toast store + two components render the app-level critical toast from `DashboardLayout`.

**Tech Stack:** Vue 3 `<script setup>` + TS, Vite 6, Tailwind v4 (`@theme` tokens), Pinia, `@lucide/vue`, Fastify + `pg`, Vitest + `@vue/test-utils`, Playwright.

## Global Constraints

- TypeScript strict; `any` needs an inline comment. No hardcoded hex/px in components — style via Tailwind utilities off the `@theme` tokens (`text-text`, `bg-surface`, `border-line`, `text-accent`, `bg-danger`, etc.). Type scale is `11/12/13/14/16/18/22/28` — no off-scale sizes. Radii: `sm 6 / md 9 / lg 12 / pill`.
- **Priority = the dot** (`priorityDotClass` in `@/design/tokens`), never a colored left-bar or an alert icon. **Flat + hairline**; shadows only as restrained overlay elevation. **lucide icons, never emoji.** Motion: transform/opacity only, ease-out `cubic-bezier(0.16,1,0.3,1)`, honor `prefers-reduced-motion`.
- Every interactive element has a visible focus state; WCAG AA contrast; motion respects reduced-motion.
- Backend: validate every endpoint with zod before touching the DB; parameterized SQL only; `requireUser`; per-user read state; idempotent writes.
- `pnpm lint` + `pnpm typecheck` clean; Vitest units beside source as `*.spec.ts` under `src/`; Playwright e2e in `frontend/e2e/`. Not "done" on `tsc` alone — browser-verify UI.
- Conventional Commits. **NEVER add "Generated with AI" / "Co-Authored-By: AI" trailers.**
- Reuse: `stores/feed.ts`, `api/client.ts`, `api/sse.ts`, `components/ui/*`, `FilterMenu.vue`, `@/design/{tokens,icons}`. The jsdom `IntersectionObserver` stub is in `frontend/src/test-setup.ts`.

## File map

- **Modify** `backend/src/http/notifications/routes.ts` — add `POST /notifications/read` (bulk).
- **Modify** `backend/test/notifications.test.ts` — bulk-read tests.
- **Modify** `docs/api/notifications.md` — document the bulk endpoint.
- **Modify** `frontend/src/stores/feed.ts` — `markAllReadInScope()`, `onLiveCritical()`.
- **Modify** `frontend/src/stores/feed.spec.ts` — cover both.
- **Create** `frontend/src/stores/notificationPanel.ts` (+ `.spec.ts`) — lifted open-state.
- **Modify** `frontend/src/features/notifications/NotificationBell.vue` (+ spec) — use the panel store.
- **Create** `frontend/src/stores/toast.ts` (+ `.spec.ts`) — critical-toast queue.
- **Create** `frontend/src/features/notifications/CriticalToast.vue`, `CriticalToastViewport.vue`.
- **Modify** `frontend/src/features/dashboard/DashboardLayout.vue` — mount the viewport + wire SSE→toast.
- **Rewrite** `frontend/src/features/notifications/renderers/NotificationCardRenderer.vue` (+ new spec) — V1 expandable card.
- **Rewrite** `frontend/src/features/notifications/components/FeedList.vue` (+ new spec) — split needs-action / collapsed earlier + mark-all link.
- **Modify** `frontend/src/features/notifications/panel/InboxTab.vue` — wire mark-all; AI-summary chevron; drop the search row (moves to toolbar).
- **Modify** `frontend/src/features/notifications/NotificationPopover.vue` — one toolbar (tabs + search toggle + filter + close, no "Live"), 80vh.
- **Modify** `frontend/e2e/feed.spec.ts` — card-expand interaction + critical-toast path.

---

### Task 1: Backend — bulk mark-read endpoint

**Files:**

- Modify: `backend/src/http/notifications/routes.ts`
- Test: `backend/test/notifications.test.ts`
- Docs: `docs/api/notifications.md`

**Interfaces:**

- Produces: `POST /notifications/read` — body `{ ids: string[] }` (1–500 non-empty ids ≤200 chars); `requireUser`; marks each existing id read for the caller (per-user, idempotent); ignores unknown ids; `204` on success, `400` invalid body, `401` unauth.

- [ ] **Step 1: Write the failing tests.** Append this `describe` block to `backend/test/notifications.test.ts` (it reuses the file's existing `app`, `sessionCookie`, `IDS`, `ID_PREFIX` from the top-level setup — place it after the existing `POST /notifications/:id/read` describe, inside the same file scope):

```ts
describe("POST /notifications/read (bulk)", () => {
  it("401 without a session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/read",
      payload: { ids: [IDS[0]] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400 on an invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: { cookie: sessionCookie },
      payload: { ids: [] }, // empty not allowed
    });
    expect(res.statusCode).toBe(400);
  });

  it("marks the given ids read for the caller, ignores unknown ids, and is idempotent", async () => {
    const bogus = "does-not-exist-xyz";
    const first = await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: { cookie: sessionCookie },
      payload: { ids: [IDS[0], IDS[1], bogus] },
    });
    expect(first.statusCode).toBe(204);

    // A repeat is a no-op (idempotent).
    const again = await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: { cookie: sessionCookie },
      payload: { ids: [IDS[0], IDS[1], bogus] },
    });
    expect(again.statusCode).toBe(204);

    // The two real ids now read back as read; the bogus id created no row.
    const list = await app.inject({
      method: "GET",
      url: "/notifications?limit=100",
      headers: { cookie: sessionCookie },
    });
    const body = list.json() as NotificationPage;
    const byId = new Map(body.items.map((n) => [n.id, n.read]));
    expect(byId.get(IDS[0]!)).toBe(true);
    expect(byId.get(IDS[1]!)).toBe(true);
    const reads = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM notification_reads WHERE user_id = $1 AND notification_id = $2",
      [userId, bogus],
    );
    expect(reads.rows[0]!.n).toBe("0");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/backend test -- notifications`
      Expected: the new tests FAIL (404/route-not-found on `POST /notifications/read`).

- [ ] **Step 3: Add the endpoint.** In `backend/src/http/notifications/routes.ts`, add the schema after `readParamsSchema` (line 18):

```ts
// Bulk mark-read: cap the batch so one request can't ask to write an unbounded set.
const bulkReadSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(500),
});
```

Then add this handler inside `notificationRoutes`, after the `POST /notifications/:id/read` handler (before the closing `}` of the function):

```ts
/**
 * Bulk mark-read for the current user (mark-all-read in the panel): `POST
 * /notifications/read` with `{ ids: string[] }`. One row per id that actually
 * exists (the `= ANY` filter drops unknown ids silently, same effect as the
 * single-id 404 guard but batched). Per-user and idempotent (ON CONFLICT DO
 * NOTHING). Returns 204.
 */
app.post("/notifications/read", { preHandler: requireUser }, async (req, reply) => {
  const user = req.user;
  if (!user) return reply.code(401).send({ error: "authentication required" });

  const parsed = bulkReadSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
  const { ids } = parsed.data;

  await query(
    `INSERT INTO notification_reads (user_id, notification_id)
       SELECT $1, n.id FROM notifications n WHERE n.id = ANY($2::text[])
       ON CONFLICT (user_id, notification_id) DO NOTHING`,
    [user.id, ids],
  );
  return reply.code(204).send();
});
```

- [ ] **Step 4: Run to verify it passes.** Run: `pnpm --filter @notifications/backend test -- notifications`
      Expected: PASS (existing + 3 new).

- [ ] **Step 5: Typecheck + lint.** Run: `pnpm typecheck && pnpm lint` → clean.

- [ ] **Step 6: Document the endpoint.** In `docs/api/notifications.md`, add a section for `POST /notifications/read` mirroring the existing `POST /notifications/:id/read` entry: request body `{ ids: string[] }` (1–500, each ≤200 chars), auth required, per-user, idempotent, ignores unknown ids, `204`/`400`/`401`, side effect: inserts `notification_reads` rows. (If a `docs-writer` subagent is available, delegate the wording to it per `.claude/rules/api-documentation.md`; otherwise write it directly.)

- [ ] **Step 7: Commit.**

```bash
git add backend/src/http/notifications/routes.ts backend/test/notifications.test.ts docs/api/notifications.md
git commit -m "feat(backend): bulk mark-read endpoint POST /notifications/read"
```

---

### Task 2: Feed store — `markAllReadInScope()` + `onLiveCritical()`

**Files:**

- Modify: `frontend/src/stores/feed.ts`
- Test: `frontend/src/stores/feed.spec.ts`

**Interfaces:**

- Consumes: bulk endpoint from Task 1 (`api.post("/notifications/read", { ids })`).
- Produces (on the store returned object):
  - `markAllReadInScope(): Promise<void>` — marks every currently-**visible unread** item read (optimistic; posts `{ ids }`; reverts all on failure).
  - `onLiveCritical(cb: (items: FeedNotification[]) => void): () => void` — registers a callback fired with the **newly-arrived** critical items from each live SSE batch (deduped: only ids not already in the feed); returns an unsubscribe fn.

- [ ] **Step 1: Write the failing tests.** Append to `frontend/src/stores/feed.spec.ts` inside the top-level `describe("feed store", …)`:

```ts
it("markAllReadInScope marks only visible unread items and posts their ids", async () => {
  const feed = useFeedStore();
  getMock.mockResolvedValueOnce(
    page([
      feedItem({ id: "a", read: false, priority: "critical" }),
      feedItem({ id: "b", read: true }),
      feedItem({ id: "c", read: false, priority: "normal" }),
    ]),
  );
  await feed.load();
  feed.togglePriority("critical"); // scope now: only "a" is visible+unread

  await feed.markAllReadInScope();

  expect(postMock).toHaveBeenCalledWith("/notifications/read", { ids: ["a"] });
  expect(feed.items.find((n) => n.id === "a")?.read).toBe(true);
  expect(feed.items.find((n) => n.id === "c")?.read).toBe(false); // out of scope, untouched
});

it("markAllReadInScope reverts all optimistic flips when the POST fails", async () => {
  const feed = useFeedStore();
  getMock.mockResolvedValueOnce(page([feedItem({ id: "a" }), feedItem({ id: "b" })]));
  await feed.load();
  postMock.mockRejectedValueOnce(new Error("500"));

  await feed.markAllReadInScope();

  expect(feed.items.every((n) => n.read === false)).toBe(true);
  expect(feed.unreadCount).toBe(2);
});

it("onLiveCritical fires with only newly-arrived critical items", async () => {
  const feed = useFeedStore();
  getMock.mockResolvedValueOnce(page([feedItem({ id: "old-crit", priority: "critical" })], null));
  feed.connect();
  await feed.load();

  const seen: string[][] = [];
  const off = feed.onLiveCritical((items) => seen.push(items.map((n) => n.id)));

  sseState.onBatch!([
    liveNotif({ id: "x", priority: "critical" }),
    liveNotif({ id: "y", priority: "normal" }), // not critical → excluded
    liveNotif({ id: "old-crit", priority: "critical" }), // already loaded → excluded
  ]);
  expect(seen).toEqual([["x"]]);

  off();
  sseState.onBatch!([liveNotif({ id: "z", priority: "critical" })]);
  expect(seen).toEqual([["x"]]); // unsubscribed → no further calls
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- feed`
      Expected: FAIL (`markAllReadInScope`/`onLiveCritical` not functions).

- [ ] **Step 3: Implement in `frontend/src/stores/feed.ts`.** Add the subscriber set + registration near the other live-delivery code (after `onLiveBatch`, ~line 135), and replace `onLiveBatch` with the version that notifies critical subscribers:

```ts
// Critical-arrival subscribers (the toast listens here). Fired only with items that
// are genuinely new to the feed this batch, so a duplicate delivery never re-toasts.
const criticalSubs = new Set<(items: FeedNotification[]) => void>();
function onLiveCritical(cb: (items: FeedNotification[]) => void): () => void {
  criticalSubs.add(cb);
  return () => criticalSubs.delete(cb);
}

/** Handle one coalesced SSE burst: prepend new notifications, then notify critical subs. */
function onLiveBatch(batch: Notification[]): void {
  const incoming = batch.map(toFeed);
  const freshCriticals = incoming.filter((n) => !seen.has(n.id) && n.priority === "critical");
  addFront(incoming); // dedupes on `seen` internally
  if (freshCriticals.length > 0) for (const cb of criticalSubs) cb(freshCriticals);
}
```

(Delete the old one-line `onLiveBatch` that just called `addFront(batch.map(toFeed))`.)

Add `markAllReadInScope` after `markRead` (~line 172):

```ts
/**
 * Mark every currently-visible unread notification read (the panel's "Mark all read",
 * scoped to the active filters). Optimistic: flip all locally, persist in one bulk
 * request, revert all on failure.
 */
async function markAllReadInScope(): Promise<void> {
  const ids = visibleItems.value.filter((n) => !n.read).map((n) => n.id);
  if (ids.length === 0) return;
  for (const id of ids) setRead(id, true);
  try {
    await api.post("/notifications/read", { ids });
  } catch {
    for (const id of ids) setRead(id, false);
    console.warn("[feed] mark-all-read failed; reverted");
  }
}
```

Then export both in the store's returned object (add to the `actions` group of the `return { … }`): `markAllReadInScope,` and `onLiveCritical,`.

- [ ] **Step 4: Run to verify it passes.** Run: `pnpm --filter @notifications/frontend test -- feed`
      Expected: PASS.

- [ ] **Step 5: Typecheck + lint.** `pnpm typecheck && pnpm lint` → clean.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/stores/feed.ts frontend/src/stores/feed.spec.ts
git commit -m "feat(frontend): feed store markAllReadInScope + onLiveCritical subscription"
```

---

### Task 3: V1 expandable action card

**Files:**

- Rewrite: `frontend/src/features/notifications/renderers/NotificationCardRenderer.vue`
- Test: `frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts` (new)

**Interfaces:**

- Consumes: `FeedNotification`, `NotificationAction` (shared); `actionIcon` (`@/design/icons`); `priorityDotClass`, `priorityLabel` (`@/design/tokens`); `relativeTime`, `exactTime` (`@/lib/time`).
- Produces: same emits as today — `open: [FeedNotification]` (mark read) and `action: [NotificationAction, FeedNotification]`. New behavior: a right-side chevron button (rendered only when the notification has actions) toggles an expanded region containing the action buttons (each with its lucide icon); expanding also emits `open`. The title stays a `<button>` whose accessible name is the title and which is `font-normal` when read (keeps the e2e/read contract).

- [ ] **Step 1: Write the failing test** `NotificationCardRenderer.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { FeedNotification } from "@notifications/shared";
import NotificationCardRenderer from "./NotificationCardRenderer.vue";
import { feedItem } from "@/test-support/feedItem";

function withActions(over: Partial<FeedNotification> & { id: string }): FeedNotification {
  return feedItem({
    actions: [{ label: "Open", url: "https://example.com", method: "GET", icon: "external-link" }],
    ...over,
  });
}

describe("NotificationCardRenderer", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows no chevron and no action bar for a notification without actions", () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    expect(wrapper.find('[aria-label="Show actions"]').exists()).toBe(false);
    expect(wrapper.find("button").text()).toContain("Title");
  });

  it("clicking the title button emits open (mark read)", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("expands via the chevron to reveal action buttons with icons, and expanding emits open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    const chevron = wrapper.get('[aria-label="Show actions"]');
    // collapsed: action button not shown
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false);
    await chevron.trigger("click");
    const actions = wrapper.findAll('[data-test="action"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.text()).toContain("Open");
    expect(actions[0]!.find("svg").exists()).toBe(true); // icon rendered
    expect(wrapper.emitted("open")).toHaveLength(1); // expanding marked read
  });

  it("clicking an action emits action and not a second open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    await wrapper.get('[aria-label="Show actions"]').trigger("click");
    await wrapper.get('[data-test="action"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
    expect(wrapper.emitted("open")).toHaveLength(1); // only the expand-open, not another
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- NotificationCardRenderer`
      Expected: FAIL (the current card has no chevron / `data-test="action"` / `aria-label="Show actions"`).

- [ ] **Step 3: Rewrite `NotificationCardRenderer.vue`:**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Icon from "@/components/ui/Icon.vue";
import { actionIcon } from "@/design/icons";
import { priorityDotClass, priorityLabel } from "@/design/tokens";
import { exactTime, relativeTime } from "@/lib/time";

// Config-driven feed row. Compact by default; a chevron (only when the notification has
// actions) expands the card to reveal those actions with their icons. The card body /
// title / expanding all mark the notification read (emit "open").
const props = defineProps<{ notification: FeedNotification }>();
const emit = defineEmits<{
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
}>();

const item = computed(() => props.notification);
const hasActions = computed(() => (item.value.actions?.length ?? 0) > 0);
const expanded = ref(false);

// Only genuinely-live rows (createdAt ≈ now) get the fade+rise entrance.
const isFresh = Date.now() - new Date(props.notification.createdAt).getTime() < 4000;

function open() {
  emit("open", item.value);
}
function toggleExpand() {
  expanded.value = !expanded.value;
  if (expanded.value) emit("open", item.value); // expanding also marks read
}
</script>

<template>
  <article
    class="group border-b border-line px-4 py-2.5 transition-colors duration-100 hover:bg-sunken"
    :class="{ 'animate-enter': isFresh }"
  >
    <div class="flex cursor-pointer gap-3" @click="open">
      <span
        role="img"
        :aria-label="`${priorityLabel[item.priority]} priority`"
        class="mt-1.5 size-2 shrink-0 rounded-full"
        :class="priorityDotClass[item.priority]"
      />

      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-3">
          <h3 class="min-w-0 flex-1">
            <button
              type="button"
              class="block w-full truncate text-left font-sans text-[14px]"
              :class="item.read ? 'font-normal text-muted' : 'font-semibold text-text'"
              :title="item.title"
              @click.stop="open"
            >
              {{ item.title }}
            </button>
          </h3>
          <time
            class="shrink-0 font-mono text-[12px] tabular-nums text-faint"
            :datetime="item.createdAt"
            :title="exactTime(item.createdAt)"
          >
            {{ relativeTime(item.createdAt) }}
          </time>
        </div>

        <p v-if="item.description" class="mt-0.5 truncate text-[13px] leading-relaxed text-muted">
          {{ item.description }}
        </p>

        <div class="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
          <span class="font-mono uppercase tracking-wide">{{ item.module }}</span>
          <template v-if="item.category">
            <span aria-hidden="true">·</span>
            <span>{{ item.category }}</span>
          </template>
        </div>
      </div>

      <button
        v-if="hasActions"
        type="button"
        class="mt-0.5 grid size-6 shrink-0 place-items-center self-start rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
        :aria-label="expanded ? 'Hide actions' : 'Show actions'"
        :aria-expanded="expanded"
        @click.stop="toggleExpand"
      >
        <Icon
          :icon="ChevronDown"
          :size="15"
          :class="expanded ? 'rotate-180 transition-transform' : 'transition-transform'"
        />
      </button>
    </div>

    <div v-if="expanded && hasActions" class="mt-2.5 flex flex-wrap gap-2 pl-5">
      <button
        v-for="action in item.actions"
        :key="action.label + action.url"
        type="button"
        data-test="action"
        class="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-text transition-colors duration-100 hover:bg-sunken"
        @click.stop="emit('action', action, item)"
      >
        <Icon v-if="actionIcon(action.icon)" :icon="actionIcon(action.icon)!" :size="13" />
        {{ action.label }}
      </button>
    </div>
  </article>
</template>
```

- [ ] **Step 4: Run to verify it passes.** Run: `pnpm --filter @notifications/frontend test -- NotificationCardRenderer`
      Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + typecheck + lint.** Run: `pnpm --filter @notifications/frontend test && pnpm typecheck && pnpm lint` → all green (the existing InboxTab/popover specs still mount this card fine).

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/features/notifications/renderers/NotificationCardRenderer.vue frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts
git commit -m "feat(frontend): V1 expandable notification card (chevron reveals actions with icons)"
```

---

### Task 4: Collapsed read list + mark-all link (FeedList)

**Files:**

- Rewrite: `frontend/src/features/notifications/components/FeedList.vue`
- Modify: `frontend/src/features/notifications/panel/InboxTab.vue` (wire `@mark-all`)
- Test: `frontend/src/features/notifications/components/FeedList.spec.ts` (new)

**Interfaces:**

- Consumes: `FeedGroup` (`@/stores/feed`; `key` is `"needs-action" | "earlier"`), `NotificationCardRenderer` (Task 3), `Spinner`.
- Produces: `FeedList` props unchanged (`groups`, `hasMore`, `loadingMore`); emits `loadMore`, `open`, `action`, and **new** `markAll: []`. The "needs-action" group renders rich cards under a sticky header carrying a "Mark all read" button (emits `markAll`); the "earlier" group is hidden behind a centered "Show N earlier"/"Hide earlier" toggle rendering compact read rows.

- [ ] **Step 1: Write the failing test** `FeedList.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { FeedGroup } from "@/stores/feed";
import FeedList from "./FeedList.vue";
import { feedItem } from "@/test-support/feedItem";

const groups: FeedGroup[] = [
  {
    key: "needs-action",
    label: "Needs action",
    items: [feedItem({ id: "u1" }), feedItem({ id: "u2" })],
  },
  {
    key: "earlier",
    label: "Earlier",
    items: [feedItem({ id: "r1", read: true }), feedItem({ id: "r2", read: true })],
  },
];

describe("FeedList", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows a Mark all read control on the needs-action header and emits markAll", async () => {
    const wrapper = mount(FeedList, { props: { groups, hasMore: false, loadingMore: false } });
    const btn = wrapper.get('[data-test="mark-all"]');
    await btn.trigger("click");
    expect(wrapper.emitted("markAll")).toHaveLength(1);
  });

  it("collapses the earlier group behind a toggle that reveals the read rows", async () => {
    const wrapper = mount(FeedList, { props: { groups, hasMore: false, loadingMore: false } });
    const toggle = wrapper.get('[data-test="show-earlier"]');
    expect(toggle.text()).toContain("2"); // count of read items
    expect(wrapper.find('[data-test="earlier-list"]').exists()).toBe(false);
    await toggle.trigger("click");
    expect(wrapper.find('[data-test="earlier-list"]').exists()).toBe(true);
  });

  it("omits the earlier toggle when there is no earlier group", () => {
    const wrapper = mount(FeedList, {
      props: { groups: [groups[0]!], hasMore: false, loadingMore: false },
    });
    expect(wrapper.find('[data-test="show-earlier"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- FeedList`
      Expected: FAIL (no `data-test` hooks / markAll emit yet).

- [ ] **Step 3: Rewrite `FeedList.vue`:**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Spinner from "@/components/ui/Spinner.vue";
import type { FeedGroup } from "@/stores/feed";
import { relativeTime } from "@/lib/time";
import { priorityDotClass, priorityLabel } from "@/design/tokens";
import NotificationCardRenderer from "../renderers/NotificationCardRenderer.vue";

const props = defineProps<{ groups: FeedGroup[]; hasMore: boolean; loadingMore: boolean }>();
const emit = defineEmits<{
  loadMore: [];
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
  markAll: [];
}>();

const needsAction = computed(() => props.groups.find((g) => g.key === "needs-action"));
const earlier = computed(() => props.groups.find((g) => g.key === "earlier"));
const showEarlier = ref(false);

// Plain scroll container + IntersectionObserver sentinel drive keyset pagination.
const scroller = ref<HTMLElement | null>(null);
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
function maybeLoadMore(): void {
  if (props.hasMore && !props.loadingMore) emit("loadMore");
}
onMounted(() => {
  if (!scroller.value || !sentinel.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) maybeLoadMore();
    },
    { root: scroller.value, rootMargin: "300px" },
  );
  observer.observe(sentinel.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
    <section v-if="needsAction">
      <div
        class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur"
      >
        <h2 class="font-display text-[13px] font-medium text-text">{{ needsAction.label }}</h2>
        <span class="font-mono text-[12px] tabular-nums text-faint">{{
          needsAction.items.length
        }}</span>
        <button
          type="button"
          data-test="mark-all"
          class="ml-auto font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:text-text"
          @click="emit('markAll')"
        >
          Mark all read
        </button>
      </div>
      <NotificationCardRenderer
        v-for="n in needsAction.items"
        :key="n.id"
        :notification="n"
        @open="(x) => emit('open', x)"
        @action="(a, x) => emit('action', a, x)"
      />
    </section>

    <section v-if="earlier">
      <div class="flex justify-center py-2.5">
        <button
          type="button"
          data-test="show-earlier"
          class="rounded-full bg-sunken px-3.5 py-1.5 text-[12px] font-semibold text-accent transition-colors duration-100 hover:bg-accent/10"
          :aria-expanded="showEarlier"
          @click="showEarlier = !showEarlier"
        >
          {{ showEarlier ? "Hide earlier" : `Show ${earlier.items.length} earlier` }}
        </button>
      </div>
      <div v-if="showEarlier" data-test="earlier-list">
        <button
          v-for="n in earlier.items"
          :key="n.id"
          type="button"
          class="flex w-full items-center gap-2.5 border-b border-line px-4 py-2 text-left transition-colors duration-100 hover:bg-sunken"
          @click="emit('open', n)"
        >
          <span
            role="img"
            :aria-label="`${priorityLabel[n.priority]} priority`"
            class="size-1.5 shrink-0 rounded-full"
            :class="priorityDotClass[n.priority]"
          />
          <span class="min-w-0 flex-1 truncate text-[12px] text-muted" :title="n.title">{{
            n.title
          }}</span>
          <time
            class="shrink-0 font-mono text-[11px] tabular-nums text-faint"
            :datetime="n.createdAt"
          >
            {{ relativeTime(n.createdAt) }}
          </time>
        </button>
      </div>
    </section>

    <div ref="sentinel" aria-hidden="true" class="h-px" />

    <div
      v-if="loadingMore"
      class="flex items-center justify-center gap-2 py-5 text-[12px] text-faint"
      role="status"
    >
      <Spinner :size="14" />
      Loading earlier notifications…
    </div>
  </div>
</template>
```

- [ ] **Step 4: Wire mark-all in `InboxTab.vue`.** In the `<FeedList … />` usage (currently lines ~115–123), add the `@mark-all` handler:

```html
<FeedList
  v-else
  :groups="feed.groups"
  :has-more="feed.hasMore"
  :loading-more="feed.loadingMore"
  @load-more="feed.loadMore()"
  @open="(n) => feed.markRead(n.id)"
  @action="onAction"
  @mark-all="feed.markAllReadInScope()"
/>
```

- [ ] **Step 5: Run to verify it passes.** Run: `pnpm --filter @notifications/frontend test -- FeedList`
      Expected: PASS (3 tests). Then `pnpm --filter @notifications/frontend test` → full suite green.

- [ ] **Step 6: Typecheck + lint.** `pnpm typecheck && pnpm lint` → clean.

- [ ] **Step 7: Commit.**

```bash
git add frontend/src/features/notifications/components/FeedList.vue frontend/src/features/notifications/components/FeedList.spec.ts frontend/src/features/notifications/panel/InboxTab.vue
git commit -m "feat(frontend): collapse read list behind Show-earlier + mark-all-read header link"
```

---

### Task 5: Toolbar condense + AI-summary chevron + taller panel

**Files:**

- Modify: `frontend/src/features/notifications/NotificationPopover.vue`
- Modify: `frontend/src/features/notifications/panel/InboxTab.vue`

**Interfaces:**

- Consumes: `useFeedStore()` (`query`, filters), `FilterMenu`, `Icon`, lucide `Search`/`Sparkles`/`ChevronDown`/`X`.
- Produces: NotificationPopover renders **one toolbar** (tabs + inbox-only search toggle + inbox-only `FilterMenu` + close), no connection indicator, `max-h-[80vh]`. InboxTab no longer owns the search input (moved to the toolbar); its AI-summary band becomes chevron-expandable.

- [ ] **Step 1: Rewrite `NotificationPopover.vue`** (removes the connection indicator and the separate header/tab bands; adds the toolbar with a search toggle and the filter, shown only on the Inbox tab; bumps to 80vh):

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Search, Sparkles, X } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import FilterMenu from "./components/FilterMenu.vue";
import InboxTab from "./panel/InboxTab.vue";
import AssistantTab from "./panel/AssistantTab.vue";

defineEmits<{ close: [] }>();

const feed = useFeedStore();
const tab = ref<"inbox" | "assistant">("inbox");
const inboxTabButton = ref<HTMLButtonElement | null>(null);
const searchOpen = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);

async function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    await Promise.resolve();
    searchInput.value?.focus();
  }
}

onMounted(() => inboxTabButton.value?.focus());
</script>

<template>
  <div
    class="flex max-h-[80vh] w-[380px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xl shadow-black/10"
    role="dialog"
    aria-label="Notifications"
  >
    <!-- One toolbar: tabs (always) + search & filter (Inbox only) + close (always) -->
    <div
      class="flex items-center gap-1 border-b border-line px-3 py-2"
      role="tablist"
      aria-label="Notification views"
    >
      <button
        id="tab-inbox"
        ref="inboxTabButton"
        type="button"
        role="tab"
        :aria-selected="tab === 'inbox'"
        aria-controls="notif-tabpanel"
        class="rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'inbox' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'inbox'"
      >
        Inbox
      </button>
      <button
        id="tab-assistant"
        type="button"
        role="tab"
        :aria-selected="tab === 'assistant'"
        aria-controls="notif-tabpanel"
        class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'assistant' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'assistant'"
      >
        Ask AI <Icon :icon="Sparkles" :size="13" />
      </button>

      <div class="ml-auto flex items-center gap-1">
        <button
          v-if="tab === 'inbox'"
          type="button"
          class="grid size-8 place-items-center rounded-md transition-colors duration-100 hover:bg-sunken"
          :class="searchOpen || feed.query ? 'text-accent' : 'text-faint hover:text-text'"
          aria-label="Search notifications"
          :aria-expanded="searchOpen"
          @click="toggleSearch"
        >
          <Icon :icon="Search" :size="16" />
        </button>
        <FilterMenu v-if="tab === 'inbox'" />
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
          aria-label="Close notifications"
          @click="$emit('close')"
        >
          <Icon :icon="X" :size="16" />
        </button>
      </div>
    </div>

    <!-- Search field appears only when toggled (Inbox only) -->
    <div v-if="tab === 'inbox' && searchOpen" class="border-b border-line px-3 py-2">
      <input
        ref="searchInput"
        v-model="feed.query"
        type="search"
        placeholder="Search notifications"
        aria-label="Search notifications"
        class="h-8 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-text placeholder:text-faint focus-visible:border-accent"
      />
    </div>

    <div
      id="notif-tabpanel"
      class="flex min-h-0 flex-1 flex-col"
      role="tabpanel"
      :aria-labelledby="tab === 'inbox' ? 'tab-inbox' : 'tab-assistant'"
    >
      <InboxTab v-if="tab === 'inbox'" />
      <AssistantTab v-else />
    </div>
  </div>
</template>
```

Note the import path change: `FilterMenu` is now imported into the popover from `./components/FilterMenu.vue`.

- [ ] **Step 2: Update `InboxTab.vue`** — remove the search row (now in the toolbar) and make the AI summary chevron-expandable. Replace the `<script setup>` imports line for lucide and add an `aiOpen` ref; replace the AI-summary block and delete the "Compact filters" search row. New `<script setup>` head:

```ts
import { computed, ref } from "vue";
import { ChevronDown, Inbox, SearchX, Sparkles, WifiOff } from "@lucide/vue";
```

Add after `const feed = useFeedStore();`:

```ts
const aiOpen = ref(false);
```

Replace the AI-summary `<div class="m-3 …">…</div>` block with:

```html
<!-- AI summary — static/canned this pass; chevron expands the fuller digest. -->
<div class="m-3 rounded-lg border border-accent/20 bg-accent/5">
  <button
    type="button"
    class="flex w-full items-center gap-1.5 px-3 py-2.5 text-left"
    :aria-expanded="aiOpen"
    @click="aiOpen = !aiOpen"
  >
    <Icon :icon="Sparkles" :size="13" class="text-accent" />
    <span class="font-mono text-[11px] uppercase tracking-wide text-accent">AI summary</span>
    <span
      class="ml-1 rounded-full bg-sunken px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-faint"
      >Sample</span
    >
    <Icon
      :icon="ChevronDown"
      :size="14"
      class="ml-auto text-faint transition-transform"
      :class="{ 'rotate-180': aiOpen }"
    />
  </button>
  <p v-if="aiOpen" class="px-3 pb-2.5 text-[12px] leading-relaxed text-muted">
    2 need action today — an overdue DSAR and a new tracker finding. 4 lower-priority updates since
    yesterday.
  </p>
</div>
```

Delete the entire `<!-- Compact filters -->` `<div class="flex items-center gap-2 px-3 pb-2">…</div>` block (the one containing the `Search` icon + `<input v-model="feed.query">` + `<FilterMenu />`). Keep the chips row (`All`/`Unread`/`Critical`/`High`) as-is. Remove now-unused imports (`Search`, `FilterMenu`, and the `Button`/`Skeleton`/`StatePanel` imports stay — they're still used by the states below).

- [ ] **Step 3: Typecheck + lint + unit suite.** Run: `pnpm typecheck && pnpm lint && pnpm --filter @notifications/frontend test`
      Expected: clean/green. (The `NotificationPopover.spec.ts` still passes: it checks `role="tab"` buttons, the disabled Assistant composer, and the close button's `aria-label="Close notifications"` — all preserved.)

- [ ] **Step 4: Browser-verify (controller runs `browser-tester`).** Log in, open the bell: confirm one toolbar (tabs + search icon + filter + close, **no "Live"**), search icon toggles a field bound to the feed, the AI summary expands/collapses via its chevron, chips work, cards expand to show actions, "Show N earlier" collapses the read list, "Mark all read" clears unread in scope, the panel is ~80vh, and ~5 unread fit. Also `frontend-design-reviewer` for token/spacing compliance.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/features/notifications/NotificationPopover.vue frontend/src/features/notifications/panel/InboxTab.vue
git commit -m "feat(frontend): condense popover into one toolbar, chevron AI summary, taller panel"
```

---

### Task 6: Lift popover open-state into a store

**Files:**

- Create: `frontend/src/stores/notificationPanel.ts`
- Create: `frontend/src/stores/notificationPanel.spec.ts`
- Modify: `frontend/src/features/notifications/NotificationBell.vue`

**Interfaces:**

- Produces: `useNotificationPanelStore()` → `{ isOpen: Ref<boolean>, open(): void, close(): void, toggle(): void }`. The bell drives its popover off this store (so the toast can `open()` it and read `isOpen` to suppress itself). Bell dismissal/focus behavior (Esc, outside-click, focus-return) is unchanged.

- [ ] **Step 1: Write the failing store test** `notificationPanel.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useNotificationPanelStore } from "./notificationPanel";

describe("notificationPanel store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("opens, closes, and toggles", () => {
    const p = useNotificationPanelStore();
    expect(p.isOpen).toBe(false);
    p.open();
    expect(p.isOpen).toBe(true);
    p.close();
    expect(p.isOpen).toBe(false);
    p.toggle();
    expect(p.isOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- notificationPanel`
      Expected: FAIL (module missing).

- [ ] **Step 3: Create `notificationPanel.ts`:**

```ts
import { ref } from "vue";
import { defineStore } from "pinia";

/**
 * Open-state of the bell popover, lifted out of NotificationBell so other surfaces can
 * drive it — the critical toast opens the panel on "View" and suppresses itself while the
 * panel is already open. Dismissal/focus mechanics stay in the bell.
 */
export const useNotificationPanelStore = defineStore("notificationPanel", () => {
  const isOpen = ref(false);
  function open(): void {
    isOpen.value = true;
  }
  function close(): void {
    isOpen.value = false;
  }
  function toggle(): void {
    isOpen.value = !isOpen.value;
  }
  return { isOpen, open, close, toggle };
});
```

- [ ] **Step 4: Refactor `NotificationBell.vue`** to use the store instead of the local `open` ref. Replace the `<script setup>` with:

```ts
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Bell } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import { useNotificationPanelStore } from "@/stores/notificationPanel";
import NotificationPopover from "./NotificationPopover.vue";

const feed = useFeedStore();
const panel = useNotificationPanelStore();
const root = ref<HTMLElement | null>(null);
const bellButton = ref<HTMLButtonElement | null>(null);

const badge = computed(() => (feed.unreadCount > 9 ? "9+" : String(feed.unreadCount)));

function close(restoreFocus = true) {
  panel.close();
  if (restoreFocus) bellButton.value?.focus();
}
function toggle() {
  panel.toggle();
}

function onDocumentPointer(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close(false);
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close(true);
}

watch(
  () => panel.isOpen,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener("mousedown", onDocumentPointer);
      document.addEventListener("keydown", onKeydown);
    } else {
      document.removeEventListener("mousedown", onDocumentPointer);
      document.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointer);
  document.removeEventListener("keydown", onKeydown);
});
```

In the template, replace `:aria-expanded="open"` with `:aria-expanded="panel.isOpen"` and `<div v-if="open" …>` with `<div v-if="panel.isOpen" …>`. Everything else stays.

- [ ] **Step 5: Run tests.** Run: `pnpm --filter @notifications/frontend test -- "notificationPanel|NotificationBell"`
      Expected: PASS. The existing `NotificationBell.spec.ts` still passes (it drives open via clicking the trigger and asserts `aria-expanded` + the dialog + Esc/outside-click + focus-return — all preserved through the store).

- [ ] **Step 6: Typecheck + lint.** `pnpm typecheck && pnpm lint` → clean.

- [ ] **Step 7: Commit.**

```bash
git add frontend/src/stores/notificationPanel.ts frontend/src/stores/notificationPanel.spec.ts frontend/src/features/notifications/NotificationBell.vue
git commit -m "refactor(frontend): lift bell popover open-state into a store"
```

---

### Task 7: Critical-toast store

**Files:**

- Create: `frontend/src/stores/toast.ts`
- Create: `frontend/src/stores/toast.spec.ts`

**Interfaces:**

- Produces: `useToastStore()` with:
  - `visible: Ref<ToastItem[]>` — the newest up-to-`MAX_VISIBLE` (3) active toasts (oldest→newest).
  - `overflowCount: Ref<number>` — active toasts beyond the visible cap.
  - `pushCritical(items: { id: string; title: string; description?: string; module: string }[]): void` — enqueues each (skips ids already seen, ever), starts a ~6s auto-dismiss timer per toast.
  - `dismiss(id: string): void` — removes a toast + clears its timer.
  - `pause(id: string): void` / `resume(id: string): void` — pause/restart the auto-dismiss timer (hover/focus).
  - `ToastItem = { id: string; title: string; description?: string; module: string }`.
  - Constants exported: `AUTO_DISMISS_MS = 6000`, `MAX_VISIBLE = 3`.

- [ ] **Step 1: Write the failing tests** `toast.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { AUTO_DISMISS_MS, useToastStore } from "./toast";

function crit(id: string) {
  return { id, title: `Critical ${id}`, module: "DSAR" };
}

describe("toast store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("enqueues criticals and auto-dismisses after the timeout", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    expect(t.visible.map((x) => x.id)).toEqual(["a"]);
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible).toEqual([]);
  });

  it("never re-enqueues an id it has already seen", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    t.dismiss("a");
    t.pushCritical([crit("a")]); // same id again
    expect(t.visible).toEqual([]);
  });

  it("caps visible at 3 and reports the overflow count", () => {
    const t = useToastStore();
    t.pushCritical([crit("a"), crit("b"), crit("c"), crit("d")]);
    expect(t.visible.map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(t.overflowCount).toBe(1);
  });

  it("pause stops the auto-dismiss; resume restarts it", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    t.pause("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);
    expect(t.visible.map((x) => x.id)).toEqual(["a"]); // still there
    t.resume("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- toast`
      Expected: FAIL (module missing).

- [ ] **Step 3: Create `toast.ts`:**

```ts
import { computed, ref } from "vue";
import { defineStore } from "pinia";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  module: string;
}

export const AUTO_DISMISS_MS = 6000;
export const MAX_VISIBLE = 3;

/**
 * Queue of active critical-notification toasts. Newest-last. Each active toast carries an
 * auto-dismiss timer (pausable on hover/focus). An id is toasted at most once ever (a
 * duplicate SSE delivery, or re-push, is ignored) so a retry can't re-alert.
 */
export const useToastStore = defineStore("toast", () => {
  const queue = ref<ToastItem[]>([]);
  const seen = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const visible = computed(() => queue.value.slice(-MAX_VISIBLE));
  const overflowCount = computed(() => Math.max(0, queue.value.length - MAX_VISIBLE));

  function startTimer(id: string): void {
    clearTimer(id);
    timers.set(
      id,
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
    );
  }
  function clearTimer(id: string): void {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
  }

  function pushCritical(items: ToastItem[]): void {
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      queue.value = [...queue.value, item];
      startTimer(item.id);
    }
  }

  function dismiss(id: string): void {
    clearTimer(id);
    queue.value = queue.value.filter((t) => t.id !== id);
  }
  function pause(id: string): void {
    clearTimer(id);
  }
  function resume(id: string): void {
    if (queue.value.some((t) => t.id === id)) startTimer(id);
  }

  return { visible, overflowCount, pushCritical, dismiss, pause, resume };
});
```

- [ ] **Step 4: Run to verify it passes.** Run: `pnpm --filter @notifications/frontend test -- toast`
      Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint.** `pnpm typecheck && pnpm lint` → clean.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/stores/toast.ts frontend/src/stores/toast.spec.ts
git commit -m "feat(frontend): critical-toast store (queue, auto-dismiss, pause, cap)"
```

---

### Task 8: Critical-toast components + wiring

**Files:**

- Create: `frontend/src/features/notifications/CriticalToast.vue`
- Create: `frontend/src/features/notifications/CriticalToastViewport.vue`
- Modify: `frontend/src/features/dashboard/DashboardLayout.vue`

**Interfaces:**

- Consumes: `useToastStore()` (Task 7), `useNotificationPanelStore()` (Task 6), `useFeedStore().onLiveCritical` (Task 2); `priorityDotClass` (danger dot); `relativeTime`.
- `CriticalToast` props: `toast: ToastItem`; emits `dismiss: []`, `view: []`; renders the Editorial-Ivory toast (danger dot + mono "Critical" eyebrow, Hanken title, one-line desc, mono `module · time`, `View`/`Dismiss`, quiet countdown hairline); `role="alert"`; pauses timer on hover/focus via store `pause`/`resume`.
- `CriticalToastViewport`: renders the bottom-right stack (`visible` + a "+N earlier critical" chip); on mount subscribes to `feed.onLiveCritical` and pushes to the toast store **only when the panel is closed**; `view` opens the panel and dismisses the toast.

- [ ] **Step 1: Create `CriticalToast.vue`:**

```vue
<script setup lang="ts">
import { useToastStore, type ToastItem } from "@/stores/toast";
import { relativeTime } from "@/lib/time";

const props = defineProps<{ toast: ToastItem }>();
const emit = defineEmits<{ dismiss: []; view: [] }>();
const toasts = useToastStore();
</script>

<template>
  <div
    role="alert"
    class="animate-enter w-[290px] overflow-hidden rounded-lg border border-line-strong bg-surface p-3 shadow-lg shadow-black/10"
    @mouseenter="toasts.pause(props.toast.id)"
    @mouseleave="toasts.resume(props.toast.id)"
    @focusin="toasts.pause(props.toast.id)"
    @focusout="toasts.resume(props.toast.id)"
  >
    <div class="flex items-center gap-2">
      <span class="size-2 shrink-0 rounded-full bg-danger" aria-hidden="true" />
      <span class="font-mono text-[11px] uppercase tracking-wide text-danger">Critical</span>
      <button
        type="button"
        class="ml-auto grid size-6 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
        aria-label="Dismiss notification"
        @click="emit('dismiss')"
      >
        <span aria-hidden="true" class="text-[13px] leading-none">✕</span>
      </button>
    </div>
    <button type="button" class="mt-1.5 block w-full text-left" @click="emit('view')">
      <span class="block text-[13px] font-semibold leading-snug text-text">{{ toast.title }}</span>
      <span v-if="toast.description" class="mt-0.5 block truncate text-[12px] text-muted">
        {{ toast.description }}
      </span>
    </button>
    <div class="mt-1.5 font-mono text-[11px] uppercase tracking-wide text-faint">
      {{ toast.module }} · just now
    </div>
    <div class="mt-2.5 flex items-center gap-2">
      <button
        type="button"
        class="rounded-md border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold text-text transition-colors duration-100 hover:bg-sunken"
        @click="emit('view')"
      >
        View
      </button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-[12px] font-semibold text-muted transition-colors duration-100 hover:text-text"
        @click="emit('dismiss')"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>
```

(The `animate-enter` class is the design system's fade+rise, already defined in `styles/main.css` and used by feed rows; it honors `prefers-reduced-motion` globally. `relativeTime` import is kept for parity if you later show real times; if lint flags it as unused, drop the import and the "just now" stays literal.)

- [ ] **Step 2: Create `CriticalToastViewport.vue`:**

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useToastStore } from "@/stores/toast";
import { useNotificationPanelStore } from "@/stores/notificationPanel";
import { useFeedStore } from "@/stores/feed";
import CriticalToast from "./CriticalToast.vue";

const toasts = useToastStore();
const panel = useNotificationPanelStore();
const feed = useFeedStore();
let off: (() => void) | null = null;

onMounted(() => {
  off = feed.onLiveCritical((items) => {
    // Suppress the toast if the panel is already open — the user is already looking.
    if (panel.isOpen) return;
    toasts.pushCritical(
      items.map((n) => ({
        id: n.id,
        title: n.title,
        description: n.description,
        module: n.module,
      })),
    );
  });
});
onBeforeUnmount(() => off?.());

function view(id: string) {
  toasts.dismiss(id);
  panel.open();
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
    <div
      v-if="toasts.overflowCount > 0"
      class="pointer-events-auto rounded-full border border-line-strong bg-surface px-3 py-1 font-sans text-[11px] font-semibold text-muted shadow-lg shadow-black/5"
    >
      +{{ toasts.overflowCount }} earlier critical
    </div>
    <CriticalToast
      v-for="t in toasts.visible"
      :key="t.id"
      :toast="t"
      class="pointer-events-auto"
      @dismiss="toasts.dismiss(t.id)"
      @view="view(t.id)"
    />
  </div>
</template>
```

- [ ] **Step 3: Mount it in `DashboardLayout.vue`.** Add the import and render it once at the shell root so it shows on any dashboard route. Update the `<script setup>` to import it:

```ts
import CriticalToastViewport from "@/features/notifications/CriticalToastViewport.vue";
```

And add it inside the root `<div class="flex h-screen …">` (after the inner column div, still inside the root):

```html
<CriticalToastViewport />
```

- [ ] **Step 4: Typecheck + lint + unit suite.** Run: `pnpm typecheck && pnpm lint && pnpm --filter @notifications/frontend test` → clean/green.

- [ ] **Step 5: Browser-verify (controller runs `browser-tester`).** With the panel closed, publish a `critical` via `POST /internal/publish` → a toast rises bottom-right, auto-dismisses ~6s (pauses on hover), `View` opens the bell panel, `Dismiss`/✕ hides it (notification still unread). Publish several criticals → they stack, capped at 3 with a "+N earlier critical" chip. Publish a `high` → no toast. Open the panel, publish a critical → no toast (suppressed).

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/features/notifications/CriticalToast.vue frontend/src/features/notifications/CriticalToastViewport.vue frontend/src/features/dashboard/DashboardLayout.vue
git commit -m "feat(frontend): critical-notification toast (bottom-right, stacking, a11y)"
```

---

### Task 9: e2e — card expand + critical toast

**Files:**

- Modify: `frontend/e2e/feed.spec.ts`

**Interfaces:**

- Consumes: the bell (`button` name `/Notifications/`), popover (`dialog` "Notifications"), card title button, `font-normal` read treatment, the critical toast (`role="alert"`), and `POST /internal/publish`.

- [ ] **Step 1: Update the happy-path assertions in `feed.spec.ts`.** The live notification the test publishes is `priority: "high"`, so it lands in "Needs action" as a card. Keep the existing flow (login → open bell → wait "Live"?) — **note:** the "Live" text was removed from the panel in Task 5, so replace the `await expect(page.getByText("Live", { exact: true })).toBeVisible();` gate with a gate on the popover being open and the feed present. Change that line to:

```ts
// The panel is open (SSE connected on dashboard mount); assert the dialog before publishing.
await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
```

The subsequent publish + `getByRole("button", { name: title })` + click → `204` → `toHaveClass(/font-normal/)` all still hold (the title is still a button that flips to `font-normal` when read). Keep the bad-password test unchanged.

- [ ] **Step 2: Add a critical-toast test** to the `notifications dashboard` describe:

```ts
test("shows a bottom-right toast for a critical notification and View opens the panel", async ({
  page,
  request,
}) => {
  const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
  expect(intakeTokenValue).not.toBe("");
  await login(page, DEV_USER, DEV_PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Panel closed: publish a CRITICAL → a toast appears bottom-right.
  const stamp = Date.now();
  const title = `E2E critical ${stamp}`;
  const publish = await request.post(`${BACKEND}/internal/publish`, {
    headers: { "x-internal-token": intakeTokenValue, "content-type": "application/json" },
    data: {
      id: `e2e-crit-${stamp}`,
      module: "e2e",
      title,
      description: "critical via SSE",
      priority: "critical",
      snoozable: true,
      audience: { scope: "global" },
    },
  });
  expect(publish.ok(), `publish failed: ${publish.status()}`).toBeTruthy();

  const toast = page.getByRole("alert").filter({ hasText: title });
  await expect(toast).toBeVisible({ timeout: 10_000 });

  // View opens the bell panel.
  await toast.getByRole("button", { name: "View" }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
});
```

- [ ] **Step 2b: Note the SSE race.** The toast test publishes right after login without gating on a visible "connected" cue (there is none now). The SSE connects on dashboard mount; add a short guard before publishing so the subscription is registered: `await page.getByRole("button", { name: /Notifications/ }).waitFor();` (the bell renders only after the shell + store are mounted). Place it immediately before the publish call.

- [ ] **Step 3: Run the e2e suite.** Run: `pnpm test:e2e` (needs `docker compose up -d`; the Playwright `webServer` reuses the running dev server).
      Expected: PASS (3 tests: updated happy path, new critical toast, bad-password). If the toast test flakes on timing, confirm the bell `waitFor` precedes the publish.

- [ ] **Step 4: Commit.**

```bash
git add frontend/e2e/feed.spec.ts
git commit -m "test(frontend): e2e for card expand + critical toast"
```

---

## Definition of done / review gates

- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @notifications/frontend build` clean; `pnpm test` + `pnpm test:e2e` green.
- `browser-tester` confirms density (~5 unread fit, scroll intact), card expand/actions, collapsed read, mark-all, and the toast (appear/auto-dismiss/pause/stack/suppress-when-open/View); `frontend-design-reviewer` passes on the panel + toast.
- `code-reviewer` after the UI tasks; **`security-reviewer` on the bulk mark-read endpoint** (new authed write).
- `docs/api/notifications.md` updated for the bulk endpoint (api-documentation rule).
- Cross-tenant visibility + mentor heads-up (bell-popover pivot, this density/toast pass, and the new bulk endpoint) still precede the Week-1 PR.

## Self-review (against the spec)

- **Spec coverage:** toolbar/no-Live/80vh → T5; chevron AI summary → T5; chips → unchanged (kept in InboxTab); V1 expandable action cards → T3; read behavior (chevron+body+expand mark read) → T3; collapsed read behind "Show N earlier" → T4; mark-all (scope=visible unread) → T2+T4; bulk endpoint → T1; critical toast look/behavior/stacking/a11y → T7+T8; suppress-when-open + View-opens-panel → T6+T8; SSE→toast wiring → T2+T8; e2e → T9. All mapped.
- **Placeholder scan:** none; AI summary text and toast are intentional stubs, code is complete.
- **Type consistency:** `markAllReadInScope`/`onLiveCritical` (T2) consumed in T4/T8 with matching signatures; `useNotificationPanelStore` `{isOpen,open,close,toggle}` (T6) used in T8 and the bell; `useToastStore` `{visible,overflowCount,pushCritical,dismiss,pause,resume}` + `ToastItem` (T7) used in T8; `FeedList` new `markAll` emit (T4) wired in InboxTab; `feedItem` imported from `@/test-support/feedItem` (created in the prior branch work) across specs.
