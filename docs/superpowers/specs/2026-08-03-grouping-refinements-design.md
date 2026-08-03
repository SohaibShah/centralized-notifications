# Grouping refinements — read-split, sorting, inline actions & iOS stacks

**Status:** approved (design), pending spec review
**Builds on:** [2026-08-03-grouping-design.md](./2026-08-03-grouping-design.md) — the original grouping
feature (persisted `group_key`, `grouped=true` collapsed keyset read, `?group=` drill-in, admin +
per-user gating). This doc specifies six refinements to that feature; everything not restated here is
unchanged.

**Goal:** Make grouped notifications behave like a real triage surface — read items fall back to
Earlier, counts read naturally, sorting works, whole groups can be actioned and cleared, and the
collapsed group looks like an iOS/macOS stack.

## Motivation

The shipped grouping collapses each subject into a single entry spanning read + unread, splits
Needs action / Earlier by `groupUnread > 0`, shows a fixed newest-first order (sort ignored), renders
a stripped-down peek without actions, and looks like an accordion row rather than a stack. The six
changes below close those gaps.

---

## 1 · Read-split data model (items 2 + 3)

**Change:** partition the grouped read by **`(COALESCE(group_key, id), read)`** instead of by group
alone. A subject with both read and unread members now yields **two** collapsed entries: an unread
stack (→ Needs action) and a read stack (→ Earlier).

- The representative (rn = 1) and all window aggregates are computed **per (group, read-state)**
  partition. Every member of a partition shares its read-state, so the entry's own `read` field
  determines its section.
- **Count = section count.** `groupTotal` becomes the member count _of that read-state partition_
  ("6 unread DSAR", "4 read DSAR"). The separate `groupUnread` field and its accent pill are
  **removed** — with a read-homogeneous partition it is always `0` (read stack) or `== groupTotal`
  (unread stack), i.e. redundant.
- **Client split** in `StackList` changes from `groupUnread > 0` / `=== 0` to `!e.read` (Needs
  action) / `e.read` (Earlier). Standalone rows (null `group_key`, total 1) keep rendering as a plain
  card in whichever section their read-state puts them.

**No migration** — this is a query rewrite over existing columns.

## 2 · Sorting & time indicator (item 4)

**Change:** grouped read honors `FEED_SORTS` (`newest` | `oldest` | `priority-high` |
`priority-low`), and each stack header shows a relative-time indicator.

- **Representative is always the most-recent member** (rn = 1 ordered by `created_at DESC, id DESC`
  within the partition), regardless of sort — so the card always shows the latest item and its
  "2h ago" time (`relativeTime(representative.createdAt)`).
- **Group ordering** (the outer order over the rn = 1 rows) follows the sort:
  - `newest` → by representative `created_at DESC` (group with the latest member on top).
  - `oldest` → by representative `created_at ASC`.
  - `priority-high` → by `top_priority` rank `ASC` (most severe group on top), tie-broken by
    `created_at DESC, id DESC`.
  - `priority-low` → by `top_priority` rank `DESC`, same tie-break.
- **Sort-scoped grouped cursor.** The grouped cursor becomes sort-aware, mirroring the flat feed's
  keyset: it carries the ordering tuple (`priority_rank` for priority sorts, else `created_at`) plus
  the `id` tie-break, tagged with the sort so a cursor can't cross sorts. This replaces the current
  `{g, ts, id}` cursor.

## 3 · Inline actions in the peek (item 1)

**Change:** the expanded peek renders each member through the real
`NotificationCardRenderer` instead of the stripped-down `<li>` rows.

- Members render **collapsed by default**, exactly like the main feed, and expand in place to reveal
  their actions (link + dispatch, gated by `actionsEnabled`) with the existing pending/result
  feedback and action-locking — all inherited for free, no re-plumbing.
- The peek is still fetched lazily via the injected transport (`?group=<key>&limit=3`) and still shows
  loading / error+retry states. StackRow forwards `open` / `action` / `unread` from each card up to
  the panel, same as `FeedList` does.
- Removes the custom title/meta `<li>` markup and its `relativeTime` usage inside the member list
  (the header keeps the time indicator from §2).

## 4 · Mark whole group read (item 5)

**Change:** a "Mark all read" control in the expanded stack header marks every unread member of that
group read.

- **Server:** extend the existing bulk mark-all-read path with an optional `group` filter —
  `INSERT INTO notification_reads (…) SELECT … WHERE <audience> AND group_key = $group AND <unread>
ON CONFLICT DO NOTHING`. Idempotent by construction (upsert), audience-scoped to the caller's
  `userKey`, parameterized. Only unread members are affected; the read stack is already read.
- **Route:** the existing mark-all-read endpoint gains an optional `group` query param (validated with
  zod, `min(1).max(300)` like `?group=`). No new endpoint.
- **Client:** StackRow's header button calls it, then the panel refetches the grouped page. The
  unread stack disappears from Needs action; the read stack in Earlier grows to absorb them.
- Per-member read toggle is also available (free, since members are real cards) — a bonus, not the
  primary path.

## 5 · iOS/macOS stack visual (item 6)

**Chosen treatment:** "iOS peek" (mockup option A). The collapsed multi-member stack renders as the
most-recent member's card on top with **two real card edges fanned beneath it** (layered, inset,
progressively faded), reading as physical depth. Header carries: chevron, top-severity dot,
`groupLabel`, the single count, and the "2h ago" indicator.

- **Expanded (fanned) state:** the layers give way to the member peek (real cards, §3), an accent
  **left-rail on the header** signalling "you're inside this group", a **"Mark all read"** in the
  header (§4), and a **"See all in this group →"** footer.
- **"See all" (and the peek) are scoped to the opened stack's read-state.** _(Revised after code
  review — the original design drilled into the whole subject, but since a stack is read-homogeneous
  that let an unread stack's peek/See-all show read members and disagree with its own badge.)_ The
  drill-in adds an optional `read=true|false` filter (`?group=<key>&read=<state>`), threaded from
  `entry.read`; the flat feed's keyset cursor is scoped to `read` too. An unread stack shows its
  unread members, a read stack its read members — badge, representative, peek and See-all always
  agree. The footer label still **drops the hard number** ("See all in this group").
- Single-member entries (total 1) keep rendering as a plain card — no stack chrome, no fanned edges.
- Respect `prefers-reduced-motion` for any fan/expand transition; the layered edges are static CSS,
  not animation-dependent.

---

## API contract changes

Additive, but part of the read/write contract other hosts consume — folds into the same mentor
sanity-check as the original grouping work:

1. `GET /notifications?grouped=true` now honors `sort`, and its `nextCursor` format changes
   (sort-scoped). `GroupedEntry.groupUnread` is **removed**; `groupTotal` semantics change to
   per-(group, read-state).
2. The bulk **mark-all-read** endpoint gains an optional `group` query param.

## Testing

- **core (read-grouped):** a subject with 2 unread + 2 read → two entries (unread total 2 /
  read total 2), correct representative + `top_priority` each; each `FEED_SORTS` value orders groups
  as specified; sort-scoped cursor keyset-paginates with no overlap/skip and rejects a cross-sort /
  malformed cursor.
- **core (mark-all-read group):** marking a group read inserts reads only for its unread audience-
  scoped members, is idempotent on a second call, and doesn't touch other groups or other users.
- **server-fastify (route):** `grouped=true&sort=priority-high` orders by severity; mark-all-read with
  `group=` returns success and the group's members read on the next fetch; `group` on the mark-read
  route validates.
- **vue:** `StackList` splits by `read`; `StackRow` renders `NotificationCardRenderer` members and
  fires "mark all read"; the header shows the time indicator and single count (no unread pill).
- **e2e (grouping.spec):** update for the read-split — publish same-subject items, read one, assert it
  moves to an Earlier stack; "Mark all read" on the unread stack clears it into Earlier; sort by
  priority reorders stacks.

## Out of scope

- No change to how `group_key` is derived (the text strategy is unchanged).
- No re-grouping *inside* the drill-in — members render flat there (scoped to one read-state per §5,
  revised).
