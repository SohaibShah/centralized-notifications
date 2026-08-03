# Grouping refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grouped notifications a real triage surface — read items fall to Earlier, counts read per-section, sorting works, whole groups can be cleared, actions are reachable inline, and the collapsed group looks like an iOS/macOS stack.

**Architecture:** Reshape the collapsed grouped read to partition by `(group, read-state)` and honor `sort` (mirroring the flat feed's sort-scoped keyset); reuse the real `NotificationCardRenderer` in the peek; add a group-scoped mark-read to the existing bulk path; restyle the stack as a layered "iOS peek". Server changes are query-only (no migration).

**Tech Stack:** pnpm workspaces — `@notifications/shared` (zod+types), `@notifications/core` (identity-free Postgres reads keyed by `user_key`), `@notifications/server-fastify` (routes), `@notifications/vue` (component lib); Vitest + Playwright.

**Spec:** [docs/superpowers/specs/2026-08-03-grouping-refinements-design.md](../specs/2026-08-03-grouping-refinements-design.md)

## Global Constraints

- **No new migration** — all read changes are queries over existing columns (`group_key`, `group_label`, `priority_rank`, `notification_reads`).
- **`packages/core` stays identity-free** — no `FROM users`; `boundary.test.ts` enforces it. Every read/write is scoped to the caller's `user_key`.
- **SQL is parameterized**, never string-concatenated with user input.
- **zod at the boundary** — every route validates input; grouped/group mutual-exclusion preserved.
- **Gating unchanged** — grouped mode stays active iff admin `groupingEnabled` AND user `groupingEnabled`.
- **Design system** — `--nt-*` tokens / existing Tailwind token classes, lucide icons, on-scale type only. Respect `prefers-reduced-motion`.
- **Per task:** `pnpm lint` + `pnpm typecheck` clean, unit tests green; Conventional Commits; **no "Generated with AI" / "Co-Authored-By: AI" trailers**.
- Branch: `feat/grouping` (spec committed).

---

### Task 1: Read-split, per-section counts, time indicator

Partition the grouped read by `(group, read)`, make `groupTotal` the section count, drop `groupUnread`, split the client by `read`, and show the representative's relative time on the header.

**Files:**

- Modify: `packages/shared/src/notification.ts:256-263` (remove `groupUnread` from `GroupedEntry`)
- Modify: `packages/core/src/read/grouped.ts` (partition, aggregates, row/select, `toEntry`)
- Modify: `packages/vue/src/components/components/StackList.vue:24-25` (split by `read`)
- Modify: `packages/vue/src/components/panel/StackRow.vue` (single count + time, drop unread pill)
- Test: `packages/core/test/read-grouped.test.ts`, `packages/vue/.../StackRow.spec.ts`

**Interfaces:**

- Produces: `GroupedEntry` without `groupUnread`; `groupTotal` = count of that `(group, read-state)` partition; entry's `read` determines its section.

- [ ] **Step 1: Failing core test — a subject with read + unread splits into two entries**

In `read-grouped.test.ts`, extend the seed so the `dsr:#1042` subject has one read + one unread member, and rewrite the first test:

```ts
// in beforeAll rows, add a pre-read member of the SAME subject:
(["e", "DSAR #1042 acknowledged", "high"], // will be marked read below
  // after the persist loop:
  await query(`INSERT INTO notification_reads (user_key, notification_id) VALUES ($1, $2)`, [
    user.userKey,
    `${user.userKey}-e`,
  ]));
```

```ts
test("a subject with read + unread yields two entries, each counted by section", async () => {
  const res = await listGrouped(query, { principal: user, limit: 50 });
  if (!res.ok) throw new Error(res.error);
  const stacks = res.page.entries.filter((e) => e.groupKey === "dsr:#1042");
  expect(stacks.length).toBe(2);
  const unread = stacks.find((e) => !e.read)!;
  const read = stacks.find((e) => e.read)!;
  expect(unread.groupTotal).toBe(2); // a + b, both unread
  expect(unread.topPriority).toBe("critical");
  expect(read.groupTotal).toBe(1); // e, read
  expect("groupUnread" in unread).toBe(false);
});
```

- [ ] **Step 2: Run it — fails** (`pnpm --filter @notifications/core test read-grouped` → two-entry assertion fails; `groupUnread` still present).

- [ ] **Step 3: Read-split the query in `grouped.ts`**

Remove `group_unread` from `GroupedRow` and add `read` to every window `PARTITION BY`:

```sql
ranked AS (
  SELECT *,
    row_number() OVER (PARTITION BY entry_key, read ORDER BY created_at DESC, id DESC) AS rn,
    count(*)              OVER (PARTITION BY entry_key, read) AS group_total,
    first_value(priority) OVER (PARTITION BY entry_key, read ORDER BY priority_rank ASC
                                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS top_priority
    FROM scoped
)
```

Drop `group_unread::int AS group_unread,` from the SELECT list. In `toEntry`, remove the `groupUnread: row.group_unread,` line and the `group_unread` field from `GroupedRow`. Update the doc comment to say "one entry per (group, read-state)".

- [ ] **Step 4: Remove `groupUnread` from shared**

In `packages/shared/src/notification.ts`, delete the `groupUnread` field (and its doc line) from `GroupedEntry`.

- [ ] **Step 5: Split the client list by read + fix StackRow**

`StackList.vue`:

```ts
const needsAction = computed(() => props.entries.filter((e) => !e.read));
const earlier = computed(() => props.entries.filter((e) => e.read));
```

`StackRow.vue` — delete the `stack-unread` pill `<span>` (lines ~94-100). Keep the `stack-total` count. Add a relative-time indicator to the header, before/after the count:

```html
<time class="shrink-0 font-mono text-[11px] tabular-nums text-faint" :datetime="entry.createdAt"
  >{{ relativeTime(entry.createdAt) }}</time
>
```

(`relativeTime` is already imported.)

- [ ] **Step 6: Update StackRow.spec** — the `entry()` factory drops `groupUnread`; remove any `stack-unread` assertion; add `expect(w.get('[data-test="stack-header"]').text())` to contain the relative time is optional — assert the total still renders.

- [ ] **Step 7: Run core + vue + shared tests, lint, typecheck — all green.**

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(grouping): split stacks by read-state, per-section counts, header time"
```

---

### Task 2: Sort-aware grouped read + sort-scoped cursor

Grouped read honors `FEED_SORTS`; the representative stays the latest member; groups order by the sort; the cursor becomes sort-scoped.

**Files:**

- Modify: `packages/core/src/read/grouped.ts` (sort param, `top_rank`, order/keyset, cursor codec)
- Modify: `packages/core/src/service.ts:73-77` (`listGrouped` gains `sort?`)
- Modify: `packages/server-fastify/src/routes/notifications.ts:53-59` (pass `sort`)
- Test: `packages/core/test/read-grouped.test.ts`, `packages/server-fastify/test/notifications.route.test.ts`

**Interfaces:**

- Consumes: `FeedSort` from `@notifications/shared`.
- Produces: `listGrouped(args: { principal; cursor?; limit?; sort? })`; cursor `{ g:true, s:FeedSort, ts, id, rank? }`.

- [ ] **Step 1: Failing test — priority sort brings the most-severe group to the top**

```ts
test("sort=priority-high orders groups by their top severity", async () => {
  const res = await listGrouped(query, { principal: user, limit: 50, sort: "priority-high" });
  if (!res.ok) throw new Error(res.error);
  const keys = res.page.entries.map((e) => e.groupKey ?? e.id);
  const dsarUnread = res.page.entries.findIndex((e) => e.groupKey === "dsr:#1042" && !e.read);
  // the dsr:#1042 unread stack contains the critical member → must sort ahead of the high/normal solos
  expect(dsarUnread).toBe(0);
  expect(keys.length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run it — fails** (`sort` not accepted; order is newest-only).

- [ ] **Step 3: Add sort + top_rank + sort-scoped order/keyset to `grouped.ts`**

Add to `ranked`: `min(priority_rank) OVER (PARTITION BY entry_key, read) AS top_rank`. Replace the fixed keyset/order with the flat-feed pattern (representative `rn=1` still ordered `created_at DESC` inside the partition; the OUTER order follows `sort`):

```ts
const sort: FeedSort = args.sort ?? "newest";
// ... after decoding cursor (see Step 4) ...
let keyset = "";
let orderBy: string;
if (sort === "newest" || sort === "oldest") {
  const [dir, cmp] = sort === "newest" ? ["DESC", "<"] : ["ASC", ">"];
  orderBy = `created_at ${dir}, id ${dir}`;
  if (cursor) {
    params.push(cursor.ts, cursor.id);
    keyset = `AND (created_at, id) ${cmp} ($${params.length - 1}::timestamptz, $${params.length}::text)`;
  }
} else {
  const rankDir = sort === "priority-high" ? "ASC" : "DESC";
  const rankCmp = sort === "priority-high" ? ">" : "<";
  orderBy = `top_rank ${rankDir}, created_at DESC, id DESC`;
  if (cursor && cursor.rank !== undefined) {
    params.push(cursor.rank, cursor.ts, cursor.id);
    const r = params.length - 2,
      t = params.length - 1,
      i = params.length;
    keyset =
      `AND (top_rank ${rankCmp} $${r}::smallint` +
      ` OR (top_rank = $${r}::smallint AND (created_at, id) < ($${t}::timestamptz, $${i}::text)))`;
  }
}
```

Select `top_rank` through so the keyset can reference it (it's in `ranked`; the outer `WHERE rn = 1 ${keyset}` and `ORDER BY ${orderBy}` reference `ranked` columns). Use `ORDER BY ${orderBy} LIMIT ${limitP}`.

- [ ] **Step 4: Sort-scope the cursor codec**

```ts
interface GCursor {
  g: true;
  s: FeedSort;
  ts: string;
  id: string;
  rank?: number;
}
const gCursorSchema = z
  .object({
    g: z.literal(true),
    s: z.enum(FEED_SORTS),
    ts: z.string().datetime({ offset: true }),
    id: z.string().min(1),
    rank: z.number().int().min(0).max(3).optional(),
  })
  .refine((c) => (c.s === "priority-high" || c.s === "priority-low") === (c.rank !== undefined), {
    message: "rank required for and only on priority sorts",
  });
```

After decoding, reject a cross-sort cursor: `if (cursor && cursor.s !== sort) return { ok: false, error: "invalid cursor" };`. When emitting `nextCursor`, include `s: sort` and `rank: last.top_rank` for priority sorts (add `top_rank` to `GroupedRow`).

- [ ] **Step 5: Thread `sort` through service + route**

`service.ts` `listGrouped` type: add `sort?: FeedSort;`. The impl already spreads args to `listGrouped` — confirm it forwards `sort`. Route grouped branch:

```ts
const page = await service.listGrouped({
  principal,
  cursor: parsed.data.cursor,
  limit: parsed.data.limit,
  sort: parsed.data.sort,
});
```

- [ ] **Step 6: Failing keyset test — paginate under priority sort with no overlap/skip**, then a cross-sort cursor rejected:

```ts
test("a grouped cursor issued under one sort is rejected under another", async () => {
  const first = await listGrouped(query, { principal: user, limit: 1, sort: "newest" });
  if (!first.ok || !first.page.nextCursor) throw new Error("need a cursor");
  const bad = await listGrouped(query, {
    principal: user,
    cursor: first.page.nextCursor,
    sort: "priority-high",
  });
  expect(bad.ok).toBe(false);
});
```

Update the existing keyset-pagination test to pass `sort: "priority-high"` on every page and assert no dupes.

- [ ] **Step 7: Route test** — `grouped=true&sort=priority-high` returns 200 with entries ordered by severity (first entry's `topPriority` is the most severe present).

- [ ] **Step 8: Run core + server-fastify tests, lint, typecheck — green. Commit**

```bash
git commit -am "feat(grouping): sort grouped stacks (priority/newest/oldest) with sort-scoped cursor"
```

---

### Task 3: Inline actions — peek reuses the real card renderer

Replace the trimmed `<li>` peek rows with `NotificationCardRenderer` so members expand to their actions exactly like the main feed.

**Files:**

- Modify: `packages/vue/src/components/panel/StackRow.vue` (peek list → cards; add `unread` emit)
- Modify: `packages/vue/src/components/components/StackList.vue` (forward `unread`)
- Modify: `packages/vue/src/components/panel/InboxTab.vue:380-390` (wire `@unread`)
- Test: `packages/vue/.../StackRow.spec.ts`

**Interfaces:**

- Produces: StackRow emits `open` / `action` / `unread` per member (same signatures as `FeedList`).

- [ ] **Step 1: Failing test — peek renders member cards, not bare `<li>`**

```ts
it("renders peek members through NotificationCardRenderer", async () => {
  const get = vi
    .fn()
    .mockResolvedValue({ items: [feedItem({ id: "m1", title: "M one" })], nextCursor: null });
  const w = mount(StackRow, {
    props: { entry: entry(), transport: { get } },
    global: {
      stubs: { NotificationCardRenderer: { template: '<div data-test="member-card" />' } },
    },
  });
  await w.get('[data-test="stack-header"]').trigger("click");
  await Promise.resolve();
  expect(w.findAll('[data-test="member-card"]').length).toBe(1);
});
```

- [ ] **Step 2: Run it — fails** (peek is `<li>` markup).

- [ ] **Step 3: Swap the peek list for cards** in `StackRow.vue`:

```html
<div v-else>
  <NotificationCardRenderer
    v-for="m in peek ?? []"
    :key="m.id"
    :notification="m"
    @open="(n) => emit('open', n)"
    @action="(a, n, i) => emit('action', a, n, i)"
    @unread="(n) => emit('unread', n)"
  />
</div>
```

Add `unread: [notification: FeedNotification]` to `defineEmits`. Remove the now-unused `relativeTime` import if the header no longer needs it (it does — keep it). Delete the `<li>`/`<ul>` block and its per-item markup.

- [ ] **Step 4: Forward `unread` through StackList** — add to its `defineEmits` and to both `<StackRow>` usages: `@unread="(x) => emit('unread', x)"`.

- [ ] **Step 5: Wire in InboxTab** — on the `<StackList>` element add `@unread="(n) => feed.markUnread(n.id)"` (mirrors the flat `FeedList`).

- [ ] **Step 6: Run vue tests, lint, typecheck — green. Commit**

```bash
git commit -am "feat(grouping): peek members reuse NotificationCardRenderer (inline actions)"
```

---

### Task 4: Mark a whole group read

A group-scoped mark-read on the existing bulk path; a "Mark all read" control on the unread stack header.

**Files:**

- Modify: `packages/core/src/read/read-state.ts` (add `markReadGroup`)
- Modify: `packages/core/src/service.ts` (interface + impl + import)
- Modify: `packages/server-fastify/src/routes/notifications.ts` (`bulkReadSchema` union; handler branch)
- Modify: `packages/vue/src/state/feed.ts` (add `markAllReadInGroup`)
- Modify: `StackRow.vue` / `StackList.vue` / `InboxTab.vue` (emit + wire `mark-all-read`)
- Test: `packages/core/test/read-state.test.ts` (or the grouped test), route test, `feed.spec.ts`

**Interfaces:**

- Produces: `markReadGroup(query, { principal, group })`; service `markReadGroup({ principal, group })`; `POST /notifications/read` accepts `{ group }` as an alternative to `{ ids }`; store `markAllReadInGroup(key)`.

- [ ] **Step 1: Failing core test**

```ts
test("markReadGroup marks all audience-visible members of a group read, idempotently", async () => {
  // seed two unread members of group G for `user`, one member of another group
  await markReadGroup(query, { principal: user, group: "dsr:#G" });
  await markReadGroup(query, { principal: user, group: "dsr:#G" }); // idempotent
  const res = await listGrouped(query, { principal: user, limit: 50 });
  if (!res.ok) throw new Error(res.error);
  const g = res.page.entries.filter((e) => e.groupKey === "dsr:#G");
  expect(g.every((e) => e.read)).toBe(true); // no unread stack remains for G
});
```

- [ ] **Step 2: Run — fails** (`markReadGroup` undefined).

- [ ] **Step 3: Implement `markReadGroup`** in `read-state.ts` (mirrors `markReadBulk`, group-filtered):

```ts
export async function markReadGroup(
  query: QueryFn,
  args: { principal: Principal; group: string },
): Promise<void> {
  const params: unknown[] = [args.principal.userKey, args.group];
  const audience = audienceWhere(args.principal, params);
  await query(
    `INSERT INTO notification_reads (user_key, notification_id)
       SELECT $1, n.id FROM notifications n
        WHERE n.group_key = $2::text AND n.suppressed = false AND ${audience}
       ON CONFLICT (user_key, notification_id) DO NOTHING`,
    params,
  );
}
```

- [ ] **Step 4: Service wiring** — import `markReadGroup`; add `markReadGroup(args: { principal: Principal; group: string }): Promise<void>;` to the interface; impl `markReadGroup: (args) => markReadGroup(query, args),`.

- [ ] **Step 5: Route — accept `{ group }` on `POST /notifications/read`**

```ts
const bulkReadSchema = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({ group: z.string().min(1).max(300) }),
]);
// handler:
if ("group" in parsed.data) await service.markReadGroup({ principal, group: parsed.data.group });
else await service.markReadBulk({ principal, ids: parsed.data.ids });
```

Route test: `POST /notifications/read` with `{ group }` → 204 and the group's members read on the next `grouped=true` fetch; malformed body → 400.

- [ ] **Step 6: Store method** — in `feed.ts`, beside `markAllReadInScope`:

```ts
async function markAllReadInGroup(key: string): Promise<void> {
  await deps.transport.post("/notifications/read", { group: key });
  await loadGrouped();
  void fetchCounts();
}
```

Export it on the returned object. `feed.spec.ts`: `markAllReadInGroup("dsr:#1042")` posts `{ group }` and refetches grouped.

- [ ] **Step 7: UI wiring** — `StackRow.vue`: add a "Mark all read" button in the expanded header, `@click.stop="emit('mark-all-read', entry.groupKey ?? '')"`, shown only when `!entry.read` (unread stack). Add `"mark-all-read": [key: string]` to emits. `StackList.vue`: forward it. `InboxTab.vue`: `@mark-all-read="(k) => feed.markAllReadInGroup(k)"` on `<StackList>`. StackRow.spec: clicking it emits `mark-all-read` with the key.

- [ ] **Step 8: Run core + server-fastify + vue tests, lint, typecheck — green. Commit**

```bash
git commit -am "feat(grouping): mark an entire group read from the stack header"
```

---

### Task 5: iOS-peek stack visual + See-all label

Restyle the collapsed multi-member stack as layered cards (option A); accent the expanded header; drop the number from "See all".

**Files:**

- Modify: `packages/vue/src/components/panel/StackRow.vue` (layered collapsed look, header rail, footer copy)
- Test: `packages/vue/.../StackRow.spec.ts` (See-all still emits key+label)

**Interfaces:** no prop/emit changes (visual only) beyond Task 4's `mark-all-read`.

- [ ] **Step 1: Layered collapsed treatment** — wrap the collapsed header so two faux card edges sit behind the representative card (absolutely-positioned, inset, `bg-sunken`/`bg-surface`, progressively faded, `z` beneath). Only render the layers when `entry.groupTotal > 1`. Use existing token classes; no off-scale sizes.

- [ ] **Step 2: Expanded header rail** — when `open`, give the header a `border-l-2 border-accent` (or equivalent token) and a faint `bg-sunken` to signal "inside this group".

- [ ] **Step 3: Footer copy** — change the "See all" button text from `See all {{ entry.groupTotal }} in this group` to `See all in this group` (drop the count; the emit payload is unchanged). Keep the lucide `ArrowRight`.

- [ ] **Step 4: Motion** — any expand/fan transition wrapped in `motion-safe:` (or a `@media (prefers-reduced-motion: reduce)` guard); the layered edges are static.

- [ ] **Step 5: Update StackRow.spec** — the See-all emit test is unchanged (still `["dsr:#1042","DSAR #1042"]`); if any test asserted the literal "See all N" text, update it to "See all in this group".

- [ ] **Step 6: Run vue tests, lint, typecheck — green.**

- [ ] **Step 7: Design review** — dispatch `frontend-design-reviewer` on `StackRow.vue` (+ `StackList.vue`); address findings.

- [ ] **Step 8: Commit**

```bash
git commit -am "feat(grouping): iOS-peek stack visual + whole-group See-all"
```

---

### Task 6: e2e + API docs

**Files:**

- Modify: `frontend/e2e/grouping.spec.ts`
- Modify (via `docs-writer`): `docs/api/notifications.md`

- [ ] **Step 1: Extend the e2e** — after publishing same-subject items and stacking: (a) mark one member read → assert it leaves the unread stack and appears in an Earlier stack; (b) click "Mark all read" on the unread stack → the unread stack clears into Earlier; (c) switch sort to priority → stacks reorder. Keep the toggle-off → flat assertion.

- [ ] **Step 2: Run e2e** — `pnpm test:e2e grouping` green (with `pnpm dev` / module-sim up).

- [ ] **Step 3: Docs** — dispatch `docs-writer` to update `docs/api/notifications.md`: `grouped=true` now honors `sort` and its cursor format changed; `GroupedEntry.groupUnread` removed and `groupTotal` is per-(group, read-state); `POST /notifications/read` accepts `{ group }`.

- [ ] **Step 4: Commit**

```bash
git commit -am "test(grouping): e2e for read-split, group mark-all, sort; docs"
```

---

## Verification (whole branch)

1. `pnpm lint && pnpm typecheck && pnpm test` clean across all packages.
2. `pnpm test:e2e grouping` + `settings` green.
3. `code-reviewer` (whole branch) + `security-reviewer` (touches read-state writes + the read contract) + `frontend-design-reviewer` (Task 5) — address findings.
4. Manual `/verify`: publish a burst of same-subject notifications from the control center (:4000); confirm the iOS-peek stack, per-section counts, sort reordering, inline actions on expand, "Mark all read" clearing into Earlier, and "See all" drill-in.

## Self-review notes

- **Spec coverage:** item 1→Task 3; items 2+3→Task 1; item 4→Task 2 (+ time indicator in Task 1); item 5→Task 4; item 6→Task 5. e2e/docs→Task 6. ✅
- **Type consistency:** `GCursor` gains `s`/`rank` (Task 2); `GroupedEntry` loses `groupUnread` (Task 1) — every consumer (`grouped.ts`, `StackRow`, `StackList`, tests) updated in the same task. `markReadGroup` signature identical across core/service/route (Task 4).
- **Green at every commit:** Task 1 removes `groupUnread` and its only consumers together; later tasks add, never leave dangling refs.
