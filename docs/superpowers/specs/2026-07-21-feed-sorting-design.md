# Server-side feed sorting — design

**Date:** 2026-07-21
**Branch:** `feat/feed-sorting` (off `main`)
**Status:** approved (design converged in discussion)
**Supersedes:** the `sorting-deferred-serverside` deferral (mentor point #5).

## Goal

Let a user sort the notification feed, with the **order and pagination owned by the server**
(so it sorts the whole dataset, not just the loaded window). Default is **Newest first**;
**priority** ordering becomes an opt-in. This replaces the client's current implicit
priority-first ordering of the "Needs action" group.

## Sort options (exactly four; default `newest`)

| value           | label              | ORDER BY                                       |
| --------------- | ------------------ | ---------------------------------------------- |
| `newest`        | Newest             | `created_at DESC, id DESC`                     |
| `oldest`        | Oldest             | `created_at ASC, id ASC`                       |
| `priority-high` | Priority: high→low | `priority_rank ASC, created_at DESC, id DESC`  |
| `priority-low`  | Priority: low→high | `priority_rank DESC, created_at DESC, id DESC` |

`priority_rank`: critical=0, high=1, normal=2, low=3 (mirrors `priorityRank` in
`frontend/src/design/tokens.ts`). Within a priority level, both priority sorts tie-break
**newest-first**.

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before "done".
- New logic carries a Vitest test in the same task (`testing.md`).
- Parameterized SQL only; keyset pagination — **no OFFSET, no total count** (NFR-2).
- `docs/api/notifications.md` updated via **docs-writer** (the read contract gains `sort`).
- No AI-attribution commit trailers. Conventional Commits.

## Decision: grouping interaction

**Sort within the existing grouping.** The Needs-action / Earlier split (by read state) stays.
The chosen sort drives pagination _and_ the order inside each group. The client **stops**
re-sorting Needs action by priority — both groups now preserve the server order.

## Backend

### Migration `backend/migrations/008_priority_rank.sql`

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

-- Matches the priority-sort keyset order, partial on the same predicate the feed query uses.
CREATE INDEX notifications_priority_keyset_idx
  ON notifications (priority_rank, created_at DESC, id DESC)
  WHERE suppressed = false;
```

(Recency both-directions is already served by migration 004's `(created_at DESC, id DESC)`
index — btree scans backward for `ASC`.)

### `backend/src/http/notifications/routes.ts`

- Add to `listQuerySchema`:
  ```ts
  sort: z.enum(["newest", "oldest", "priority-high", "priority-low"]).default("newest"),
  ```
- **Cursor** carries the sort it was issued for, plus `rank` for priority sorts:
  ```ts
  interface Cursor {
    s: "newest" | "oldest" | "priority-high" | "priority-low";
    ts: string;
    id: string;
    rank?: number;
  }
  ```
  `cursorSchema` validates `s` and (for priority sorts) `rank`. On decode, if `cursor.s !==`
  the request's `sort`, respond `400 invalid cursor`. (In practice the client resets on sort
  change, so it only ever sends a matching cursor — this is a guard.)
- Build ORDER BY + keyset WHERE per sort. The recency sorts use a single row-value comparison;
  the priority sorts need a two-part comparison because rank and time run opposite directions:
  ```
  newest         ORDER BY created_at DESC, id DESC
                 WHERE (created_at, id) < ($ts, $id)
  oldest         ORDER BY created_at ASC, id ASC
                 WHERE (created_at, id) > ($ts, $id)
  priority-high  ORDER BY priority_rank ASC, created_at DESC, id DESC
                 WHERE priority_rank > $rank
                    OR (priority_rank = $rank AND (created_at, id) < ($ts, $id))
  priority-low   ORDER BY priority_rank DESC, created_at DESC, id DESC
                 WHERE priority_rank < $rank
                    OR (priority_rank = $rank AND (created_at, id) < ($ts, $id))
  ```
  Keep the existing `WHERE suppressed = false` and the `user.id` param for the read LEFT JOIN.
  Select `n.priority_rank` so `encodeCursor` can carry it on the priority sorts.
- `nextCursor` is built from the last row's `(priority_rank?, created_iso, id)` per the active sort.

## Frontend

### `frontend/src/stores/feed.ts`

- Add `const sort = ref<FeedSort>("newest")` (type exported from shared or a local union).
- `load()` / `loadMore()` append `&sort=${sort.value}` to the request URL.
- Add `setSort(next: FeedSort)`: if unchanged, no-op; else set `sort`, **clear the loaded window**
  (`items=[]`, `seen.clear()`, `nextCursor=null`, `flushSessionReads()`) and call `load()`.
  Do NOT `disconnect()` — SSE stays live. (This is a soft reset, distinct from `reset()` which
  is login-scoped.)
- **`groups` computed:** remove the Needs-action priority re-sort ([feed.ts:310-313]); partition
  `visibleItems` into needs-action / earlier preserving order. Both groups render in load order
  (= server order). Sticky-read behavior unchanged.
- Live arrivals still `addFront` (top); documented that they lead until a reload reconciles them
  into the active order.
- Export `sort` + `setSort`.

### UI — sort control

- A compact `<select>` in the chips row of `frontend/src/features/notifications/panel/InboxTab.vue`
  (right-aligned, `ml-auto`), styled like the admin Modules panel's sort select
  (`rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px]`). Bound to
  `feed.sort` via `@change="feed.setSort($event.target.value)"`. Labels per the table above.
  `data-test="feed-sort"`.

## Tests

- **Backend** (`backend/test/notifications.test.ts`): with a seeded mixed-priority set —
  `oldest` returns the reverse of `newest`; `priority-high` returns criticals before lows (newest
  within a level); `priority-low` inverts that; keyset pagination under each sort walks the full
  set with no overlap/skip; a cursor issued for one sort, replayed with a different `sort`, 400s.
- **Frontend** (`frontend/src/stores/feed.spec.ts` + `InboxTab.spec.ts`): `setSort("oldest")`
  clears items and refetches with `&sort=oldest`; `groups` preserve server/load order (the old
  "Needs action sorted by priority" assertion is replaced); the sort `<select>` renders and
  `@change` calls `setSort`.

## Out of scope

- Server-side **filtering / search** (still client-side over the loaded window — unchanged).
- Persisting the user's sort choice across sessions (resets to `newest` on reload).
- Any change to the grouping model itself beyond dropping the client priority re-sort.

## Self-review

- **Placeholders:** none.
- **Consistency:** cursor `s` guard + client reset-on-sort-change are consistent (client never
  sends a cross-sort cursor; server guards anyway). `priority_rank` mapping matches `priorityRank`.
- **Scope:** single plan; backend (migration + query + cursor) and frontend (store + UI) are
  cohesive around one feature.
- **Ambiguity:** priority tie-break fixed to newest-first for BOTH priority directions; default
  fixed to `newest`; sort change fixed to a soft reset (SSE preserved).
