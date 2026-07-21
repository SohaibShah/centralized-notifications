# Accurate server counts + filter-menu changes — design

**Date:** 2026-07-21
**Branch:** `feat/notification-counts` (off `main`, which now includes the feed-sorting work)
**Status:** approved (design converged in discussion)

## Goal

Three related changes to the notification panel:

1. **Move the sort control into the filter dropdown** — it currently takes a whole row in the
   chips bar. It becomes a "Sort by" radio section at the top of `FilterMenu`.
2. **Un-clip the filter dropdown** — the dropdown is clipped by the popover's `overflow-hidden`
   when the panel is short. Float it out of the clip with a teleport.
3. **Accurate, server-sourced counts** — the unread total (bell badge, "Needs action" header,
   "Unread" chip) and the per-priority unread counts (Critical/High chips, filter-menu priority
   rows) are currently computed over the _loaded_ window, so they undercount. Source them from a
   server aggregate over the whole dataset instead.

The user asked for the two filter-menu changes to land **before** the counts work.

## Decisions (locked in discussion)

- **Count semantics: absolute.** Each count is the total UNREAD of that priority across the whole
  dataset, independent of active module/search filters. (Forward note: when free-text search moves
  server-side in a later milestone, counts become filter-aware; the endpoint is shaped so that is an
  additive change — it can grow optional filter params without breaking the current contract.)
- **Sort UI: a "Sort by" radio section** at the top of the filter dropdown, styled like the existing
  priority/module rows. Not a nested `<select>`.
- **Count freshness: exact optimistic deltas + reconcile-on-open**, not a server round-trip per
  click (see Backend/Frontend below).

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before any task is "done".
- New logic carries a Vitest test in the same task (`testing.md`); new UI flows get their component
  test. Backend tests need Postgres up; `migrate()` runs in `beforeAll`.
- Parameterized SQL only. `requireUser` on the new endpoint; per-user read state via the
  `notification_reads` LEFT JOIN, exactly like the feed read path.
- `docs/api/notifications.md` updated via **docs-writer** (new endpoint).
- No AI-attribution commit trailers. Conventional Commits.
- Additive API change → branch stays local under the mentor sign-off gate (no push/PR).

---

## Part 1 — Sort into the filter dropdown

### `frontend/src/features/notifications/components/FilterMenu.vue`

- Add a **"Sort by"** section as the first block inside the dropdown body (above "Priority"),
  following the same `<p>` section-label + row styling. Four options as radio inputs
  (`name="feed-sort"`), bound to `feed.sort`, each firing `feed.setSort(value)` on change:
  - `newest` → "Newest"
  - `oldest` → "Oldest"
  - `priority-high` → "Priority: high → low"
  - `priority-low` → "Priority: low → high"
- The radios are always shown (sort isn't subject to the filter search box). The search box keeps
  filtering only the priority/module option lists.
- `data-test="feed-sort"` moves onto this section's control group (individual radios can carry
  `data-test="feed-sort-<value>"`). The old `<select data-test="feed-sort">` is removed from
  `InboxTab`, so the InboxTab spec's sort-select test moves here (rewritten for radios).

### `frontend/src/features/notifications/panel/InboxTab.vue`

- Remove the `<label>Sort … <select>…</select></label>` block from the chips row. The row reverts to
  `flex items-center gap-1.5` (drop `flex-wrap`, no longer needed) with just the four chips.
- Remove the now-unused `FeedSort` import.

## Part 2 — Un-clip the filter dropdown

Root cause: `NotificationPopover.vue`'s dialog is `overflow-hidden` (needed for its rounded corners
and the feed's own scroll region), and `FilterMenu`'s dropdown is `position: absolute` **inside**
it. A short panel (few/no notifications) clips the dropdown at the panel edge.

### `frontend/src/features/notifications/components/FilterMenu.vue`

- Wrap the dropdown panel in `<Teleport to="body">` so it renders outside the clipped subtree
  (same mechanism the critical-toast viewport already uses).
- Position it `fixed`, anchored to the trigger button: on open, read the button's
  `getBoundingClientRect()` and set `top = rect.bottom + 6` and `right = window.innerWidth -
rect.right` (keeps the current right-aligned placement). Store as reactive style; recompute on
  open and on `window` `resize` (listener added on open, removed on close/unmount).
- Outside-click: the existing `mousedown` handler checks `root.contains(target)`. With the panel
  teleported out of `root`, add a ref to the teleported panel and treat a click inside **either**
  `root` or the panel as "inside" (so clicking a radio/checkbox doesn't close the menu).
- Keep `z-30`/appropriate stacking, the `role`, `aria-label`, and Esc-to-close.

No change to `NotificationPopover.vue` (it keeps `overflow-hidden`).

## Part 3 — Server-sourced counts

### Backend — `GET /notifications/counts`

New route in `backend/src/http/notifications/routes.ts`, `preHandler: requireUser`:

```
GET /notifications/counts  →  200
{
  "unread": 12,
  "unreadByPriority": { "critical": 3, "high": 7, "normal": 2, "low": 0 }
}
```

- One parameterized aggregate (mirrors the feed read path's join + suppressed filter):
  ```sql
  SELECT n.priority, count(*)::int AS n
    FROM notifications n
    LEFT JOIN notification_reads r
      ON r.notification_id = n.id AND r.user_id = $1
   WHERE n.suppressed = false AND r.user_id IS NULL
   GROUP BY n.priority
  ```
- Assemble the response in the handler: zero-fill all four priorities from
  `NOTIFICATION_PRIORITIES`, `unread` = sum. No new SQL string interpolation, no OFFSET, no cursor.
- Week-1 audience limitation is unchanged: every notification counts for every authenticated user
  (audience resolution is a later milestone). Do not claim otherwise in the doc.
- Shape allows a later filter-aware variant to add optional query params (`module`, server-side
  search) without breaking this contract.

### Shared contract — `packages/shared/src/notification.ts`

Add the response type so the store is typed against it:

```ts
export interface NotificationCounts {
  unread: number;
  unreadByPriority: Record<NotificationPriority, number>;
}
```

### Frontend store — `frontend/src/stores/feed.ts`

- State: `const counts = ref<NotificationCounts>({ unread: 0, unreadByPriority: { critical:0, high:0, normal:0, low:0 } })`.
- `fetchCounts()`: `GET /notifications/counts` → set `counts.value`. Swallow errors like `loadMore`
  (a failed count refresh must not blank the feed); leave the previous snapshot in place.
- **Triggers:**
  - `load()` calls `fetchCounts()` (initial load + sort-change refetch). **Not** `loadMore()` —
    counts are dataset-wide and unaffected by loading older pages.
  - Panel open reconciles: `NotificationPopover.vue`'s `onMounted` (which already calls
    `flushSessionReads()`) also calls `feed.fetchCounts()` — catches cross-session/device drift.
  - `onLiveBatch()` increments `counts` for items genuinely new to `seen` (we know each item's
    priority and that a live arrival is unread). Only the newly-added items adjust the count;
    deduped ones don't.
- **Exact optimistic deltas** (we always know the item's priority and the read transition):
  - `markRead(id)`: on the optimistic flip, `unread -= 1` and `unreadByPriority[prio] -= 1`. On a
    genuine failure revert both; on a 404-remove, the item no longer exists unread, so the decrement
    stands (no revert).
  - `markUnread(id)`: `+= 1` on the optimistic flip; revert on failure.
  - `markAllReadInScope()`: decrement once per id flipped (by each id's priority); revert all on
    failure, mirroring the existing read-flag revert.
  - Clamp at 0 defensively (a count should never go negative).
- **Trimming** (`addFront`'s `MAX_ITEMS` slice) does **not** touch counts — trimmed rows still exist
  unread in the dataset; counts track the dataset, not the loaded window.
- Export `counts` and `fetchCounts`.
- `unreadCount` (the old loaded-window computed) is **replaced** at its consumers by `counts.unread`
  (see surfaces). Keep or remove the computed: remove it if it has no remaining consumers after the
  surface swap, to avoid two sources of truth. (The store tests that assert `unreadCount` are
  rewritten to assert `counts.unread`.)

### Surfaces (swap loaded-window → `feed.counts`)

- `NotificationBell.vue` badge + aria-label → `feed.counts.unread`.
- `FeedList.vue` "Needs action" header count → `feed.counts.unread`, label stays "N unread".
  (It can exceed the visible needs-action group when older unread pages aren't loaded — that is the
  intended accuracy. The `unreadInNeedsAction` computed there is removed; the "Mark all read" button
  shows whenever `feed.counts.unread > 0`.) The counts prop reaches `FeedList` via `InboxTab`
  (either a new prop or `FeedList` reads the store directly — implementer's call, but a prop keeps
  `FeedList` presentational; if a prop, pass `feed.counts`).
- `InboxTab.vue` chips: **Unread** chip shows `counts.unread`; **Critical** shows
  `counts.unreadByPriority.critical`; **High** shows `.high`. Render the count only when `> 0`.
- `FilterMenu.vue` priority rows: each priority label shows its `counts.unreadByPriority[p]` when
  `> 0`.

Count badge styling reuses the existing small mono/tabular chip-count treatment already in the panel
(e.g. the needs-action `bg-accent/10 … tabular-nums` pill) so counts read consistently.

---

## Tests

- **Backend** (`backend/test/notifications.test.ts`, new `describe`): with a seeded mixed-priority,
  mixed-read set for a dedicated user — `/notifications/counts` returns per-priority unread with
  zero-fill, `unread` = the sum; a read row is excluded; a suppressed row is excluded; 401 without a
  session. Isolate on an id prefix + a dedicated user so the shared DB's other rows don't leak in
  (scope assertions to counts derived from the seeded set, or use a fresh user whose reads are
  controlled — prefer counting deltas rather than absolute totals against the shared table).
- **Frontend store** (`feed.spec.ts`): `fetchCounts` populates `counts`; `load()` triggers it;
  `markRead`/`markUnread` apply the exact optimistic delta and revert on failure; `markAllReadInScope`
  decrements per id; an SSE batch increments for new-unread only; existing `unreadCount` assertions
  migrated to `counts.unread`.
- **FilterMenu** (`FilterMenu.spec.ts` — new or existing): the "Sort by" radios render, reflect
  `feed.sort`, and call `setSort` on change; the dropdown is teleported (assert it renders to
  body / is found outside the component root) and priority rows show counts.
- **InboxTab** (`InboxTab.spec.ts`): the sort `<select>` test is removed (moved to FilterMenu); chips
  show counts from `feed.counts`.
- **NotificationBell / FeedList**: badge and header read `feed.counts.unread`.

## Out of scope

- Filter-aware counts (deferred until server-side search; endpoint shaped for it).
- Server-side module filtering / search (still client-side over the loaded window).
- Any change to the audience model (counts are global for now, like the feed).
- Persisting sort/filter across sessions.

## Self-review

- **Placeholders:** none.
- **Consistency:** counts join + suppressed filter mirror the feed read path; count semantics
  (unread-by-priority) are the same everywhere they're surfaced; optimistic deltas use the same
  revert points the read-flag optimism already has.
- **Scope:** one cohesive panel-facing feature with two small precursor UI changes; single plan.
- **Ambiguity resolved:** absolute counts; radio sort UI; freshness = optimistic deltas seeded by
  `fetchCounts` on load/open + SSE increment (no per-click round-trip); trimming never adjusts
  counts; the needs-action header intentionally shows the dataset unread total, not the loaded group
  size.
