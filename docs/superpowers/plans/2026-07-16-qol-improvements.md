# QoL Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four batched QoL fixes — re-readable "Earlier" notifications (+ mark-as-unread), full-body expansion, a "Dev Labs" maintenance panel, and a retention-window setting.

**Architecture:** Issues 1–2 are frontend-only changes to the feed card/list plus one new `DELETE /notifications/:id/read` endpoint. Issue 3 adds a non-prod-only maintenance route group and a Dev Labs panel wrapping the existing generator. Issue 4 adds a `retention_days` column surfaced through the admin settings endpoints, enforced later by Week-5 partitioning.

**Tech Stack:** Frontend — Vue 3 `<script setup>`, Pinia, Tailwind v4, the shared `NotificationCardRenderer`/`FormRenderer`. Backend — Fastify 5, zod, `pg`. Tests — Vitest (backend + frontend), Playwright (e2e).

## Global Constraints

- Branch: `chore/qol-improvements` (already cut from local `main`).
- **Maintenance endpoints are non-prod-only + `requireAdmin`** — register them under the **same `isSimulatorEnabled()` guard** as `simulateRoutes` (absent in production, 404).
- **All SQL parameterized.** No string-concatenated user input; use `$N` placeholders / `make_interval`.
- **Destructive maintenance ops are confirm-gated in the UI** (typed confirmation for delete-all; a simple inline confirm for the rest) and return `{ deleted: number }` (or `{ ok: true }`).
- **Retention is config-only** — no background job; the "delete older than N days" button defaults N to `retention_days`; Week-5 partitioning does automatic enforcement. Interim "read" = any notification with ≥1 `notification_reads` row (global-broadcast stopgap).
- **`retention_days` is admin-only** — surfaced via `/admin/settings`, NOT via the user-facing `/settings/features`.
- Forms via the shared `FormRenderer`; design-system tokens only (no raw Tailwind defaults); TS strict (`any` needs an inline reason).
- `pnpm lint` and `pnpm typecheck` clean before a task is done.
- **Commits:** Conventional Commits. **Never** add "Generated with AI" / "Co-Authored-By: AI" trailers.
- **Docs:** `docs/api/notifications.md` (DELETE read) and `docs/api/admin.md` (maintenance) kept in sync (api-documentation rule).

---

## File Structure

**Backend**

- Modify `backend/src/http/notifications/routes.ts` — add `DELETE /notifications/:id/read`.
- Create `backend/migrations/006_retention_setting.sql` — `retention_days` column.
- Modify `backend/src/pipeline/policy.ts` — load `retention_days`; add `getRetentionDays()`.
- Modify `backend/src/http/admin/routes.ts` — include/accept `retentionDays` in settings GET/PATCH.
- Create `backend/src/http/admin/maintenance.ts` — the maintenance route group.
- Modify `backend/src/server.ts` — register `maintenanceRoutes` under the non-prod guard.

**Frontend**

- Modify `frontend/src/features/notifications/renderers/NotificationCardRenderer.vue` — full-body expand, chevron-on-long-body, mark-as-unread.
- Modify `frontend/src/features/notifications/components/FeedList.vue` — Earlier items render the full card; forward `unread`.
- Modify `frontend/src/features/notifications/panel/InboxTab.vue` — wire `unread` → `feed.markUnread`.
- Modify `frontend/src/stores/feed.ts` — add `markUnread(id)`.
- Modify `frontend/src/features/admin/adminApi.ts` — settings + maintenance calls.
- Create `frontend/src/features/admin/DevLabsPanel.vue` — Generate | Maintenance toggle.
- Create `frontend/src/features/admin/MaintenancePanel.vue` — destructive ops + retention input.
- Modify `frontend/src/features/admin/AdminView.vue` — rename item to "Dev Labs", render `DevLabsPanel`.

---

### Task 1: `DELETE /notifications/:id/read` (backend)

**Files:**

- Modify: `backend/src/http/notifications/routes.ts`
- Test: `backend/test/notifications.test.ts`
- Docs: `docs/api/notifications.md`

**Interfaces:**

- Produces: `DELETE /notifications/:id/read` — `requireUser`, removes the caller's read row, `204` always (idempotent — deleting a non-existent read row is a no-op).

- [ ] **Step 1: Write the failing test**

Add to `backend/test/notifications.test.ts` (reuse the suite's existing `app`/login/seed helpers; place inside the same top-level describe that already tests the read endpoints):

```ts
it("DELETE /notifications/:id/read clears the read flag and is idempotent", async () => {
  const cookie = await login(); // existing helper in this suite
  const id = seededNotificationId; // an id this suite already inserts (reuse an existing fixture id)

  await app.inject({ method: "POST", url: `/notifications/${id}/read`, headers: { cookie } });
  const del1 = await app.inject({
    method: "DELETE",
    url: `/notifications/${id}/read`,
    headers: { cookie },
  });
  expect(del1.statusCode).toBe(204);

  const list = await app.inject({
    method: "GET",
    url: "/notifications?limit=100",
    headers: { cookie },
  });
  const row = (list.json().items as { id: string; read: boolean }[]).find((n) => n.id === id);
  expect(row?.read).toBe(false);

  // Idempotent: deleting again is still 204.
  const del2 = await app.inject({
    method: "DELETE",
    url: `/notifications/${id}/read`,
    headers: { cookie },
  });
  expect(del2.statusCode).toBe(204);
});

it("DELETE /notifications/:id/read requires auth", async () => {
  const res = await app.inject({ method: "DELETE", url: "/notifications/whatever/read" });
  expect(res.statusCode).toBe(401);
});
```

> Note for the implementer: match `login()` / the seeded fixture id to whatever `backend/test/notifications.test.ts` already sets up (it seeds notifications and logs in a user). Use an existing seeded id rather than inventing one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @notifications/backend test notifications`
Expected: FAIL — DELETE route returns 404 (no handler).

- [ ] **Step 3: Add the handler**

In `backend/src/http/notifications/routes.ts`, after the `POST /notifications/:id/read` handler, add:

```ts
/**
 * Undo a read for the current user: `DELETE /notifications/:id/read`. Removes this user's
 * row from notification_reads so the notification returns to "Needs action". Idempotent —
 * deleting a row that isn't there is a no-op. Per-user; never touches another user's state.
 * Returns 204.
 */
app.delete("/notifications/:id/read", { preHandler: requireUser }, async (req, reply) => {
  const user = req.user;
  if (!user) return reply.code(401).send({ error: "authentication required" });

  const parsed = readParamsSchema.safeParse(req.params);
  if (!parsed.success) return reply.code(400).send({ error: "invalid notification id" });

  await query("DELETE FROM notification_reads WHERE user_id = $1 AND notification_id = $2", [
    user.id,
    parsed.data.id,
  ]);
  return reply.code(204).send();
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @notifications/backend test notifications`
Expected: PASS.

- [ ] **Step 5: Update the API doc**

Dispatch the **docs-writer** subagent to add the `DELETE /notifications/:id/read` entry to `docs/api/notifications.md` alongside the existing read endpoints: `requireUser`, removes the caller's read row, idempotent, `204`, per-user.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @notifications/backend typecheck` → clean.

```bash
git add backend/src/http/notifications/routes.ts backend/test/notifications.test.ts docs/api/notifications.md
git commit -m "feat(notifications): DELETE /notifications/:id/read to undo a read"
```

---

### Task 2: `markUnread` in the feed store (frontend)

**Files:**

- Modify: `frontend/src/stores/feed.ts`
- Test: `frontend/src/stores/feed.spec.ts`

**Interfaces:**

- Consumes: `DELETE /notifications/:id/read` (Task 1); the existing `setRead(id, read)` and `api` from `@/api/client`.
- Produces: `markUnread(id: string): Promise<void>` on the store — optimistic un-read, reverts on failure, no-op if unknown or already unread. Exported in the store's return object.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/stores/feed.spec.ts` (follow the file's existing pattern for mocking `@/api/client` and seeding items):

```ts
it("markUnread optimistically un-reads and reverts on failure", async () => {
  const store = useFeedStore();
  // Seed one read item (reuse the spec's existing seeding approach).
  store.items = [feedItem({ id: "r1", read: true })];

  deleteMock.mockResolvedValueOnce(undefined);
  await store.markUnread("r1");
  expect(store.items.find((n) => n.id === "r1")?.read).toBe(false);
  expect(deleteMock).toHaveBeenCalledWith("/notifications/r1/read");

  // Failure path: put it back to read, attempt, expect revert to read.
  store.items = [feedItem({ id: "r2", read: true })];
  deleteMock.mockRejectedValueOnce(new Error("network"));
  await store.markUnread("r2");
  expect(store.items.find((n) => n.id === "r2")?.read).toBe(true);
});
```

> Implementer: `feed.spec.ts` already mocks `@/api/client`. Extend that mock to expose a `del`/`delete` fn as `deleteMock` (the client exposes `api.get/post/patch` today — see Step 3, which adds `api.del`). Seed items the same way the existing tests do (`store.items = [...]` or the store's load path).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @notifications/frontend test -- feed`
Expected: FAIL — `markUnread` is not a function.

- [ ] **Step 3: Add `api.del` to the client**

The client (`frontend/src/api/client.ts`) has no DELETE helper. Add one next to `patch`:

```ts
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
```

- [ ] **Step 4: Add `markUnread` to the store**

In `frontend/src/stores/feed.ts`, after `markRead`, add:

```ts
/**
 * Undo a read for this user (mirror of markRead). Optimistic: flip to unread locally
 * (the row moves back to "Needs action"), then persist the delete; revert on failure.
 * No-op if unknown or already unread.
 */
async function markUnread(id: string): Promise<void> {
  const target = items.value.find((n) => n.id === id);
  if (!target || !target.read) return;
  setRead(id, false);
  try {
    await api.del(`/notifications/${encodeURIComponent(id)}/read`);
  } catch {
    setRead(id, true); // revert — the server didn't clear it
    console.warn(`[feed] failed to mark ${id} unread; reverted`);
  }
}
```

Add `markUnread` to the store's `return { ... }` object, in the `// actions` group next to `markRead`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @notifications/frontend test -- feed`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @notifications/frontend typecheck` → clean.

```bash
git add frontend/src/stores/feed.ts frontend/src/api/client.ts frontend/src/stores/feed.spec.ts
git commit -m "feat(feed): markUnread store action + api.del helper"
```

---

### Task 3: Card renderer — full-body expand + mark-as-unread (frontend)

**Files:**

- Modify: `frontend/src/features/notifications/renderers/NotificationCardRenderer.vue`
- Test: `frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts`

**Interfaces:**

- Produces: the card now emits `unread: [notification: FeedNotification]` (in addition to `open`/`action`); the expand toggle reveals the full body; the chevron shows when `hasActions || isLongBody` (`isLongBody` = description length > 140).

- [ ] **Step 1: Write the failing tests**

Add to `NotificationCardRenderer.spec.ts`:

```ts
const LONG = "x".repeat(200);

it("shows an expand chevron for a long body even without actions, and reveals the full body", async () => {
  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "a", description: LONG }) },
  });
  const chevron = wrapper.get('[aria-label="Show details"]');
  const body = wrapper.get('[data-test="card-body"]');
  expect(body.classes()).toContain("truncate"); // collapsed
  await chevron.trigger("click");
  expect(body.classes()).not.toContain("truncate"); // expanded reveals full text
});

it("offers Mark as unread only on a read card and emits unread", async () => {
  const unread = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "a" }) },
  });
  expect(unread.find('[data-test="mark-unread"]').exists()).toBe(false); // unread item: no control

  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "b", read: true }) },
  });
  await wrapper.get('[data-test="mark-unread"]').trigger("click");
  expect(wrapper.emitted("unread")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @notifications/frontend test -- NotificationCardRenderer`
Expected: FAIL — no `Show details` chevron, no `card-body` test id, no `mark-unread`.

- [ ] **Step 3: Update the script block**

In `NotificationCardRenderer.vue`, add the `unread` emit, `isLongBody`, and the combined expand predicate:

```ts
const emit = defineEmits<{
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
  unread: [notification: FeedNotification];
}>();

const item = computed(() => props.notification);
const hasActions = computed(() => (item.value.actions?.length ?? 0) > 0);
// A long body gets an expand affordance even with no actions (single-line truncate hides it).
const isLongBody = computed(() => (item.value.description?.length ?? 0) > 140);
const canExpand = computed(() => hasActions.value || isLongBody.value);
const expanded = ref(false);
```

Add an emit helper next to `open`:

```ts
function markUnread() {
  emit("unread", item.value);
}
```

- [ ] **Step 4: Update the template**

Make the body toggle truncation on `expanded`, add a `data-test`, and make the chevron use `canExpand` with a label that stays "Show/Hide actions" when there are actions (keeps existing tests valid) and "Show/Hide details" otherwise:

```html
<p
  v-if="item.description"
  data-test="card-body"
  class="mt-0.5 text-[13px] leading-relaxed text-muted"
  :class="expanded ? 'whitespace-pre-line break-words' : 'truncate'"
>
  {{ item.description }}
</p>
```

Replace the chevron button's guard and label:

```html
<button
  v-if="canExpand"
  type="button"
  class="mt-0.5 grid size-6 shrink-0 place-items-center self-start rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
  :aria-label="
          expanded
            ? hasActions
              ? 'Hide actions'
              : 'Hide details'
            : hasActions
              ? 'Show actions'
              : 'Show details'
        "
  :aria-expanded="expanded"
  @click.stop="toggleExpand"
>
  <Icon
    :icon="ChevronDown"
    :size="15"
    :class="expanded ? 'rotate-180 transition-transform' : 'transition-transform'"
  />
</button>
```

Add a "Mark as unread" control in the meta row (only when read). Change the meta `<div>` to include it:

```html
<div class="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
  <span class="font-mono uppercase tracking-wide">{{ item.module }}</span>
  <template v-if="item.category">
    <span aria-hidden="true">·</span>
    <span>{{ item.category }}</span>
  </template>
  <button
    v-if="item.read"
    type="button"
    data-test="mark-unread"
    class="ml-auto font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:text-text"
    @click.stop="markUnread"
  >
    Mark as unread
  </button>
</div>
```

Keep the existing expanded-actions block (`v-if="expanded && hasActions"`) unchanged — it now coexists with the body expansion under the same toggle.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- NotificationCardRenderer`
Expected: PASS (existing 4 tests + 2 new). The existing "no chevron without actions" test still passes because `feedItem`'s default description is `""` (`isLongBody` false).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @notifications/frontend typecheck` → clean.

```bash
git add frontend/src/features/notifications/renderers/NotificationCardRenderer.vue frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts
git commit -m "feat(feed): expand reveals full body; mark-as-unread on read cards"
```

---

### Task 4: Earlier uses the full card + wire unread (frontend)

**Files:**

- Modify: `frontend/src/features/notifications/components/FeedList.vue`
- Modify: `frontend/src/features/notifications/panel/InboxTab.vue`
- Test: `frontend/src/features/notifications/components/FeedList.spec.ts`

**Interfaces:**

- Consumes: `NotificationCardRenderer` (Task 3, `unread` emit); `feed.markUnread` (Task 2).
- Produces: `FeedList` renders Earlier items with `NotificationCardRenderer` and re-emits `unread`; `InboxTab` handles `unread`.

- [ ] **Step 1: Write the failing test**

Add to `FeedList.spec.ts`:

```ts
it("renders earlier items with the full card and re-emits unread", async () => {
  const wrapper = mount(FeedList, { props: { groups, hasMore: false, loadingMore: false } });
  await wrapper.get('[data-test="show-earlier"]').trigger("click");
  const list = wrapper.get('[data-test="earlier-list"]');
  // The read cards expose the mark-unread control (proves the full card, not the stripped row).
  const markUnread = list.get('[data-test="mark-unread"]');
  await markUnread.trigger("click");
  expect(wrapper.emitted("unread")).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @notifications/frontend test -- FeedList`
Expected: FAIL — the stripped earlier row has no `mark-unread`, and FeedList doesn't emit `unread`.

- [ ] **Step 3: Add the `unread` emit + render Earlier with the card**

In `FeedList.vue`, add `unread` to the emits:

```ts
const emit = defineEmits<{
  loadMore: [];
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
  unread: [notification: FeedNotification];
  markAll: [];
}>();
```

Replace the Earlier `<div v-if="showEarlier" data-test="earlier-list">…</div>` block's stripped `<button>` rows with the full card (keep the `data-test="earlier-list"` wrapper and the toggle above it unchanged):

```html
<div v-if="showEarlier" data-test="earlier-list">
  <NotificationCardRenderer
    v-for="n in earlier.items"
    :key="n.id"
    :notification="n"
    @open="(x) => emit('open', x)"
    @action="(a, x) => emit('action', a, x)"
    @unread="(x) => emit('unread', x)"
  />
</div>
```

Also forward `unread` from the needs-action list's cards (harmless there — those items are unread, so the control is hidden — but keeps the wiring uniform):

```html
<NotificationCardRenderer
  v-for="n in needsAction.items"
  :key="n.id"
  :notification="n"
  @open="(x) => emit('open', x)"
  @action="(a, x) => emit('action', a, x)"
  @unread="(x) => emit('unread', x)"
/>
```

Remove the now-unused imports (`relativeTime`, `priorityDotClass`, `priorityLabel`) **only if** nothing else in the file uses them after this change — check before deleting; the needs-action header still uses none of the row-level ones, but verify with the file.

- [ ] **Step 4: Wire `unread` in InboxTab**

In `frontend/src/features/notifications/panel/InboxTab.vue`, add the handler to the `<FeedList>` usage:

```html
@open="(n) => feed.markRead(n.id)" @action="onAction" @unread="(n) => feed.markUnread(n.id)"
@mark-all="feed.markAllReadInScope()"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- FeedList`
Expected: PASS. Then `pnpm --filter @notifications/frontend test` — full suite green (existing FeedList/InboxTab tests still pass; the earlier-list wrapper and toggle are unchanged).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @notifications/frontend typecheck` → clean.

```bash
git add frontend/src/features/notifications/components/FeedList.vue frontend/src/features/notifications/panel/InboxTab.vue frontend/src/features/notifications/components/FeedList.spec.ts
git commit -m "feat(feed): Earlier notifications render the full re-readable card"
```

---

### Task 5: Retention setting — migration + admin settings (backend)

**Files:**

- Create: `backend/migrations/006_retention_setting.sql`
- Modify: `backend/src/pipeline/policy.ts`
- Modify: `backend/src/http/admin/routes.ts`
- Test: `backend/test/admin.test.ts`

**Interfaces:**

- Produces: `global_settings.retention_days` (int, default 30); `getRetentionDays(): Promise<number>` in `policy.ts`; `GET /admin/settings` returns `{ ...flags, retentionDays }`; `PATCH /admin/settings` accepts `retentionDays` (positive int).

- [ ] **Step 1: Write the migration**

Create `backend/migrations/006_retention_setting.sql`:

```sql
-- Retention window (days) for the notifications table. CONFIG ONLY for now: nothing enforces
-- it automatically yet. Week-5 range-partitioning will drop partitions older than this value;
-- meanwhile the Dev Labs "delete older than N days" maintenance action defaults N to it.
ALTER TABLE global_settings ADD COLUMN retention_days integer NOT NULL DEFAULT 30;
```

- [ ] **Step 2: Write the failing test**

Add to `backend/test/admin.test.ts` (reuse the suite's `app`, `login`, admin cookie):

```ts
it("exposes and updates retention_days via /admin/settings", async () => {
  const cookie = await login("t_admin"); // existing admin login helper in this suite

  const get1 = await app.inject({ method: "GET", url: "/admin/settings", headers: { cookie } });
  expect(get1.json().retentionDays).toBe(30); // migration default

  const patch = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    headers: { cookie },
    payload: { retentionDays: 14 },
  });
  expect(patch.statusCode).toBe(204);

  const get2 = await app.inject({ method: "GET", url: "/admin/settings", headers: { cookie } });
  expect(get2.json().retentionDays).toBe(14);
});

it("rejects a non-positive retention_days", async () => {
  const cookie = await login("t_admin");
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    headers: { cookie },
    payload: { retentionDays: 0 },
  });
  expect(res.statusCode).toBe(400);
});
```

> Implementer: reset `retention_days` back to 30 in this suite's cleanup if other tests assert the default (mirror how the suite already resets global_settings, if it does).

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @notifications/backend migrate && pnpm --filter @notifications/backend test admin`
Expected: FAIL — `retentionDays` is `undefined` in the response; the 0 case is accepted (no validation yet).

- [ ] **Step 4: Load retention in `policy.ts`**

In `backend/src/pipeline/policy.ts`: add `retentionDays` to `PolicyState`, the settings SELECT, and the mapping; export `getRetentionDays`.

```ts
interface PolicyState {
  disabledModules: Set<string>;
  flags: FeatureFlags;
  retentionDays: number;
}
```

In `load()`, widen the settings row type and SELECT, and return `retentionDays`:

```ts
const settings = await query<{
  ai_summary_enabled: boolean;
  chatbot_enabled: boolean;
  grouping_enabled: boolean;
  actions_enabled: boolean;
  retention_days: number;
}>(
  `SELECT ai_summary_enabled, chatbot_enabled, grouping_enabled, actions_enabled, retention_days
       FROM global_settings WHERE id = true`,
);
const s = settings.rows[0];
return {
  disabledModules: new Set(disabled.rows.map((r) => r.key)),
  flags: {
    aiSummaryEnabled: s?.ai_summary_enabled ?? true,
    chatbotEnabled: s?.chatbot_enabled ?? true,
    groupingEnabled: s?.grouping_enabled ?? true,
    actionsEnabled: s?.actions_enabled ?? true,
  },
  retentionDays: s?.retention_days ?? 30,
};
```

Add the accessor (leave `getFeatureFlags` unchanged so `/settings/features` stays booleans-only):

```ts
export async function getRetentionDays(): Promise<number> {
  return (await get()).retentionDays;
}
```

- [ ] **Step 5: Extend the admin settings endpoints**

In `backend/src/http/admin/routes.ts`: import `getRetentionDays`, add `retentionDays` to the PATCH schema, include it in the GET response, and add it to the column map.

```ts
import { getFeatureFlags, getRetentionDays, invalidatePolicyCache } from "../../pipeline/policy";
```

```ts
const settingsPatchSchema = z
  .object({
    aiSummaryEnabled: z.boolean().optional(),
    chatbotEnabled: z.boolean().optional(),
    groupingEnabled: z.boolean().optional(),
    actionsEnabled: z.boolean().optional(),
    retentionDays: z.number().int().positive().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "no fields to update");
```

GET handler:

```ts
app.get("/admin/settings", { preHandler: requireAdmin }, async (_req, reply) => {
  return reply
    .code(200)
    .send({ ...(await getFeatureFlags()), retentionDays: await getRetentionDays() });
});
```

PATCH handler — add the column mapping and widen the value cast to allow a number:

```ts
const map: Record<string, string> = {
  aiSummaryEnabled: "ai_summary_enabled",
  chatbotEnabled: "chatbot_enabled",
  groupingEnabled: "grouping_enabled",
  actionsEnabled: "actions_enabled",
  retentionDays: "retention_days",
};
const sets: string[] = [];
const vals: unknown[] = [];
for (const [k, col] of Object.entries(map)) {
  const v = (body.data as Record<string, boolean | number | undefined>)[k];
  if (v !== undefined) {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/backend test admin`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @notifications/backend typecheck` → clean.

```bash
git add backend/migrations/006_retention_setting.sql backend/src/pipeline/policy.ts backend/src/http/admin/routes.ts backend/test/admin.test.ts
git commit -m "feat(admin): retention_days setting (migration 006 + settings GET/PATCH)"
```

---

### Task 6: Maintenance endpoints (backend)

**Files:**

- Create: `backend/src/http/admin/maintenance.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/maintenance.test.ts`
- Docs: `docs/api/admin.md`

**Interfaces:**

- Consumes: `requireAdmin`, `query`, `invalidatePolicyCache`, `isSimulatorEnabled` (from `server.ts`).
- Produces: `maintenanceRoutes(app)` plugin with `POST /admin/maintenance/{notifications/delete-all, notifications/delete-read, notifications/delete-older-than, modules/reset, settings/reset}`. Each `requireAdmin`; the notification/module deletes return `{ deleted: number }`; settings-reset returns `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/maintenance.test.ts` (mirror the `simulate.test.ts` setup: `migrate()`, seed an admin + a plain user, `buildServer()`):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { ingest } from "../src/pipeline/ingest";
import { invalidatePolicyCache } from "../src/pipeline/policy";
import { buildServer } from "../src/server";

const PW = "maint-test-pass";

describe("POST /admin/maintenance", () => {
  let app: FastifyInstance;

  async function login(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: PW },
    });
    const raw = res.headers["set-cookie"];
    const c = Array.isArray(raw) ? raw[0] : raw;
    return (c ?? "").split(";")[0] ?? "";
  }

  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM users WHERE username IN ('m_admin', 'm_plain')");
    await query(
      "INSERT INTO roles (key, label) VALUES ('admin', 'Administrator') ON CONFLICT (key) DO NOTHING",
    );
    const hash = await hashPassword(PW);
    const admin = await query<{ id: string }>(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('m_admin','M Admin',$1) RETURNING id",
      [hash],
    );
    await query("INSERT INTO user_roles (user_id, role_key) VALUES ($1,'admin')", [
      admin.rows[0]!.id,
    ]);
    await query(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('m_plain','M Plain',$1)",
      [hash],
    );
    invalidatePolicyCache();
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it("delete-all removes every notification and requires admin", async () => {
    await ingest({
      id: `maint-${Date.now()}-1`,
      module: "maint",
      title: "a",
      description: "",
      priority: "low",
      snoozable: true,
      audience: { scope: "global" },
    });
    const anon = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-all",
    });
    expect(anon.statusCode).toBe(401);
    const plain = await login("m_plain");
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-all",
      headers: { cookie: plain },
    });
    expect(forbidden.statusCode).toBe(403);
    const cookie = await login("m_admin");
    const res = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-all",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
    const count = await query<{ c: string }>("SELECT count(*) AS c FROM notifications");
    expect(Number(count.rows[0]!.c)).toBe(0);
  });

  it("delete-older-than validates days and deletes by age", async () => {
    const cookie = await login("m_admin");
    const bad = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-older-than",
      headers: { cookie },
      payload: { days: 0 },
    });
    expect(bad.statusCode).toBe(400);
    // Insert a row and backdate it.
    const id = `old-${Date.now()}`;
    await ingest({
      id,
      module: "maint",
      title: "old",
      description: "",
      priority: "low",
      snoozable: true,
      audience: { scope: "global" },
    });
    await query("UPDATE notifications SET created_at = now() - interval '10 days' WHERE id = $1", [
      id,
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-older-than",
      headers: { cookie },
      payload: { days: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
    const gone = await query("SELECT 1 FROM notifications WHERE id = $1", [id]);
    expect(gone.rowCount).toBe(0);
  });

  it("modules/reset clears discovered modules; settings/reset restores defaults", async () => {
    const cookie = await login("m_admin");
    await query(
      "INSERT INTO modules (key, label, enabled) VALUES ('maint-mod','Maint',false) ON CONFLICT (key) DO NOTHING",
    );
    const rm = await app.inject({
      method: "POST",
      url: "/admin/maintenance/modules/reset",
      headers: { cookie },
    });
    expect(rm.statusCode).toBe(200);
    expect((await query("SELECT 1 FROM modules")).rowCount).toBe(0);

    await query(
      "UPDATE global_settings SET ai_summary_enabled = false, retention_days = 99 WHERE id = true",
    );
    const rs = await app.inject({
      method: "POST",
      url: "/admin/maintenance/settings/reset",
      headers: { cookie },
    });
    expect(rs.statusCode).toBe(200);
    const s = await query<{ ai_summary_enabled: boolean; retention_days: number }>(
      "SELECT ai_summary_enabled, retention_days FROM global_settings WHERE id = true",
    );
    expect(s.rows[0]!.ai_summary_enabled).toBe(true);
    expect(s.rows[0]!.retention_days).toBe(30);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @notifications/backend test maintenance`
Expected: FAIL — routes not found (404 → assertions fail).

- [ ] **Step 3: Write the route plugin**

Create `backend/src/http/admin/maintenance.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/guards";
import { query } from "../../db/pool";
import { invalidatePolicyCache } from "../../pipeline/policy";

/**
 * Dev/QA database maintenance (POST /admin/maintenance/*). Registered only in non-production
 * (see server.ts isSimulatorEnabled) alongside the generator. All routes are requireAdmin and
 * destructive; each returns the affected row count. SQL is parameterized throughout.
 */

const olderThanSchema = z.object({ days: z.number().int().positive() });

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/admin/maintenance/notifications/delete-all",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      // notification_reads has ON DELETE CASCADE (migration 003), so reads go with the rows.
      const res = await query("DELETE FROM notifications");
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/notifications/delete-read",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      const res = await query(
        "DELETE FROM notifications WHERE id IN (SELECT notification_id FROM notification_reads)",
      );
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/notifications/delete-older-than",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = olderThanSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
      const res = await query(
        "DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1)",
        [parsed.data.days],
      );
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/modules/reset",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      const res = await query("DELETE FROM modules");
      invalidatePolicyCache();
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/settings/reset",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      await query(
        `UPDATE global_settings
          SET ai_summary_enabled = true, chatbot_enabled = true, grouping_enabled = true,
              actions_enabled = true, retention_days = 30, updated_at = now()
        WHERE id = true`,
      );
      invalidatePolicyCache();
      return reply.code(200).send({ ok: true });
    },
  );
}
```

- [ ] **Step 4: Register under the non-prod guard**

In `backend/src/server.ts`, import and register alongside the simulator:

```ts
import { maintenanceRoutes } from "./http/admin/maintenance";
```

```ts
await app.register(adminRoutes);
if (isSimulatorEnabled()) {
  await app.register(simulateRoutes);
  await app.register(maintenanceRoutes);
}
await app.register(sseRoutes);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/backend test maintenance`
Expected: PASS. Then `pnpm --filter @notifications/backend test` — full backend suite green.

- [ ] **Step 6: Update the API doc**

Dispatch the **docs-writer** subagent to add a `## Maintenance (dev/QA)` section to `docs/api/admin.md` documenting the five endpoints: non-prod-only + `requireAdmin`, request/response shapes (`delete-older-than` takes `{ days }`; deletes return `{ deleted }`; settings-reset returns `{ ok: true }`), the delete-read semantics (any notification read by anyone), and that modules-reset/settings-reset invalidate the policy cache.

- [ ] **Step 7: Typecheck + lint + commit**

Run: `pnpm --filter @notifications/backend typecheck && pnpm lint` → clean.

```bash
git add backend/src/http/admin/maintenance.ts backend/src/server.ts backend/test/maintenance.test.ts docs/api/admin.md
git commit -m "feat(admin): non-prod maintenance endpoints (delete/reset ops)"
```

---

### Task 7: Dev Labs panel + Maintenance UI (frontend)

**Files:**

- Modify: `frontend/src/features/admin/adminApi.ts`
- Create: `frontend/src/features/admin/DevLabsPanel.vue`
- Create: `frontend/src/features/admin/MaintenancePanel.vue`
- Modify: `frontend/src/features/admin/AdminView.vue`
- Test: `frontend/src/features/admin/MaintenancePanel.spec.ts`, `frontend/src/features/admin/AdminView.spec.ts`

**Interfaces:**

- Consumes: maintenance + settings endpoints (Tasks 5–6); the existing `GeneratorPanel`.
- Produces: `adminApi` maintenance/settings calls; `DevLabsPanel` (Generate | Maintenance toggle); `MaintenancePanel` (confirm-gated ops + retention input); AdminView item renamed "Dev Labs".

- [ ] **Step 1: Add API calls**

Append to `frontend/src/features/admin/adminApi.ts`:

```ts
export interface AdminSettings {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
  retentionDays: number;
}
export interface DeleteResult {
  deleted: number;
}

export function getAdminSettings(): Promise<AdminSettings> {
  return api.get<AdminSettings>("/admin/settings");
}
export function patchAdminSettings(body: Partial<AdminSettings>): Promise<void> {
  return api.patch<void>("/admin/settings", body);
}
export function deleteAllNotifications(): Promise<DeleteResult> {
  return api.post<DeleteResult>("/admin/maintenance/notifications/delete-all");
}
export function deleteReadNotifications(): Promise<DeleteResult> {
  return api.post<DeleteResult>("/admin/maintenance/notifications/delete-read");
}
export function deleteNotificationsOlderThan(days: number): Promise<DeleteResult> {
  return api.post<DeleteResult>("/admin/maintenance/notifications/delete-older-than", { days });
}
export function resetModules(): Promise<DeleteResult> {
  return api.post<DeleteResult>("/admin/maintenance/modules/reset");
}
export function resetSettings(): Promise<{ ok: true }> {
  return api.post<{ ok: true }>("/admin/maintenance/settings/reset");
}
```

- [ ] **Step 2: Write the failing MaintenancePanel test**

Create `frontend/src/features/admin/MaintenancePanel.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  patchAdminSettings: vi.fn(),
  deleteAllNotifications: vi.fn(),
  deleteReadNotifications: vi.fn(),
  deleteNotificationsOlderThan: vi.fn(),
  resetModules: vi.fn(),
  resetSettings: vi.fn(),
}));
vi.mock("./adminApi", () => mocks);
const { default: MaintenancePanel } = await import("./MaintenancePanel.vue");

describe("MaintenancePanel", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getAdminSettings.mockResolvedValue({
      aiSummaryEnabled: true,
      chatbotEnabled: true,
      groupingEnabled: true,
      actionsEnabled: true,
      retentionDays: 30,
    });
    mocks.deleteReadNotifications.mockResolvedValue({ deleted: 7 });
    mocks.deleteAllNotifications.mockResolvedValue({ deleted: 12 });
  });

  it("runs a simple-confirm op (delete-read) after confirmation and shows the count", async () => {
    const w = mount(MaintenancePanel);
    await flushPromises();
    await w.get('[data-test="op-delete-read"]').trigger("click"); // reveals inline confirm
    await w.get('[data-test="op-delete-read-confirm"]').trigger("click");
    await flushPromises();
    expect(mocks.deleteReadNotifications).toHaveBeenCalledOnce();
    expect(w.text()).toContain("Deleted 7");
  });

  it("gates delete-all behind a typed confirmation", async () => {
    const w = mount(MaintenancePanel);
    await flushPromises();
    await w.get('[data-test="op-delete-all"]').trigger("click");
    const confirmBtn = w.get('[data-test="op-delete-all-confirm"]');
    expect(confirmBtn.attributes("disabled")).toBeDefined(); // disabled until the word is typed
    await w.get('[data-test="op-delete-all-input"]').setValue("DELETE");
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(mocks.deleteAllNotifications).toHaveBeenCalledOnce();
    expect(w.text()).toContain("Deleted 12");
  });

  it("saves the retention window", async () => {
    mocks.patchAdminSettings.mockResolvedValue(undefined);
    const w = mount(MaintenancePanel);
    await flushPromises();
    await w.get('[data-test="retention-input"]').setValue("14");
    await w.get('[data-test="retention-save"]').trigger("click");
    await flushPromises();
    expect(mocks.patchAdminSettings).toHaveBeenCalledWith({ retentionDays: 14 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @notifications/frontend test -- MaintenancePanel`
Expected: FAIL — `MaintenancePanel.vue` does not exist.

- [ ] **Step 4: Create `MaintenancePanel.vue`**

```vue
<!-- frontend/src/features/admin/MaintenancePanel.vue -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError } from "@/api/client";
import Button from "@/components/ui/Button.vue";
import {
  deleteAllNotifications,
  deleteNotificationsOlderThan,
  deleteReadNotifications,
  getAdminSettings,
  patchAdminSettings,
  resetModules,
  resetSettings,
} from "./adminApi";

const busy = ref(false);
const message = ref<string | null>(null);
const error = ref<string | null>(null);

// Which op currently has its inline confirm open (null = none).
const confirming = ref<string | null>(null);
const deleteAllText = ref("");
const olderThanDays = ref(30);
const retentionDays = ref(30);

onMounted(async () => {
  try {
    const s = await getAdminSettings();
    retentionDays.value = s.retentionDays;
    olderThanDays.value = s.retentionDays; // "delete older than N" defaults to the retention window
  } catch {
    // leave defaults
  }
});

async function run(
  label: string,
  fn: () => Promise<{ deleted?: number } | { ok: true }>,
): Promise<void> {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await fn();
    const deleted = "deleted" in res ? res.deleted : undefined;
    message.value = deleted === undefined ? `${label} done` : `Deleted ${deleted}`;
    confirming.value = null;
    deleteAllText.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Operation failed.";
  } finally {
    busy.value = false;
  }
}

async function saveRetention(): Promise<void> {
  await run("Saved", async () => {
    await patchAdminSettings({ retentionDays: Number(retentionDays.value) });
    return { ok: true } as const;
  });
}
</script>

<template>
  <section class="flex flex-col gap-5">
    <div>
      <h3 class="font-display text-[14px] font-medium text-text">Maintenance</h3>
      <p class="mt-0.5 text-[12px] text-muted">
        Destructive, dev/QA only. These run immediately against the real database.
      </p>
    </div>

    <!-- Delete read -->
    <div class="flex items-center gap-3 border-b border-line pb-4">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Delete read ("Earlier")</div>
        <div class="text-[11px] text-faint">Removes every notification anyone has read.</div>
      </div>
      <template v-if="confirming === 'delete-read'">
        <Button variant="secondary" size="sm" @click="confirming = null">Cancel</Button>
        <Button
          size="sm"
          data-test="op-delete-read-confirm"
          :disabled="busy"
          @click="run('Deleted', deleteReadNotifications)"
          >Confirm</Button
        >
      </template>
      <Button
        v-else
        variant="secondary"
        size="sm"
        data-test="op-delete-read"
        @click="confirming = 'delete-read'"
        >Delete read</Button
      >
    </div>

    <!-- Delete older than N -->
    <div class="flex items-center gap-3 border-b border-line pb-4">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Delete older than</div>
        <div class="text-[11px] text-faint">Defaults to the retention window.</div>
      </div>
      <input
        v-model.number="olderThanDays"
        type="number"
        min="1"
        data-test="older-than-input"
        class="w-16 rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] tabular-nums text-text"
      />
      <span class="text-[12px] text-muted">days</span>
      <Button
        variant="secondary"
        size="sm"
        data-test="op-older-than"
        :disabled="busy"
        @click="run('Deleted', () => deleteNotificationsOlderThan(Number(olderThanDays)))"
        >Delete</Button
      >
    </div>

    <!-- Reset modules / settings -->
    <div class="flex items-center gap-3 border-b border-line pb-4">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Reset</div>
        <div class="text-[11px] text-faint">
          Clear discovered modules or restore feature defaults.
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        data-test="op-reset-modules"
        :disabled="busy"
        @click="run('Reset', resetModules)"
        >Reset modules</Button
      >
      <Button
        variant="secondary"
        size="sm"
        data-test="op-reset-settings"
        :disabled="busy"
        @click="run('Reset', resetSettings)"
        >Reset settings</Button
      >
    </div>

    <!-- Delete all (typed confirm) -->
    <div class="rounded-lg border border-danger/30 bg-danger/5 p-3">
      <div class="text-[13px] font-semibold text-danger">Delete ALL notifications</div>
      <div class="mb-2 text-[11px] text-muted">Irreversible. Type DELETE to confirm.</div>
      <template v-if="confirming === 'delete-all'">
        <div class="flex items-center gap-2">
          <input
            v-model="deleteAllText"
            data-test="op-delete-all-input"
            placeholder="DELETE"
            class="w-28 rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-text"
          />
          <Button
            variant="secondary"
            size="sm"
            @click="
              confirming = null;
              deleteAllText = '';
            "
            >Cancel</Button
          >
          <Button
            size="sm"
            data-test="op-delete-all-confirm"
            :disabled="busy || deleteAllText !== 'DELETE'"
            @click="run('Deleted', deleteAllNotifications)"
            >Confirm delete</Button
          >
        </div>
      </template>
      <Button
        v-else
        variant="secondary"
        size="sm"
        data-test="op-delete-all"
        @click="confirming = 'delete-all'"
        >Delete all…</Button
      >
    </div>

    <!-- Retention window -->
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Retention window</div>
        <div class="text-[11px] text-faint">
          Config only for now — automatic deletion arrives with Week-5 partitioning.
        </div>
      </div>
      <input
        v-model.number="retentionDays"
        type="number"
        min="1"
        data-test="retention-input"
        class="w-16 rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] tabular-nums text-text"
      />
      <span class="text-[12px] text-muted">days</span>
      <Button size="sm" data-test="retention-save" :disabled="busy" @click="saveRetention"
        >Save</Button
      >
    </div>

    <p
      v-if="message"
      role="status"
      aria-live="polite"
      class="font-mono text-[12px] tabular-nums text-muted"
    >
      {{ message }}
    </p>
    <p v-if="error" role="alert" class="text-[13px] text-danger">{{ error }}</p>
  </section>
</template>
```

- [ ] **Step 5: Create `DevLabsPanel.vue`**

```vue
<!-- frontend/src/features/admin/DevLabsPanel.vue -->
<script setup lang="ts">
import { ref } from "vue";
import GeneratorPanel from "./GeneratorPanel.vue";
import MaintenancePanel from "./MaintenancePanel.vue";

type Tab = "generate" | "maintenance";
const tab = ref<Tab>("generate");
const tabs: { id: Tab; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "maintenance", label: "Maintenance" },
];
</script>

<template>
  <div>
    <div class="mb-4 flex gap-1.5">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        :data-test="`devlabs-${t.id}`"
        :aria-current="tab === t.id ? 'true' : undefined"
        class="rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-100"
        :class="
          tab === t.id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-sunken hover:text-text'
        "
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <GeneratorPanel v-if="tab === 'generate'" />
    <MaintenancePanel v-else />
  </div>
</template>
```

- [ ] **Step 6: Rename the AdminView item to "Dev Labs"**

In `frontend/src/features/admin/AdminView.vue`: rename the section id `generator` → `dev-labs`, the label to "Dev Labs" (keep `FlaskConical`), import `DevLabsPanel`, and render it.

```ts
import DevLabsPanel from "./DevLabsPanel.vue";

type Section = "modules" | "features" | "dev-labs";
const section = ref<Section>("modules");
const items: { id: Section; label: string; icon: typeof Boxes }[] = [
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "features", label: "Features", icon: ToggleRight },
  ...(import.meta.env.DEV
    ? [{ id: "dev-labs" as const, label: "Dev Labs", icon: FlaskConical }]
    : []),
];
```

```html
<ModulesPanel v-if="section === 'modules'" />
<DevLabsPanel v-else-if="section === 'dev-labs'" />
<FeaturesPanel v-else />
```

- [ ] **Step 7: Update the AdminView test for the renamed item**

In `frontend/src/features/admin/AdminView.spec.ts`, update the third-item expectation and stub:

```ts
const wrapper = mount(AdminView, {
  global: { stubs: { ModulesPanel: true, FeaturesPanel: true, DevLabsPanel: true } },
});
const buttons = wrapper.findAll("nav button");
expect(buttons).toHaveLength(3);
expect(buttons[2]?.text()).toContain("Dev Labs");
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- MaintenancePanel AdminView`
Expected: PASS. Then `pnpm --filter @notifications/frontend test` — full suite green.

- [ ] **Step 9: Typecheck + lint + commit**

Run: `pnpm --filter @notifications/frontend typecheck && pnpm lint` → clean.

```bash
git add frontend/src/features/admin/adminApi.ts frontend/src/features/admin/DevLabsPanel.vue frontend/src/features/admin/MaintenancePanel.vue frontend/src/features/admin/AdminView.vue frontend/src/features/admin/MaintenancePanel.spec.ts frontend/src/features/admin/AdminView.spec.ts
git commit -m "feat(admin): Dev Labs panel with Generate | Maintenance + retention setting"
```

---

### Task 8: e2e + reviews

**Files:**

- Modify: `frontend/e2e/feed.spec.ts` (or create `frontend/e2e/qol.spec.ts`)
- Modify: `frontend/e2e/generator.spec.ts` is unaffected; add maintenance coverage in a new/extended spec.

**Interfaces:** consumes the running app (`pnpm dev`) with the seeded `admin` account (`notify-dev-2026`).

- [ ] **Step 1: Write the e2e**

Create `frontend/e2e/qol.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";

async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("QoL", () => {
  test("a read notification is re-readable in Earlier and can be marked unread", async ({
    page,
    request,
  }) => {
    const token = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    const id = `qol-${Date.now()}`;
    await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": token, "content-type": "application/json" },
      data: {
        id,
        module: "qol",
        title: "Re-read me",
        description: "z".repeat(200),
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });

    await login(page, "admin");
    await page
      .getByRole("button", { name: /notifications/i })
      .first()
      .click(); // open the bell
    // Read it (click title), which moves it to Earlier.
    await page.getByText("Re-read me").first().click();
    await page.getByRole("button", { name: /Show .* earlier/ }).click();
    // The full card is present in Earlier: expand reveals the long body, and Mark as unread exists.
    await expect(page.getByText("Re-read me")).toBeVisible();
    await page.getByRole("button", { name: "Mark as unread" }).first().click();
  });

  test("Dev Labs maintenance delete-all is guarded and clears the feed", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin");
    await page.getByRole("button", { name: "Dev Labs" }).click();
    await page.locator('[data-test="devlabs-maintenance"]').click();
    await page.locator('[data-test="op-delete-all"]').click();
    await page.locator('[data-test="op-delete-all-input"]').fill("DELETE");
    await page.locator('[data-test="op-delete-all-confirm"]').click();
    await expect(page.getByText(/Deleted/)).toBeVisible();
  });
});
```

> Implementer: the exact bell-open selector should match `feed.spec.ts`'s existing approach — reuse whatever locator that spec uses to open the panel rather than the placeholder above.

- [ ] **Step 2: Run the e2e (app running)**

Run: `pnpm dev` (one shell); `pnpm --filter @notifications/frontend test:e2e qol` (another).
Expected: PASS. Adjust selectors to the real DOM as needed (verify with the browser-tester subagent if a locator is fragile).

- [ ] **Step 3: Full gate + commit**

Run: `pnpm lint && pnpm typecheck && pnpm test` — all green.

```bash
git add frontend/e2e/qol.spec.ts
git commit -m "test(e2e): re-read Earlier + mark-unread + guarded Dev Labs delete-all"
```

- [ ] **Step 4: Review gates**

- `security-reviewer` — the destructive maintenance endpoints + migration 006 + the non-prod guard (authz, non-prod absence, parameterized SQL, no over-deletion; DELETE-read semantics).
- `code-reviewer` — the whole branch.
- `frontend-design-reviewer` — Dev Labs / Maintenance / the re-readable Earlier cards against the ivory system.
- `browser-tester` — re-read flow, mark-unread, each maintenance op.

---

## Verification (end-to-end)

1. `docker compose up -d`; `pnpm --filter @notifications/backend migrate` (applies 006).
2. `pnpm dev` → log in as `admin`.
3. **Issue 1/2:** read a long notification → it drops to Earlier → open Earlier → it's a full card → expand reveals the whole body + its actions → "Mark as unread" moves it back to Needs action.
4. **Issue 3:** `/admin` → **Dev Labs** (renamed, `FlaskConical`) → Generate tab is the unchanged generator; Maintenance tab runs delete-read / delete-older-than / reset-modules / reset-settings (counts shown) and guards delete-all behind typing DELETE.
5. **Issue 4:** set the retention window; confirm "delete older than N" pre-fills it; confirm no background deletion happens (config only).
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all green.

## Notes / deliberate scope

- **No background retention job** — Week-5 partitioning owns automatic deletion; the setting + manual older-than button are the interim.
- **delete-read = read by anyone** — a stopgap tied to global broadcast; revisit with per-recipient audience (Week 4).
- **`isLongBody` = length > 140** — a cheap proxy for "would truncate"; tune later if needed.
- **Maintenance endpoints share the generator's non-prod guard** — absent in production alongside `/admin/simulate`.
