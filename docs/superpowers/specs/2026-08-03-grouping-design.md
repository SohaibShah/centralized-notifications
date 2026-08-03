# Notification grouping — design spec

**Date:** 2026-08-03
**Branch:** `feat/grouping` (off `main`)
**Status:** approved design, ready for implementation plan

## Context

A per-user `groupingEnabled` preference (`user_preferences.grouping_enabled`) and an admin-global
`groupingEnabled` feature flag (`global_settings`, surfaced on the admin features form) already exist
and persist, but **drive no behavior** — the feed only ever splits into "Needs action" (unread) /
"Earlier" (read). This feature makes the toggles real: it collapses notifications **about the same
thing** into a single stack with a true total count, expandable to a peek and then to a full
"See all" filter, à la iOS/macOS notification stacks.

The goal is to declutter bursts of related notifications (e.g. five events about one DSAR request)
without losing the app's "what needs my attention" framing, and to do it with **zero required
changes from producing modules**.

## Core decisions (all user-approved)

1. **Sameness = a derived `groupKey`**, computed by a **hot-swappable `GroupingStrategy`**. Not coarse
   module/category buckets — notifications collapse when they refer to the same subject.
2. **Default strategy is text-based and hybrid**: prefer a shared entity/id extracted from the title
   (_same instance_), fall back to a normalized template (_same kind_) when there's no id. Honors an
   optional `metadata.groupKey` if a module happens to set one, but never requires it.
3. **The strategy runs server-side at ingest** and the key is **persisted** on the notification, so
   the grouped read and the group filter are cheap and indexable.
4. **Server-assisted, not a heavyweight nested grouped-pagination endpoint**: grouping is a
   keyset-paginated `grouped=true` mode of the existing feed read (one collapsed entry per stack, with
   true totals), plus a `?group=` filter for a stack's members — both reuse the feed's cursor/scope
   machinery rather than adding a new unbounded read path.
5. **UI**: stacks live _inside_ the existing Needs action / Earlier split; click → inline peek →
   "See all" opens the group as a temporary filter with a banner + one-click exit (reusing the
   muted-view pattern shipped on `feat/muted-view`).
6. **Toggle gating mirrors the AI-summary pattern**: active iff admin flag AND per-user pref.

## Architecture

### The GroupingStrategy seam (hot-swappable)

A new library unit in `@notifications/core` (`src/grouping/`), following the codebase's existing
adapter conventions (channel adapters, `ActionDispatcher`):

```ts
export interface GroupAssignment {
  key: string; // stable, e.g. "dsr:dsar:1042"  — same key ⇒ same stack
  label: string; // display heading, e.g. "DSAR #1042"
}

export interface GroupingStrategy {
  /** Assign one notification to a group. `null` ⇒ ungroupable → renders as a standalone card. */
  keyFor(n: Notification): GroupAssignment | null;
}
```

Per-notification (not collection-clustering) because the key is stamped at ingest, one row at a
time. A future similarity/AI strategy that needs neighbors would require a different (re-clustering)
mechanism — explicitly **out of scope**; the interface just has to be swappable.

Wired into the service via config, exactly like `actionDispatcher` and `modules`:

```ts
createNotificationService({ pool, config: { modules, groupingStrategy? } });
```

Defaults to `TextGroupingStrategy` when omitted.

### Default: `TextGroupingStrategy` (hybrid)

`keyFor(n)` precedence:

1. **Explicit** — if `n.metadata?.groupKey` is a non-empty string, use `{ key: `${n.module}:${groupKey}`, label: n.title }` (module never required to set it).
2. **Instance (entity id)** — extract the first stable entity token from the **title** via a small
   set of anchored patterns: `#\d+`, `[A-Z]{2,}-\d+` (e.g. `DSAR-1042`), `\bid[:# ]\s*\w+\b`. If
   found, `key = ${module}:${normalizedEntity}`; `label` = the title trimmed to the entity's clause
   (fallback: full title). Groups all notifications about that one subject.
3. **Kind (template)** — else normalize the title to a template: lowercase, strip the volatile
   tokens (digits, ISO-ish dates, standalone hex/uuid-looking runs), collapse whitespace. `key =
${module}:${category ?? "_"}:${template}`; `label` = a human form of the template (e.g. Title-cased
   first ~40 chars). Groups the same _kind_ of event.
4. If step 3 yields an empty template (e.g. a title that is entirely an id already handled in 2),
   return `null` (standalone).

All deterministic and pure — unit-testable, live-friendly. Regexes are anchored and bounded (title is
`≤ 500` chars) to avoid ReDoS.

### Persistence

Migration (mirrored in `packages/core/migrations/` **and** `backend/migrations/`, added to
`backend/test/schema-parity.test.ts`'s `SHARED_TABLES`/columns check):

- `notifications.group_key text` (nullable — `null` = ungrouped/standalone)
- `notifications.group_label text` (nullable)
- index `on notifications (group_key)` (partial `where group_key is not null`) to serve the grouped
  read and the `?group=` filter.

Computed in the ingest pipeline (`packages/core/src/pipeline/`): after validation, call
`groupingStrategy.keyFor(n)` and persist `group_key`/`group_label` alongside the row. Idempotent —
re-ingesting the same id recomputes to the same key (deterministic strategy).

**Backfill command** (`packages/core`, runnable from the reference host): iterate existing rows, run
`keyFor`, `UPDATE` the two columns. Makes a strategy swap a two-step ("wire new strategy + backfill").

### Reads

Grouping is a **keyset-paginated mode of the existing feed read**, not a separate unbounded endpoint —
so it inherits NFR-2 (no OFFSET, no total scan) and reuses the audience + mute + cursor machinery. Two
touch points plus a field:

- **Feed items** (`FeedNotification`) gain `groupKey?: string` and `groupLabel?: string` — needed so a
  live SSE arrival can be attached to the right stack client-side.
- **`GET /notifications?grouped=true`** — the collapsed feed. Returns **one entry per distinct stack or
  standalone**, keyset-paginated newest-activity-first, audience-scoped (`audienceWhere`) and
  mute-filtered (`muteWhere`). Each entry is the group's **representative (most-recent) member row**
  annotated with `groupTotal`, `groupUnread`, and `topPriority` (per-group aggregates over the same
  scoped set); a `group_key IS NULL` row is its own entry with `groupTotal: 1`. The keyset cursor is
  the representative row's `(created_at, id)` — same opaque-cursor contract as today, and (per the
  muted-view precedent) **scoped to `grouped`** so it can't be replayed across modes. The client
  derives the Needs action / Earlier split from `groupUnread > 0`, exactly as it derives it from `read`
  on the flat feed. This is a `DISTINCT ON (group_key)` + correlated-aggregate query, keyset-bounded —
  moderately more SQL than the flat read, but the same shape and pagination.
- **`GET /notifications?group=<key>`** — the members of one group, reusing the flat keyset feed path (a
  new optional `group` filter alongside `sort`/`view`/`grouped`), audience- and mute-scoped, paginated.
  Serves both the inline peek (`&limit=3`) and the full "See all". A standalone entry (null key) needs
  no member fetch — it already renders as a card.

`grouped` and `group` are mutually exclusive (`grouped` lists stacks; `group` drills into one). Invalid
combinations → `400`. `GET /notifications/counts` (the bell badge) is unchanged — whole-dataset unread,
independent of grouping.

### Client (`@notifications/vue`)

- **Feed store** gains a grouped-mode branch. When grouping is active it loads `?grouped=true` (keyset
  paginated, same `load`/`loadMore` shape as today) into a grouped-entry list; when grouping is off (or
  a filter is active — see scope) it uses the existing flat path unchanged. Grouped entries live in
  their own reactive slice so live updates and the flat item list don't entangle.
- **Expand** shows a peek fetched via `?group=key&limit=3` (cached per group; prefetchable).
- **"See all"** sets a `group` filter → the store loads `?group=key` into the normal item list and the
  panel renders a **group banner + "Exit group"** (the muted-view banner/exit, generalized).
- **Live SSE**: an arriving item's `groupKey` bumps the matching summary (total/unread/latest,
  promote to needs-action) or inserts a new stack; reconciled by refetching `?grouped=true` (page 1)
  on panel open, mirroring how counts reconcile today.
- **Rendering**: a stack = collapsed header (label, `topPriority` dot, true `groupTotal`, unread badge) that
  expands to the peek + "See all N". `total === 1` renders as a plain `NotificationCardRenderer` card
  (no stack chrome).

### Toggle gating

Active for a user iff **`settings.flags.groupingEnabled` (admin) AND `preferences.groupingEnabled`
(user)**. When the admin flag is off, the per-user grouping control is hidden on the settings page
(mirrors the Ask-AI tab hiding when `chatbotEnabled` is false). Either off → the feed renders flat,
exactly as today. No new persistence — both toggles already exist.

## UI/UX (validated via mockups)

- Stacks render **inside Needs action / Earlier**; a group is placed by whether it has unread members
  (`groupUnread > 0` → Needs action), derived client-side. Each group appears exactly once.
- Click a stack → **inline peek of the 3 most-recent members** (unread dots shown) + a **"See all N"**
  button.
- "See all" → the feed filters to just that group (all members, paginated), with a **group banner**
  (label + total) and a **one-click "Exit group"** returning to the normal feed.
- Motion/tokens follow the design system (ivory/pine, priority dots, mono for counts/times); the
  stack uses layered-card affordance, `transition-colors`/`transform` only, reduced-motion honored.

## Scope boundaries (v1)

- **Filter chips / search active ⇒ flat (ungrouped) results.** Filtering narrows to specifics;
  grouping declutters the firehose. Combining them (partial per-group counts under a client filter)
  is confusing for little value. Clearing filters returns to stacks.
- **Muted view stays flat** (it is already a special peek).
- **No per-stack "mark all read"** — the See-all view's existing "Mark all read in scope" marks a
  group. Expanding a stack does **not** auto-read its members.
- **AI/similarity clustering is out of scope** — a future `GroupingStrategy` swap; the seam is the
  only forward-provision made now.

## Testing

- **Strategy units** (`TextGroupingStrategy`): metadata-key precedence; instance extraction (`#1042`,
  `DSAR-1042`); kind template (ids stripped → shared key); `null` for un-templatable titles; ReDoS
  bound (huge title returns promptly).
- **Ingest**: persists `group_key`/`group_label`; deterministic on re-ingest; backfill re-keys.
- **`?grouped=true`**: one entry per stack/standalone, correct `groupTotal`/`groupUnread`/`topPriority`,
  audience + mute scoping, keyset pagination with no overlap/skip, cursor scoped to the grouped mode.
- **`?group=` filter**: returns exactly the group's members, scoped + paginated; `grouped`+`group`
  together → `400`.
- **Feed store**: grouped-mode fetch, expand peek, see-all filter + exit, live SSE joins/creates a
  stack, filter-active ⇒ flat fallback, toggle gating (admin/user matrix).
- **e2e**: publish a same-subject burst → a stack with the right count appears → expand shows peek →
  See all shows all + banner → Exit returns → toggle grouping off → flat feed. Plus an error/edge
  case (grouping on but no groupable data → normal cards).
- Redis-stream / notifications-domain rules unaffected (grouping is a read/presentation concern;
  ingest still idempotent, mute/audience unchanged).

## Known cost characteristic (grouped read)

The `grouped=true` collapsed read aggregates whole groups (window functions over the caller's full
audience-scoped, un-muted set) before the outer keyset `LIMIT` trims the output — so a grouped **page's
cost scales with the user's total visible notification count, not the page size**. This is inherent to
collapsed grouping (you must see all of a group's members to count/rank them) and does not apply to the
flat feed or the `?group=` drill-in (both keyset-bounded, and the drill-in is served by the
`notifications_group_key_idx` partial index). It's an accepted trade-off of the server-assisted design;
**flag for a mentor sanity-check on the expected per-user volume ceiling** before it matters at scale.
A future optimization (materialized per-group summaries, or a `group_key`-anchored index strategy) can
reduce it without changing the API.

## Dependency / sequencing

The "See all" group view reuses the **muted-view banner + one-click-exit** pattern. `feat/muted-view`
is now merged to `main` and `feat/grouping` is based on it, so that pattern is present — the grouping
UI **generalizes the existing muted-view banner/exit** into a shared component both views use, rather
than adding a second one.

## Files touched (indicative, not exhaustive)

- `packages/shared/src/notification.ts` — `groupKey`/`groupLabel` on `FeedNotification`; group summary
  types; `groups` response schema.
- `packages/core/src/grouping/` — `GroupingStrategy` interface + `TextGroupingStrategy`.
- `packages/core/src/pipeline/` — stamp key at ingest; `packages/core/migrations/NNN_group_key.sql`;
  backfill command; `service.ts` config wiring; `src/read/feed.ts` — `grouped` collapsed read + `group`
  filter on `list`.
- `packages/server-fastify/src/routes/notifications.ts` — `grouped` + `group` query params on `GET /notifications`.
- `packages/vue/src/state/feed.ts` (+ a grouping slice), `components/panel/InboxTab.vue`,
  `components/components/FeedList.vue`, a new stack component; reuse the muted-view banner.
- `backend/migrations/NNN_group_key.sql`; `backend/test/schema-parity.test.ts`.
- `docs/api/notifications.md` — `grouped` + `group` query params on `GET /notifications` (via docs-writer).
