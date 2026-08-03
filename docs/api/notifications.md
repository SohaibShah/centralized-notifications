---
title: Notifications API
tags: [api, notifications, contract]
---

# Notifications

The notification contract — the single shape every module publishes and the frontend
renders. It is the **stable boundary of the domain-agnostic backend**: the system acts
only on the top-level fields (dedupes on `id`, resolves `audience`, applies policy on
`priority`/`category`) and treats `metadata` as opaque. New per-module needs are met by
extending `metadata`, **not** by changing this shape — that is what lets modules be added
without touching the core.

Source of truth: [`packages/shared/src/notification.ts`](../../packages/shared/src/notification.ts).
The zod schema there is shared and validated on **both** the frontend and the backend, so
there is exactly one definition of "a valid notification."

> This page documents the **contract**. The HTTP publish endpoint that enforces it —
> `POST /internal/publish` — is documented separately on the [Intake page](./intake.md)
> (auth, batching, dedupe, response shape, side effects).

> **Served by `@notifications/server-fastify`.** These routes are no longer hand-written in
> `backend/`. They are mounted by the `notificationFastifyPlugin` from
> `@notifications/server-fastify` (see the [BE library integration
> guide](../architecture/be-library-integration.md)), which the reference `backend/` app
> registers like any other host. The endpoint request/response shapes below are **unchanged**
> by the extraction.
>
> **Identity comes from the host, not an owned session.** The plugin never reads a session
> or a users table. The host supplies an `auth(req)` adapter that resolves its own identity to
> a `Principal` (`{ userKey, roles, teamKeys }`); the plugin's `requirePrincipal` preHandler
> calls it and returns `401` when it yields `null`. In the reference app that adapter maps the
> `session`-cookie user to a `Principal` with `userKey = username`. Read state is keyed on the
> opaque **`user_key`** (= that username), and the audience filter matches `userKey` /
> `roles` / `teamKeys` against `audience.scope` `user` / `role` / `team`. Wherever the pages
> below say "session cookie", that is the reference host's adapter — the plugin itself only
> ever sees the resolved `Principal`.

## Schema

Because this schema is the **input-validation boundary**, every free-text field and the
`actions` array is length-bounded — the bounds keep a buggy or hostile publisher from sending
abusive payloads. Overall request body size is additionally capped at the HTTP intake layer
(Task 5).

| Field         | Type                                        | Required | Notes                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string (1–200 chars, non-blank)             | yes      | Caller-supplied. **Also the dedupe / idempotency key** — re-publishing the same `id` is a dedupe (the later publish is skipped), not an update. Must be non-empty and non-blank; whitespace-only values are rejected (they'd otherwise split into distinct notifications).                                                            |
| `module`      | string (1–100 chars)                        | yes      | Originating module. Must be one of the **fixed, seeded module catalog** (`dsr`, `access-governance`, `data-mapping`, `assessments`); a notification whose `module` is not in the catalog is **rejected** at intake (counted `invalid`, logged, never persisted or delivered). Modules are no longer auto-discovered on first publish. |
| `title`       | string (1–500 chars)                        | yes      | Short heading shown on the card.                                                                                                                                                                                                                                                                                                      |
| `description` | string (≤ 5000 chars)                       | yes      | Body text. May be empty (`""`) but the field must be present.                                                                                                                                                                                                                                                                         |
| `priority`    | `'low' \| 'normal' \| 'high' \| 'critical'` | yes      | Drives policy and ordering.                                                                                                                                                                                                                                                                                                           |
| `snoozable`   | boolean                                     | yes      | Whether this notification may be snoozed. Required so every publisher makes the choice explicitly (no implicit default).                                                                                                                                                                                                              |
| `actions`     | array of [Action](#action) (≤ 10 items)     | no       | Module-owned callbacks surfaced as buttons on the card. At most 10 entries.                                                                                                                                                                                                                                                           |
| `audience`    | [Audience](#audience)                       | yes      | Who the notification is for.                                                                                                                                                                                                                                                                                                          |
| `category`    | string (1–100 chars)                        | no       | If omitted, derived from the module/domain.                                                                                                                                                                                                                                                                                           |
| `timestamp`   | string (ISO 8601)                           | no       | ISO 8601 datetime; a timezone offset is allowed (e.g. `2026-07-03T12:00:00Z` or `2026-07-03T17:30:00+05:30`). If omitted, set on intake.                                                                                                                                                                                              |
| `metadata`    | object                                      | no       | Opaque module-owned data — stored and passed through, [never interpreted by the system](#the-metadata-field).                                                                                                                                                                                                                         |

### Action

Each entry in `actions`:

| Field    | Type                                              | Required | Notes                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`  | string (1–100 chars)                              | yes      | Button text.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `kind`   | `'link' \| 'dispatch'`                            | no       | **Client-behavior discriminator** (default `"link"`). This — **not** `method` — decides what the button does: `link` opens `url` in a new tab; `dispatch` is forwarded through the server to the owning module via [`POST /notifications/:id/actions/:ref/dispatch`](#post-notificationsidactionsrefdispatch), documented in its own section below. A `navigate` value (route in-app) is anticipated but not yet implemented. |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | yes      | HTTP method associated with the action. **Superseded by `kind` for client behavior** — the UI branches on `kind`, not on `method`.                                                                                                                                                                                                                                                                                            |
| `url`    | string (http(s) URL, ≤ 2048 chars)                | yes      | Target the action calls. **Restricted to `http`/`https`** — `javascript:`, `data:`, `file:`, and `ftp:` are rejected as an XSS/SSRF safeguard, since the URL is rendered as a clickable/fetchable target.                                                                                                                                                                                                                     |
| `icon`   | string (1–100 chars)                              | no       | An icon **name** from the design-system icon set (e.g. `"check"`, `"external-link"`), **not** a URL or image. Extensible later (e.g. variant, confirm).                                                                                                                                                                                                                                                                       |

### Audience

| Field   | Type                                     | Required    | Notes                                                                                                                                                                         |
| ------- | ---------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope` | `'global' \| 'team' \| 'role' \| 'user'` | yes         | Who the notification targets.                                                                                                                                                 |
| `id`    | string (non-empty)                       | conditional | Identifies the team/role/user. **Required for `team`, `role`, `user`; absent for `global`** (everyone). Enforced by the schema — a non-global scope without `id` is rejected. |

## GET /notifications

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie. The cookie is same-origin, so a browser `fetch`/`EventSource` sends it automatically through the dev proxy.

The feed **read** path: returns the caller's notifications as one keyset-paginated page, ordered by the [`sort`](#request) param (newest-first by default). Read-only — no side effects. Notifications from a module an admin has disabled (`suppressed = true` — see the [Admin API](./admin.md)) are excluded from the returned list; they are still recorded, just never surfaced here.

Source of truth: [`packages/server-fastify/src/routes/notifications.ts`](../../packages/server-fastify/src/routes/notifications.ts), [`packages/core/src/read/feed.ts`](../../packages/core/src/read/feed.ts), [`packages/core/src/audience/match.ts`](../../packages/core/src/audience/match.ts). The reference host maps its session user to a `Principal` in [`backend/src/reference/principal-adapter.ts`](../../backend/src/reference/principal-adapter.ts).

> **Audience-scoped (implemented).** The feed returns **only** notifications addressed to the authenticated caller — not every notification. See [Audience scoping](#audience-scoping) below for exactly which rows a caller sees. (This replaces the earlier prototype behavior where every authenticated user saw every notification; audience resolution is now in place, not deferred.)

#### Audience scoping

A notification is visible to the caller **iff** its [`audience`](#audience) matches the caller's identity — resolved by the host `auth` adapter into a `Principal` (`userKey` = **username** in the reference app, plus the caller's `roles` and `teamKeys`; see [`backend/src/reference/principal-adapter.ts`](../../backend/src/reference/principal-adapter.ts) and [`packages/core/src/audience/match.ts`](../../packages/core/src/audience/match.ts)). A row is returned when **any** of these holds:

| `audience.scope` | Included when                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `global`         | always (reaches every authenticated user)                                                                       |
| `team`           | `audience.id` is one of the caller's team keys                                                                  |
| `role`           | `audience.id` is one of the caller's role keys                                                                  |
| `user`           | `audience.id` **equals the caller's username** (for `user` scope, `audience.id` holds the recipient's username) |

The match runs in SQL against the principal's arrays passed as bound parameters — there is no join to the identity tables, so the same filter is reusable when the host supplies identity directly. An empty role/team array fails closed (`= ANY('{}')` matches nothing), leaving `global` plus the caller's own `user`-scoped rows.

**Same filter, everywhere.** This exact audience predicate gates the feed **read** path, the [unread counts](#get-notificationscounts), and the [mark-read](#post-notificationsidread) endpoints. Because reads, counts, and mark-read all apply it, **no endpoint leaks the existence of a notification the caller can't see** — a caller can't infer an out-of-audience notification's existence from a count, a page, or a mark-read result.

**No admin bypass.** Admins are audience-scoped exactly like everyone else — being an admin does not reveal notifications addressed to others. (Admin module suppression is separate; it only ever hides rows, never reveals them.)

### Request

Query parameters:

| Param    | Type            | Required | Notes                                                                                                                                                                                                                                       |
| -------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`  | integer         | no       | Page size. Default `25`, min `1`, max `100`. Coerced from the query string; out-of-range or non-numeric → `400`.                                                                                                                            |
| `cursor` | string (opaque) | no       | The `nextCursor` from a previous page. **Opaque** — only ever pass back a value the server handed out; a malformed/undecodable cursor → `400`. **Sort-scoped** (see below): a cursor is only valid under the same `sort` it was issued for. |
| `sort`   | enum            | no       | Feed ordering. One of `newest`, `oldest`, `priority-high`, `priority-low`. Default `newest` (the prior behavior). Any other value → `400`. See the ordering table below.                                                                    |

**Ordering & pagination.** Keyset-paginated — there is **no `OFFSET`** (NFR-2), so a deep page costs the same as the first, and deliberately **no total count** (keyset paging never scans to one). The `sort` param selects the ordering:

| `sort`          | Ordering                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `newest`        | `created_at` descending — newest first. **Default**; the prior behavior. Keyset on `(created_at DESC, id DESC)`.     |
| `oldest`        | `created_at` ascending — oldest first. Keyset on `(created_at ASC, id ASC)`.                                         |
| `priority-high` | Priority high→low: `critical`, then `high`, then `normal`, then `low`. Within a single priority level, newest first. |
| `priority-low`  | Priority low→high: `low`, then `normal`, then `high`, then `critical`. Within a single priority level, newest first. |

**Sort-scoped cursor.** `cursor` is an opaque base64url token encoding the last returned row's ordering key **and the `sort` it was issued under**; clients must treat it as opaque. Because the keyset predicate is sort-specific, a cursor is only valid when replayed under the same `sort` — passing a cursor issued under one sort with a different `sort` value returns `400 { "error": "invalid cursor" }`, the same response as a malformed/undecodable cursor. In normal use this never happens: when the user changes sort, the client refetches page 1 (no cursor) rather than reusing the previous page's cursor.

### Response `200`

A [`NotificationPage`](../../packages/shared/src/notification.ts): a page of `items` plus a `nextCursor`. `nextCursor` is the token to pass back as `?cursor=` for the next (older) page, and is `null` once the oldest row has been reached.

```json
{
  "items": [
    {
      "id": "dsr-1234-sla-warning-72h",
      "module": "dsr",
      "title": "DSR #1234 is 3 days from SLA breach",
      "description": "A data-subject deletion request for a CA resident is due 2026-07-06.",
      "priority": "critical",
      "snoozable": true,
      "audience": { "scope": "team", "id": "privacy-ops" },
      "category": "sla",
      "actions": [
        {
          "label": "Open DSR",
          "method": "GET",
          "url": "https://app/dsr/1234",
          "icon": "folder-open"
        }
      ],
      "metadata": {
        "dsrId": "1234",
        "slaDueAt": "2026-07-06T00:00:00Z",
        "subjectRegion": "us-ca",
        "type": "erasure"
      },
      "createdAt": "2026-07-03T09:15:22.481Z",
      "read": false
    }
  ],
  "nextCursor": "eyJ0cyI6IjIwMjYtMDc…In0"
}
```

> The item above mirrors example B from [Examples](#examples) as the read path returns it — the same publish-contract shape, with `createdAt` and `read` added. `nextCursor` is shown truncated because the token is opaque; treat it as a value you only ever hand straight back as `?cursor=`.

#### `FeedNotification`

Each item is the full [notification contract](#schema) above **plus** two server-derived, per-viewer fields. These are **not** part of the publish contract — producers never send them, and they don't exist until a notification has been persisted and viewed:

| Field       | Type              | Notes                                                                                                                                                                                                                                                        |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createdAt` | string (ISO 8601) | Server **receive** time (`notifications.created_at`), distinct from the module's own optional [`timestamp`](#schema). The feed's ordering key under `newest`/`oldest`, and the tie-breaker within a level under the priority sorts (see [`sort`](#request)). |
| `read`      | boolean           | Whether **the requesting user** has read this notification (`LEFT JOIN` against `notification_reads`). Per-user: the same notification can be `read: true` for one user and `false` for another.                                                             |

**`actions` is re-validated at the read boundary, not just trusted from storage.** Same tolerant approach as [`ChatSource.actions`](#chatsource): [`packages/core/src/read/feed.ts`](../../packages/core/src/read/feed.ts)'s `parseActions` helper runs each persisted (jsonb) action entry through `actionSchema.safeParse` and **drops** any entry that no longer matches the current [`Action`](#action) schema (e.g. an older stored `dispatch` action from before `path` became required), instead of throwing. So a `FeedNotification.actions` array in the `GET /notifications` response can contain **fewer** entries than were originally persisted if any are invalid under the current schema — the endpoint never `500`s because of a stale/invalid stored action.

Read state lives in its own table — `notification_reads(user_key, notification_id, read_at, PRIMARY KEY(user_key, notification_id))` (see [`packages/core/migrations/002_notification_reads.sql`](../../packages/core/migrations/002_notification_reads.sql)). It is keyed on the opaque **`user_key`** (the host's user identifier — username in the reference app), so there is **no** foreign key to any identity table; only `notification_id` cascades `ON DELETE`. A row exists **iff** that user has read that notification; absence of a row means unread. The write endpoint that marks a notification read is [`POST /notifications/:id/read`](#post-notificationsidread), documented below.

### Errors

| Status | Body                                      | Reason                                                                                                                             |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid query parameters" }` | `limit` out of range (`< 1` or `> 100`) or non-numeric, or `sort` not one of `newest`/`oldest`/`priority-high`/`priority-low`.     |
| `400`  | `{ "error": "invalid cursor" }`           | `cursor` is malformed, not a token the server issued, or was issued under a different `sort` than the one requested (sort-scoped). |
| `401`  | `{ "error": "authentication required" }`  | No valid session cookie.                                                                                                           |

### Side effects

None — read-only.

## GET /notifications/counts

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Returns the current user's **unread** notification counts (FR-5), aggregated **server-side over the whole dataset** — not just the notifications on the loaded feed page. This is what the bell badge, the "Needs action" header count, and the per-priority chip counts read from, so they stay accurate rather than reflecting only the loaded keyset window. Read-only — no side effects.

Source of truth: [`packages/server-fastify/src/routes/notifications.ts`](../../packages/server-fastify/src/routes/notifications.ts) (the route) and [`packages/core/src/read/`](../../packages/core/src/read/) (the query logic).

The counted set uses the **same filters as the [feed read path](#get-notifications)**: it applies the identical [audience scoping](#audience-scoping) (only notifications addressed to the caller are counted), excludes rows this user has already read (per-user [`notification_reads`](#feednotification), matched by a `LEFT JOIN … WHERE r.user_key IS NULL`), and excludes `suppressed` rows (from admin-disabled modules — see the [Admin API](./admin.md)). A notification outside the caller's audience, one the user has read, or one that belongs to a disabled module contributes to none of the buckets — so the count equals exactly the caller's visible unread set.

> **Audience-scoped (implemented).** These counts are per-audience scoped: they count only notifications targeted at this user, under the same rules as [`GET /notifications`](#get-notifications). (This replaces the earlier prototype behavior where the counts spanned every notification regardless of audience.)

### Request

No parameters. **Absolute for now** — the endpoint ignores any active client-side filters (module, search); it always counts the user's full unread set. It is shaped to grow **optional** filter query params later without breaking the current contract (a call with no params keeps returning the absolute counts).

### Response `200`

A [`NotificationCounts`](../../packages/shared/src/notification.ts): the total `unread` plus a per-priority breakdown. `unread` is the **sum** of the four `unreadByPriority` buckets. All four priority keys (`critical`, `high`, `normal`, `low`) are **always present**, zero-filled — a priority with no unread rows is reported as `0`, never omitted.

```json
{
  "unread": 12,
  "unreadByPriority": { "critical": 3, "high": 7, "normal": 2, "low": 0 }
}
```

### Errors

| Status | Body                                     | Reason                   |
| ------ | ---------------------------------------- | ------------------------ |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie. |

### Side effects

None — read-only.

## POST /notifications/:id/read

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Marks a notification **read for the current user** (FR-6). Read state is per-user, so this only ever affects the caller's own `notification_reads` row — one user marking a notification read never changes another user's state.

**Audience-scoped.** The write is gated by the same [audience filter](#audience-scoping) as the read path: a notification **outside the caller's audience** returns `404`, **indistinguishable from a nonexistent `id`**. This is deliberate — it prevents an existence oracle (a caller can't tell "not addressed to me" apart from "doesn't exist"), and it stops a caller seeding a read row for a notification they can't see.

Source of truth: [`packages/server-fastify/src/routes/notifications.ts`](../../packages/server-fastify/src/routes/notifications.ts) (the route) and [`packages/core/src/read/`](../../packages/core/src/read/) (the query logic).

### Request

Path parameter:

| Param | Type                 | Required | Notes                                                                                              |
| ----- | -------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `id`  | string (1–200 chars) | yes      | The notification's contract [`id`](#schema). An id outside that shape (empty or too long) → `400`. |

**No request body.** The client sends no body and no content-type.

**Idempotent.** The mark is an `INSERT … ON CONFLICT (user_key, notification_id) DO NOTHING`, so repeating the call is a no-op — a double-click or an at-least-once retry never errors and never creates a duplicate row.

### Response `204`

`204 No Content` — no body. A subsequent [`GET /notifications`](#get-notifications) then returns `read: true` for this notification **for this user** (the list's `LEFT JOIN` against `notification_reads`).

### Errors

| Status | Body                                     | Reason                                                                                                                                                                                                                                                     |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid notification id" }` | `id` is empty or longer than 200 chars.                                                                                                                                                                                                                    |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                                                                                                                                                                                   |
| `404`  | `{ "error": "notification not found" }`  | No notification with that `id` exists **or** it exists but is outside the caller's [audience](#audience-scoping) — the two cases are deliberately indistinguishable (no existence oracle). A client can't seed read rows for arbitrary or unaddressed ids. |

### Side effects

One upsert into `notification_reads` (`(user_key, notification_id)`, keyed by the authenticated user). No events published.

## DELETE /notifications/:id/read

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Undoes a read **for the current user** — the inverse of [`POST /notifications/:id/read`](#post-notificationsidread). Removes the caller's row from `notification_reads` so the notification returns to "Needs action" (unread) in their feed. Read state is per-user, so this only ever affects the caller's own row — undoing one user's read never changes another user's state.

Source of truth: [`packages/server-fastify/src/routes/notifications.ts`](../../packages/server-fastify/src/routes/notifications.ts) (the route) and [`packages/core/src/read/`](../../packages/core/src/read/) (the query logic).

### Request

Path parameter:

| Param | Type                 | Required | Notes                                                                                              |
| ----- | -------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `id`  | string (1–200 chars) | yes      | The notification's contract [`id`](#schema). An id outside that shape (empty or too long) → `400`. |

**No request body.** The client sends no body and no content-type.

**Idempotent.** The handler is a plain `DELETE … WHERE user_key = $1 AND notification_id = $2`, so removing a row that isn't there is a no-op. Unlike the `POST` counterpart there is **no existence check** on the notification — deleting a read for an id that was never read (or that doesn't exist at all) still returns `204`, never `404`.

### Response `204`

`204 No Content` — no body. A subsequent [`GET /notifications`](#get-notifications) then returns `read: false` for this notification **for this user** (the list's `LEFT JOIN` against `notification_reads` no longer finds a row).

### Errors

| Status | Body                                     | Reason                                  |
| ------ | ---------------------------------------- | --------------------------------------- |
| `400`  | `{ "error": "invalid notification id" }` | `id` is empty or longer than 200 chars. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                |

### Side effects

At most one delete from `notification_reads` (`(user_key, notification_id)`, keyed by the authenticated user) — zero rows if the user had not read it. No events published.

## POST /notifications/:id/actions/:ref/dispatch

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Forwards a user's click on a [`dispatch`-kind](#action) action button to the action's **owning module**, and relays the module's response back to the caller — the server-side round-trip for actions whose `kind` is `"dispatch"` (as opposed to `link`, which the client opens directly). The hub never interprets the module's response beyond validating its shape; it only relays it.

Source of truth: [`packages/server-fastify/src/routes/notifications.ts`](../../packages/server-fastify/src/routes/notifications.ts) (the route), [`packages/core/src/action/dispatch.ts`](../../packages/core/src/action/dispatch.ts) (`dispatchAction` — gating, visibility, idempotency, relay), and [`packages/core/src/service.ts`](../../packages/core/src/service.ts) (the `NotificationService.dispatchAction` doc-comment).

### Request

Path parameters:

| Param | Type                      | Required | Notes                                                                                                                                                                                                                         |
| ----- | ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`  | string (1–200 chars)      | yes      | The notification's contract [`id`](#schema).                                                                                                                                                                                  |
| `ref` | string matching `/^\d+$/` | yes      | The target action's **index** into that notification's `actions` array (as a string, e.g. `"0"`). Must refer to an action whose `kind` is `"dispatch"` (a `link` action at that index is rejected — see [Errors](#errors-6)). |

Body:

| Field            | Type                 | Required | Notes                                                                                                     |
| ---------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `idempotencyKey` | string (1–200 chars) | yes      | Caller-supplied per-attempt key. **Not** the notification's `id` — see [Idempotency](#idempotency) below. |

A missing/invalid path param or body → `400 { "error": "invalid request" }` (params and body are validated together; either failing produces the same response).

### Response `200`

The raw [`ActionDispatchResult`](../../packages/core/src/types.ts) — the module's relayed response, not wrapped:

```json
{ "ok": true, "message": "Approved", "resolve": true }
```

| Field     | Type                       | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ok`      | boolean                    | Whether the module reported the action as successful. `false` on a module-reported failure, a non-2xx module response, a response that fails [`moduleActionResponseSchema`](../../packages/shared/src/notification.ts), or a thrown/timed-out dispatcher call (all collapse to `{ "ok": false, "message": "Action failed" }`, never a `500` — the module's own failure detail is never relayed). |
| `message` | string                     | Short user-facing status text from the module. Omitted if the module didn't send one.                                                                                                                                                                                                                                                                                                            |
| `resolve` | boolean                    | Present and `true` only when the module asked to mark the source notification resolved (see [Side effects](#side-effects-6)). Only ever honored when `ok` is `true`.                                                                                                                                                                                                                             |
| `actions` | array of [Action](#action) | Optional replacement action set the module hands back (e.g. an "Undo" button) to replace the notification's original `actions`. Bounded the same way (`max 10`) as the publish contract.                                                                                                                                                                                                         |

### Idempotency

Replaying the **same** `(userKey, notificationId, actionRef, idempotencyKey)` tuple returns the **previously recorded result without re-dispatching to the module** — the guard against Redis Streams' / client at-least-once retries duplicating a dispatch (e.g. double-charging an approval). A **different** `idempotencyKey` on the same notification/action is an independent attempt (a genuine second click gets a fresh dispatch). Backed by a durable `action_dispatches` table (`UNIQUE (user_key, notification_id, action_ref, idempotency_key)`) — see [`packages/core/migrations/006_action_dispatches.sql`](../../packages/core/migrations/006_action_dispatches.sql).

### Rate limit

The route declares a route-level `config.rateLimit`: `max: 20`, `timeWindow: "1 minute"`, keyed by `req.principal?.userKey` (falling back to `req.ip` if there's somehow no principal — shouldn't normally happen, since the route already requires one via `requirePrincipal`). Exceeding it returns a `429` from `@fastify/rate-limit`'s default error response (a body shape like `{ "statusCode": 429, "error": "Too Many Requests", "message": "Rate limit exceeded, retry in ..." }`, but that's the plugin's default, not a contract this route defines itself).

**This limit is opt-in per host.** Fastify ignores unknown keys in a route's `config`, so `config.rateLimit` only has any effect if the host application has registered the [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) plugin — a third-party host mounting `@notifications/server-fastify` without registering that plugin gets **no rate limiting on this route at all**, silently. The reference app registers it with `{ global: false }` in [`backend/src/server.ts`](../../backend/src/server.ts) (the same pattern already used for `POST /auth/login` in [`backend/src/auth/routes.ts`](../../backend/src/auth/routes.ts)), so in this repo's reference backend the limit is live.

### Errors

| Status | Body                                                             | Reason                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | `{ "error": "invalid request" }`                                 | `id`, `ref`, or the body's `idempotencyKey` fails validation (`ref` not `/^\d+$/`, `idempotencyKey` missing/empty/over 200 chars, etc).                                                                                                                                                                                                                                                          |
| `401`  | `{ "error": "authentication required" }`                         | No valid session cookie / the host `auth` adapter resolved no `Principal`.                                                                                                                                                                                                                                                                                                                       |
| `403`  | `{ "error": "actions disabled" }`                                | The global `actionsEnabled` kill-switch (see the [Admin API](./admin.md) feature flags) is off — actions are disabled for everyone (`ActionsDisabledError`).                                                                                                                                                                                                                                     |
| `404`  | `{ "error": "notification or action not found" }`                | Any of: the notification doesn't exist; it exists but is outside the caller's [audience](#audience-scoping) (same no-existence-oracle behavior as [`POST /notifications/:id/read`](#post-notificationsidread)); `ref` doesn't index a real action on that notification; or the indexed action's `kind` is `"link"`, not `"dispatch"` (`NotFoundError` — all four collapse to this one response). |
| `409`  | `{ "error": "module unavailable" }`                              | No `ActionDispatcher` transport was injected by the host, **or** the action's owning module is unknown to the registry, disabled, or has no registered `base_url` (`ModuleUnavailableError`).                                                                                                                                                                                                    |
| `429`  | _(`@fastify/rate-limit`'s default error body, not this route's)_ | The per-principal limit (20 dispatches/min, see [Rate limit](#rate-limit) above) was exceeded — **only enforced if the host has registered `@fastify/rate-limit`**; otherwise this route never returns a 429 on its own.                                                                                                                                                                         |

### Side effects

- **Module call.** On a fresh (non-replayed) attempt that passes all gates, one outbound call to the owning module via the host-injected `ActionDispatcher`, at `base_url + action.path` with the action's `method` (`GET`/`POST` only for dispatch actions).
- **Durable idempotency record.** One row written to `action_dispatches`, moved from `pending` to a terminal `ok`/`failed` status once the module responds (or the call throws/times out).
- **Conditional mark-read.** If the dispatch succeeds (`ok: true`) **and** the module's response also sets `resolve: true`, the notification is marked read for the calling principal — the same mechanism and same per-user semantics as [`POST /notifications/:id/read`](#post-notificationsidread). A failed dispatch, or a successful one without `resolve: true`, never touches read state.
- **No events published.**

### PII

Per the [notifications domain rules](../../.claude/rules/notifications-domain.md), neither the route nor `dispatchAction` **ever logs** the outbound dispatch payload (notification id, action ref, metadata, actor) or the module's response body — a thrown/failed dispatch is recorded durably by outcome only (`failed`, no message), and the cause is deliberately swallowed rather than logged, since it may carry the module's URL or payload.

## POST /notifications/read

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Bulk mark-read for the current user — what the panel's "mark all read" calls. Marks each
id in the batch read **for the caller**; read state is per-user, so this only ever affects
the caller's own `notification_reads` rows, same as the single-id endpoint above.

Source of truth: [`packages/server-fastify/src/routes/notifications.ts`](../../packages/server-fastify/src/routes/notifications.ts) (the route) and [`packages/core/src/read/`](../../packages/core/src/read/) (the query logic).

### Request

Body:

| Field | Type       | Required | Notes                                                                                                                    |
| ----- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ids` | `string[]` | yes      | 1–500 ids per request (batch capped so one call can't ask to write an unbounded set). Each id is 1–200 chars, non-empty. |

```json
{ "ids": ["dsr-1234-sla-warning-72h", "scan-run-556-sensitive-found"] }
```

**Unknown and out-of-audience ids are silently skipped.** Unlike the single-id endpoint
(which 404s for an id it can't see), the bulk endpoint filters the batch down to ids that
both exist **and** fall within the caller's [audience](#audience-scoping)
(`WHERE n.id = ANY($2::text[]) AND <audience filter>`) and marks only those read. An id
that isn't a real notification, or one addressed to someone else, simply contributes no
row — so a client doesn't need to pre-filter its batch, one stale id can't fail the whole
request, and no read row is ever created for a notification the caller can't see. This is
the same silent-skip behavior the endpoint already had for unknown ids, now extended to
out-of-audience ids.

**Idempotent.** Same mechanism as the single-id endpoint — `INSERT … ON CONFLICT
(user_key, notification_id) DO NOTHING` — so repeating a batch (or overlapping it with a
previous one) is a no-op; a retry or a double-click on "mark all read" never errors and
never creates duplicate rows.

### Response `204`

`204 No Content` — no body. A subsequent [`GET /notifications`](#get-notifications) then
returns `read: true` for every id in the batch that existed **and was in the caller's
audience**, for this user.

### Errors

| Status | Body                                     | Reason                                                                                                        |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid request body" }`    | `ids` is missing, empty, has more than 500 entries, or contains an id that is empty or longer than 200 chars. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                                      |

### Side effects

Zero or more inserts into `notification_reads` — one per id in the batch that corresponds
to an existing notification **within the caller's [audience](#audience-scoping)** (keyed by
the authenticated user). No events published.

## Per-user preferences & snooze/mute rules

The authenticated caller's own notification preferences — scalar toggles (grouping, summary
opt-out, toast threshold) plus a list of **snooze/mute rules** that hide notifications by
module or category. Every read and write below is **scoped to the caller's `user_key`**
(`req.principal.userKey`); a user can only ever see or change their own preferences. There is
no cross-user or admin view here — these are self-service settings, not the admin module policy.

Source of truth:
[`packages/server-fastify/src/routes/preferences.ts`](../../packages/server-fastify/src/routes/preferences.ts)
(the routes),
[`packages/shared/src/preferences.ts`](../../packages/shared/src/preferences.ts) (the shared
zod shapes, validated on both the frontend and backend),
[`packages/core/src/preferences/store.ts`](../../packages/core/src/preferences/store.ts) (the
store), and [`packages/core/src/preferences/mute.ts`](../../packages/core/src/preferences/mute.ts)
(the enforcement filter).

### Enforcement — where mute/snooze rules take effect

A **snooze/mute rule** hides matching notifications from the caller **everywhere a read is
audience-scoped**: the [feed](#get-notifications), the [unread counts](#get-notificationscounts),
the live [SSE stream](./sse.md), and the AI [summary](#post-notificationssummaryrefresh) /
[chat](#post-notificationschat) grounding sets. A notification is hidden when **both** hold:

- the notification is **`snoozable: true`** (see the [contract](#schema)) — the `snoozable` flag is
  the **only** gate, so a notification of **any priority (including `critical`)** can be snoozed/muted
  when its publisher marked it snoozable, while a **`snoozable: false`** notification is never affected
  by a rule and always comes through, whatever its priority; and
- the caller has an **active** rule whose `targetKind`/`target` matches the notification's `module`
  or `category`. A rule is active when `mutedUntil` is `null` (muted indefinitely) **or** a future
  timestamp (snoozed, not yet elapsed); an elapsed snooze stops hiding automatically.

The SQL predicate (feed/counts/AI grounding) and the in-memory twin (delivery hub / SSE) are
kept lockstep-identical, so "what your feed shows" always equals "what the live stream
delivers". Per the [global-vs-per-user precedence rule](#design-decisions), these per-user rules
can only **further** restrict delivery — they never re-enable something an admin has suppressed.

## GET /notifications/mute-targets

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

The **snooze/mute editor's catalog**: everything the caller can snooze or mute, each row carrying
**the caller's own priority mix**. Scoped to the authenticated principal — no other user's data is
exposed, and this is **not** the admin view (no `suppressed` state or `base_url`). It backs the
settings page's snooze/mute editor, which pairs this list with the caller's active
[rules](#the-rule-shape) (from [`GET /notifications/preferences`](#get-notificationspreferences)) to
show what's muted and what each rule would hide.

Two families of target are returned:

- **`modules`** — the **host's full module catalog** (clean `label`s), always listed in catalog
  order, even for a module the caller has never received a notification from (its mix is then all
  zeros). These are the ids a `module`-kind mute rule targets.
- **`categories`** — every category present in the caller's own (audience-scoped) notifications,
  **plus** any category the caller has **already muted** (a `category`-kind rule), even if they
  currently have no notifications in it. Including already-muted categories is deliberate: a muted
  category with no current items would otherwise vanish from the list and be impossible to un-mute.
  Categories are sorted by name.

**The priority mix is the caller's own counts, and is _not_ reduced by the caller's mute rules.**
Each `byPriority`/`total` is computed over the caller's **audience-scoped, non-`suppressed`**
notifications (see [audience scoping](#audience-scoping)), counting **both read and unread** — unlike
[`GET /notifications/counts`](#get-notificationscounts), there is no unread filter here. The counts
deliberately **ignore the mute filter**, so an already-muted module/category still reports its real
mix (that mix is exactly what tells the user what un-muting would surface). Only categories with a
non-null `category` contribute.

Source of truth:
[`packages/server-fastify/src/routes/preferences.ts`](../../packages/server-fastify/src/routes/preferences.ts)
(the route), `NotificationService.getMuteTargets` in
[`packages/core/src/service.ts`](../../packages/core/src/service.ts) (catalog + already-muted
assembly), and [`packages/core/src/read/mute-targets.ts`](../../packages/core/src/read/mute-targets.ts)
(the audience-scoped, non-mute-filtered count query). The response type is
[`MuteTargetsResponse`](../../packages/shared/src/preferences.ts).

### Request

No parameters.

### Response `200`

A [`MuteTargetsResponse`](../../packages/shared/src/preferences.ts) — `modules` and `categories`
arrays, each row carrying a per-priority mix and its `total`:

```json
{
  "modules": [
    {
      "id": "dsr",
      "label": "DSR",
      "byPriority": { "critical": 1, "high": 0, "normal": 2, "low": 0 },
      "total": 3
    },
    {
      "id": "access-governance",
      "label": "Access Governance",
      "byPriority": { "critical": 0, "high": 0, "normal": 0, "low": 0 },
      "total": 0
    }
  ],
  "categories": [
    {
      "name": "audit",
      "byPriority": { "critical": 0, "high": 1, "normal": 0, "low": 0 },
      "total": 1
    },
    {
      "name": "sla",
      "byPriority": { "critical": 1, "high": 0, "normal": 0, "low": 0 },
      "total": 1
    }
  ]
}
```

A **module** row ([`ModuleMuteTarget`](../../packages/shared/src/preferences.ts)):

| Field        | Type   | Notes                                                                                                                                                          |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | string | The module's registry id — the value a `module`-kind mute rule targets.                                                                                        |
| `label`      | string | Human-readable module name (from the host catalog) for the settings UI.                                                                                        |
| `byPriority` | object | The caller's own count per priority — all four keys (`critical`, `high`, `normal`, `low`) always present, zero-filled. Read **and** unread; not mute-filtered. |
| `total`      | number | Sum of the four `byPriority` buckets. `0` for a module the caller has no notifications from.                                                                   |

A **category** row ([`CategoryMuteTarget`](../../packages/shared/src/preferences.ts)) is identical
except the identifier field is `name` (the free-form category string) instead of `id`/`label`:

| Field        | Type   | Notes                                                                                                   |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------- |
| `name`       | string | The category string — the value a `category`-kind mute rule targets.                                    |
| `byPriority` | object | Same shape/semantics as the module row's `byPriority`.                                                  |
| `total`      | number | Sum of the buckets. `0` for a category present only because the caller has an existing mute rule on it. |

### Errors

| Status | Body                                     | Reason                   |
| ------ | ---------------------------------------- | ------------------------ |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie. |

### Side effects

None — read-only.

## GET /notifications/preferences

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Returns the caller's scalar preferences plus their list of active snooze/mute [rules](#the-rule-shape).
Read-only. When the user has never changed anything, the scalars are the stored column defaults
and `rules` is `[]`.

### Request

No parameters.

### Response `200`

A [`PreferencesResponse`](../../packages/shared/src/preferences.ts) — the scalars plus the rule list:

```json
{
  "groupingEnabled": true,
  "summaryOptOut": false,
  "toastMinPriority": "critical",
  "rules": [
    { "targetKind": "module", "target": "dsr", "mutedUntil": null },
    { "targetKind": "category", "target": "audit", "mutedUntil": "2026-08-01T08:00:00.000Z" }
  ]
}
```

| Field              | Type                             | Notes                                                                                                                  |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `groupingEnabled`  | boolean                          | Whether the feed threads related notifications by their correlation key.                                               |
| `summaryOptOut`    | boolean                          | When `true`, the AI [summary](#get-notificationssummary) is suppressed for this user (see below).                      |
| `toastMinPriority` | `'off' \| 'critical' \| 'high'`  | Which priorities pop the bottom-right toast. `off` = none; `critical` = critical only; `high` = high **and** critical. |
| `rules`            | array of [rule](#the-rule-shape) | The caller's active snooze/mute rules.                                                                                 |

#### The rule shape

Each entry in `rules` (and the shape written by the mute endpoints below) is a
[`MuteRule`](../../packages/shared/src/preferences.ts):

| Field        | Type                        | Notes                                                                                                               |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `targetKind` | `'module' \| 'category'`    | Whether the rule targets a module (by registry `id`) or a category (free-form string).                              |
| `target`     | string (1–100 chars)        | The module id or category string being muted.                                                                       |
| `mutedUntil` | string (ISO 8601) \| `null` | `null` = muted **indefinitely**; an ISO datetime = **snoozed until** that time (after which the rule stops hiding). |

### Errors

| Status | Body                                     | Reason                   |
| ------ | ---------------------------------------- | ------------------------ |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie. |

### Side effects

None — read-only.

## PATCH /notifications/preferences

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Partial update of the **scalar** preferences (the rules are managed by the mute endpoints
below, not here). The body is any **non-empty subset** of `groupingEnabled`, `summaryOptOut`,
`toastMinPriority`; an omitted field keeps its stored value. Returns the **merged** preferences
(scalars only — no `rules` array).

### Request

Body ([`preferencesPatchSchema`](../../packages/shared/src/preferences.ts) — the scalar shape,
`.partial()`, refined to reject an empty object):

| Field              | Type                            | Required | Notes                                  |
| ------------------ | ------------------------------- | -------- | -------------------------------------- |
| `groupingEnabled`  | boolean                         | no\*     | Enable/disable feed threading.         |
| `summaryOptOut`    | boolean                         | no\*     | Opt in/out of the AI summary.          |
| `toastMinPriority` | `'off' \| 'critical' \| 'high'` | no\*     | Toast threshold; other values → `400`. |

\* Each field is individually optional, but the body must contain **at least one** — an empty
`{}` is rejected with `400`.

```json
{ "summaryOptOut": true, "toastMinPriority": "high" }
```

### Response `200`

The merged scalar preferences (no `rules`):

```json
{ "groupingEnabled": true, "summaryOptOut": true, "toastMinPriority": "high" }
```

### Errors

| Status | Body                                     | Reason                                                                                            |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid request body" }`    | Empty body (no fields to update), an unknown field type, or a `toastMinPriority` not in the enum. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                          |

### Side effects

One upsert into the caller's `user_preferences` row. No events published.

## POST /notifications/mutes/:kind/:target

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Creates or updates (**upsert**) a single snooze/mute rule for the caller. Muting a
module/category that is already muted just overwrites the existing rule's `until`, so this is
safe to call repeatedly. See [Enforcement](#enforcement--where-mutesnooze-rules-take-effect)
for what a rule actually does.

### Request

Path parameters:

| Param    | Type                     | Required | Notes                                                                                                                                                                                                               |
| -------- | ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`   | `'module' \| 'category'` | yes      | Any other value → `400`.                                                                                                                                                                                            |
| `target` | string (1–100 chars)     | yes      | For `module`, must be a real module id from the [module catalog](#get-notificationsmute-targets) — an unknown id → `400`. For `category`, any non-empty string (categories are free-form; only shape is validated). |

Body ([`putMuteBodySchema`](../../packages/shared/src/preferences.ts)):

| Field   | Type                        | Required | Notes                                                                                                                                                    |
| ------- | --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `until` | string (ISO 8601) \| `null` | yes      | `null` = mute **indefinitely**; an ISO datetime = **snooze until** that time. A non-null value **must be in the future** — a past/now timestamp → `400`. |

```json
{ "until": "2026-08-01T08:00:00.000Z" }
```

### Response `204`

`204 No Content` — no body.

### Errors

| Status | Body                                         | Reason                                                                    |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid mute target" }`         | `kind` is not `module`/`category`, or `target` is empty / over 100 chars. |
| `400`  | `{ "error": "invalid request body" }`        | `until` is missing or not a valid ISO datetime (or `null`).               |
| `400`  | `{ "error": "until must be in the future" }` | A non-null `until` is at or before now.                                   |
| `400`  | `{ "error": "unknown module" }`              | `kind` is `module` but `target` is not a registered module id.            |
| `401`  | `{ "error": "authentication required" }`     | No valid session cookie.                                                  |

### Side effects

One upsert into the caller's `user_mute_rules`. No events published.

## DELETE /notifications/mutes/:kind/:target

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Removes a snooze/mute rule (un-mute / un-snooze). **Idempotent** — removing a rule that isn't
there still returns `204`, and unlike the `POST` there is **no** module-existence check (you can
always clear a rule, even for a target that's since been removed from the catalog).

### Request

Path parameters:

| Param    | Type                     | Required | Notes                                 |
| -------- | ------------------------ | -------- | ------------------------------------- |
| `kind`   | `'module' \| 'category'` | yes      | Any other value → `400`.              |
| `target` | string (1–100 chars)     | yes      | The module id or category to un-mute. |

**No request body.**

### Response `204`

`204 No Content` — no body.

### Errors

| Status | Body                                     | Reason                                                                    |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid mute target" }`     | `kind` is not `module`/`category`, or `target` is empty / over 100 chars. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                  |

### Side effects

At most one delete from the caller's `user_mute_rules` — zero rows if no such rule existed. No events published.

## GET /notifications/summary

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Returns the caller's **persisted AI triage digest** — a short couple-of-sentences summary of what needs attention. **This is a read, not a generation:** it returns the summary already stored for the caller and **never calls the `AiProvider`**, so it can't return `501`/`429`/`502`. Summaries are produced out-of-band — on a **schedule** (a daily per-user-local generation job in the reference host) or by an explicit [`POST /notifications/summary/refresh`](#post-notificationssummaryrefresh) — and `generatedAt` reflects that last generation (scheduled or manual). Read-only from the caller's perspective — it never changes read state.

Source of truth: [`packages/server-fastify/src/routes/summary.ts`](../../packages/server-fastify/src/routes/summary.ts) (the route + status mapping) and `NotificationService.getStoredSummary` in [`packages/core/src/service.ts`](../../packages/core/src/service.ts).

> **Per-user opt-out.** When the caller's [`summaryOptOut` preference](#get-notificationspreferences) is `true`, the endpoint short-circuits **before** reading the stored summary and returns the **empty shape with `optedOut: true`** (see below). The panel renders an "off" state instead of the digest + reload button.

> **Feature-flag gating is the consumer's concern here.** Unlike the [refresh endpoint](#post-notificationssummaryrefresh), this **read** does **not** call the `AiProvider` and does **not** return `404` when `aiSummaryEnabled` is off — it just reads the stored slot. Hiding the whole summary section when the feature is off is the caller's (panel's) responsibility, via the [feature-flags read endpoint](./admin.md).

### Request

No parameters. There are no query params, filters, or body.

### Response `200`

Every response carries a top-level **`optedOut`** boolean alongside the stored-summary shape.

When the caller has a stored summary and is **not** opted out:

```json
{
  "optedOut": false,
  "summary": "2 critical items need attention: a DSR is 3 days from SLA breach and an access request is awaiting your approval. The rest can wait.",
  "basedOn": 2,
  "generatedAt": "2026-07-30T06:00:00.000Z"
}
```

When the caller has no stored summary yet (no generation has run for them):

```json
{ "optedOut": false, "summary": null, "basedOn": 0, "generatedAt": null }
```

When the caller has **opted out** — the summary is suppressed regardless of what's stored:

```json
{ "optedOut": true, "summary": null, "basedOn": 0, "generatedAt": null }
```

| Field         | Type                      | Notes                                                                                                                                                                                                                                             |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optedOut`    | boolean                   | `true` when the caller's `summaryOptOut` preference is set — the digest is suppressed and the other three fields are always the empty shape (`null`/`0`/`null`), never a real summary.                                                            |
| `summary`     | string \| null            | The stored (trimmed) triage text, or `null` when nothing has been generated for the caller yet (or when opted out).                                                                                                                               |
| `basedOn`     | number                    | How many unread notifications informed the stored summary. `0` when there is no summary yet, **and also** when the summary is a "caught up" marker (see below).                                                                                   |
| `generatedAt` | string (ISO 8601) \| null | When the stored summary was produced (scheduled or manual refresh). `null` only when there is no stored summary. **`basedOn` of `0` with a _non-null_ `generatedAt` is the "caught up" marker** — a summary was generated but nothing was unread. |

### Errors

| Status | Body                                     | Reason                                                                     |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie / the host `auth` adapter resolved no `Principal`. |

### Side effects

None — read-only. No provider call, no read-state or notification writes, no events published.

## POST /notifications/summary/refresh

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

The manual **"reload"** endpoint. **Regenerates the caller's summary now**, persists it (updating `generatedAt`), and returns the fresh result. This is the on-demand counterpart to the scheduled generation job — where [`GET /notifications/summary`](#get-notificationssummary) only reads what's stored, this endpoint produces a new one and writes it to the **same** stored slot, so a subsequent `GET /notifications/summary` returns **exactly** what this refresh returned.

Generation reads the same set the [counts](#get-notificationscounts) do (audience-scoped, unread, non-suppressed), takes the **top 25 critical-first**, and hands their titles/descriptions to the **host-injected `AiProvider`** to summarize. In the reference app that provider is a local Ollama model behind an OpenAI-compatible adapter (see [`AiProvider`](../../packages/core/src/types.ts) and `NotificationServiceConfig.ai`); the library owns the prompt, the host owns the model transport.

Source of truth: [`packages/server-fastify/src/routes/summary.ts`](../../packages/server-fastify/src/routes/summary.ts) (the route + status mapping), [`packages/core/src/ai/summarize.ts`](../../packages/core/src/ai/summarize.ts) (`SummaryEngine` — gating, rate limit, provider call), and [`packages/core/src/ai/errors.ts`](../../packages/core/src/ai/errors.ts) (the error → status contract).

> **Gated by the same feature flag.** With `aiSummaryEnabled` off, this returns `404` (`AiDisabledError`) — see the error table below.

> **Per-user opt-out short-circuits generation.** When the caller's [`summaryOptOut` preference](#get-notificationspreferences) is `true`, the endpoint returns `200 { "optedOut": true, "summary": null, "basedOn": 0, "generatedAt": null }` **without** calling the `AiProvider` — the opt-out check runs before the flag/provider/rate-limit gates, so an opted-out user never triggers a generation.

### Request

No parameters. The endpoint always regenerates from the caller's full audience-scoped unread set (capped at 25); there are no query params, filters, or body.

### Response `200`

Like the read endpoint, every response carries a top-level **`optedOut`** boolean. For a caller who is **not** opted out, the freshly generated summary (now persisted) is returned:

```json
{
  "optedOut": false,
  "summary": "2 critical items need attention: a DSR is 3 days from SLA breach and an access request is awaiting your approval. The rest can wait.",
  "basedOn": 2,
  "generatedAt": "2026-07-30T14:22:09.117Z"
}
```

For an **opted-out** caller, no generation runs and the empty shape is returned:

```json
{ "optedOut": true, "summary": null, "basedOn": 0, "generatedAt": null }
```

| Field         | Type                      | Notes                                                                                                                                                |
| ------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optedOut`    | boolean                   | `true` when the caller's `summaryOptOut` preference is set — no generation ran and the other three fields are the empty shape.                       |
| `summary`     | string \| null            | The model-produced (trimmed) triage text. A provider that returns empty content is treated as a `502`, never a blank summary. `null` when opted out. |
| `basedOn`     | number                    | Size of the (capped, ≤ 25) unread set fed to the model. `0` when nothing was unread ("caught up" marker) or when opted out.                          |
| `generatedAt` | string (ISO 8601) \| null | The just-now generation time this refresh persisted. `null` when opted out (nothing was generated).                                                  |

### Rate limit

Two limits apply:

- **Per-recipient (model)** — provider calls are rate-limited per recipient (see [`SummaryEngine`](../../packages/core/src/ai/summarize.ts)); exceeding it surfaces as `429 { "error": "rate limited" }` (`AiRateLimitError`).
- **Route-level** — the route declares `config.rateLimit`: `max: 10`, `timeWindow: "1 minute"`, keyed by `req.principal?.userKey` (falling back to `req.ip`). Exceeding it returns `@fastify/rate-limit`'s default `429` body (`{ "statusCode": 429, "error": "Too Many Requests", "message": … }`). Like the [dispatch route's limit](#rate-limit), this is **opt-in per host** — it only takes effect if the host registered [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit); the reference app does (`{ global: false }` in [`backend/src/server.ts`](../../backend/src/server.ts)).

### PII

To produce the summary, the caller's unread notification **titles and descriptions** (descriptions truncated to 280 chars) are sent to the configured AI provider. In the reference app that provider is local (Ollama), but a host is free to inject a cloud model — so treat the summary context as leaving the process boundary. Per the [notifications domain rules](../../.claude/rules/notifications-domain.md), the engine **never logs the prompt context or the model output**; neither the notification bodies fed in nor the generated summary appears in logs.

### Errors

| Status | Body                                                                    | Reason                                                                                                                         |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `401`  | `{ "error": "authentication required" }`                                | No valid session cookie / the host `auth` adapter resolved no `Principal`.                                                     |
| `404`  | `{ "error": "ai summary disabled" }`                                    | The `aiSummaryEnabled` feature flag is off — the feature is turned off for everyone (`AiDisabledError`).                       |
| `429`  | `{ "error": "rate limited" }` _or_ `@fastify/rate-limit`'s default body | Per-recipient model limit (`AiRateLimitError`) or the route-level 10/min limit was exceeded (see [Rate limit](#rate-limit-1)). |
| `501`  | `{ "error": "ai not configured" }`                                      | No `AiProvider` was injected by the host — the feature is enabled but no model is wired (`AiNotConfiguredError`).              |
| `502`  | `{ "error": "summary unavailable" }`                                    | The injected provider failed — timeout, non-2xx, or empty completion (e.g. the local model is down) (`AiProviderError`).       |

### Side effects

- **Provider call.** One call to the injected `AiProvider` for a non-empty unread set (past the flag/provider/rate-limit gates).
- **Persisted summary.** The generated summary (including `generatedAt`) is written to the caller's stored summary slot — the exact value a subsequent [`GET /notifications/summary`](#get-notificationssummary) returns.
- **No events published.**

## POST /notifications/chat

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Streaming **AI Q/A** grounded in the caller's own notifications: the user asks a natural-language question and the answer is streamed back token-by-token over Server-Sent Events. It is the **second consumer of the host-injected `AiProvider` seam** (after [`GET /notifications/summary`](#get-notificationssummary)) — but where the summary triages the unread set, chat answers a specific question grounded in the caller's audience-scoped notifications, **both read and unread**. The library owns the retrieval, prompt, and gating; the host owns the model transport (in the reference app, a local Ollama model behind an OpenAI-compatible adapter).

**Chat is client-only multi-turn — nothing is persisted server-side.** There is no conversation table and no session state; the client holds the recent turns and replays them in the [`history`](#request-6) field on each request. The engine also **never logs** the question, the client-supplied history, or the matched notification content.

Source of truth: [`packages/server-fastify/src/routes/chat.ts`](../../packages/server-fastify/src/routes/chat.ts) (the route + SSE framing + status mapping), [`packages/core/src/ai/answer.ts`](../../packages/core/src/ai/answer.ts) (`AnswerEngine.answer` — gating, rate limit, retrieval, provider stream), [`packages/core/src/ai/retrieve.ts`](../../packages/core/src/ai/retrieve.ts) (grounding/retrieval), [`packages/core/src/ai/chat-prompt.ts`](../../packages/core/src/ai/chat-prompt.ts) (prompt construction), and [`packages/core/src/ai/errors.ts`](../../packages/core/src/ai/errors.ts) (the error → status contract).

> **Gated by a feature flag.** Chat is only available when the `chatbotEnabled` [setting](../../packages/core/src/types.ts) is on (see the [Admin API](./admin.md) feature flags). With it off the endpoint returns `404`, so a disabled feature is indistinguishable from a route that doesn't exist.

> **Pre-stream errors are normal JSON; mid-stream errors are an SSE frame.** The answer generator's first `.next()` runs the whole gate — flag check, provider check, rate limit, retrieval — **before** any bytes are streamed. The route advances the generator once _before_ hijacking the response, so anything that throws at the gate maps to an ordinary JSON error status (`400`/`401`/`404`/`429`/`501`/`502`) with the HTTP status set accordingly. Only after the first token does the route commit to a `200` SSE stream; a provider failure **after** streaming has started can no longer change the status (headers are already sent) and instead surfaces as an `error` SSE frame (see [Response](#response-200-3)).

### Request

Body (JSON, zod-validated at the boundary):

| Field      | Type                           | Required | Notes                                                                                                                                                                                                                                     |
| ---------- | ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `question` | string (1–2000 chars)          | yes      | The natural-language question. Empty or over 2000 chars → `400`.                                                                                                                                                                          |
| `history`  | array of [ChatTurn](#chatturn) | no       | The client-held recent conversation turns, replayed each request (chat is client-only multi-turn). Defaults to `[]`; **at most 8 items** — more → `400`. Core also re-caps at 8 (`slice(-8)`) so a direct library caller can't exceed it. |

#### ChatTurn

Each entry in `history`:

| Field     | Type                    | Required | Notes                                              |
| --------- | ----------------------- | -------- | -------------------------------------------------- |
| `role`    | `'user' \| 'assistant'` | yes      | Who produced the turn.                             |
| `content` | string (1–4000 chars)   | yes      | The turn's text. Empty or over 4000 chars → `400`. |

```json
{
  "question": "Which DSRs are close to their SLA?",
  "history": [
    { "role": "user", "content": "What needs my attention today?" },
    { "role": "assistant", "content": "A DSR is 3 days from its SLA breach." }
  ]
}
```

### Grounding / retrieval

The answer is grounded **only** in the caller's [audience-scoped](#audience-scoping) notifications — the same audience predicate as the feed, enforced **in SQL** as a bound-parameter `WHERE` clause with no join to any identity table. This means **one user can never receive another user's or audience's notifications in an answer**, even via prompt injection: the grounding set is filtered before it ever reaches the model. Suppressed (admin-disabled) rows are also excluded.

The item list is the union of three queries against `notifications`, deduped by `id` and capped at **20** items total:

| Source              | Query                                                                                                                                                                           | Cap |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Full-text relevance | Postgres full-text search — `n.search @@ websearch_to_tsquery('english', question)`, ordered by `ts_rank` descending. `websearch_to_tsquery` parameterizes the question safely. | 12  |
| Most urgent         | Ordered by `priority_rank ASC, created_at DESC` — guarantees the highest-severity items are present for "what's most urgent?".                                                  | 6   |
| Most recent         | Ordered by `created_at DESC`, **any priority** — guarantees a representative recent sample so a block of criticals can't crowd out every normal/low item.                       | 8   |

Arms are merged in that order (relevance → urgency → recency) and deduped. Alongside the sampled list, the model is given the **true whole-set distribution** — total count, per-priority counts, and unread count over the caller's entire audience-scoped set — so questions about totals or priority mix are answered from the real numbers even though the list itself is a capped sample. Each item is tagged **`[read]`/`[unread]`**; the system prompt instructs the model to answer **only** from the provided notifications, never invent them, scope by the question (unread-only, read-only, or both), and **decline anything that isn't about the user's notifications** (e.g. writing code, general-knowledge questions). Descriptions are truncated to 280 chars in the context.

### Response `200`

`200 OK` with `Content-Type: text/event-stream` — a Server-Sent-Events stream (not JSON). Headers also set `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no` (disables proxy buffering so tokens arrive incrementally). The body is a sequence of SSE frames, always in this order — **`sources` → token deltas → `done`** (or an `error` frame in place of `done` on a mid-stream failure):

- **Sources frame** — a **single** named-event frame emitted **first, before any token deltas**. It carries the trusted grounding set (the same audience-scoped notifications the answer is built from) as a JSON array of [`ChatSource`](#chatsource):

  ```
  event: sources
  data: [{"ref":"n1","id":"dsr-1234-sla-warning-72h","title":"DSR #1234 is 3 days from SLA breach","priority":"critical","ageMinutes":42,"actions":[{"label":"Open DSR","method":"GET","url":"https://app/dsr/1234","icon":"folder-open"}]}]

  ```

- **Token deltas** — many frames, one per model token chunk:

  ```
  data: {"delta":"Which "}

  data: {"delta":"DSRs..."}

  ```

- **Terminal frame** — once the model finishes, a single done marker and the stream closes:

  ```
  data: {"done":true}

  ```

- **Mid-stream error frame** — if the provider fails **after** streaming has started, a single error frame is written and the stream closes. Because the `200` headers were already sent, the **HTTP status stays `200`** — the failure is only visible in-band:

  ```
  event: error
  data: {"error":"stream failed"}

  ```

#### ChatSource

Each entry in the `sources` frame's array. The [`ChatSource`](../../packages/shared/src/notification.ts) type is the wire contract shared by server and browser (it lives in `@notifications/shared`), so the client can name it without depending on the server library:

| Field        | Type                                        | Notes                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`        | string                                      | Stable **per-answer** id (`"n1"`..`"nK"`), assigned over the grounding set in order. This is the tag the model cites inline (`[n#]`) and the key the client maps a citation back to.                                                                        |
| `id`         | string                                      | The cited notification's contract [`id`](#schema).                                                                                                                                                                                                          |
| `title`      | string                                      | The notification's title.                                                                                                                                                                                                                                   |
| `priority`   | `'low' \| 'normal' \| 'high' \| 'critical'` | The notification's priority.                                                                                                                                                                                                                                |
| `ageMinutes` | number                                      | Minutes since the notification's `created_at`.                                                                                                                                                                                                              |
| `actions`    | array of [Action](#action)                  | The notification's **real** actions (same `{ label, kind, method, url, icon? }` shape as the notification schema), **re-validated at the read boundary** — malformed/unsafe actions are dropped, so only vetted actions ever reach the client. May be `[]`. |

**Inline citations.** The model is instructed to cite notifications inline using their `[n#]` tag. The client maps a cited `[n#]` back to the matching `ChatSource` from the `sources` frame and renders it as an action-bearing chip. Because the model only **selects** from the trusted, server-sent `sources` (it never emits action URLs itself), it **can never fabricate an action** — the actions rendered are always the vetted ones the server sent.

The `sources` set is exactly the [audience-scoped grounding set](#grounding--retrieval) described above — no extra query, no scoping change. A caller's `sources` therefore only ever contain their **own** audience-scoped notifications, and (like the rest of the chat context) they are **never logged** (PII).

### Rate limit

Model calls are rate-limited **per recipient** to **10 per minute** (a sliding 60-second window, keyed on `principal.userKey`). Exceeding it throws at the gate (before any streaming), so it surfaces as a `429` JSON response, not an SSE frame. Single-instance, in-process — like the summarizer's limiter, not shared across replicas.

### PII

To answer, three things reach the configured AI provider (the intended egress): the caller's **question**, the client-supplied **history**, and the **matched notification content** (titles + descriptions, descriptions truncated to 280 chars). In the reference app the provider is local (Ollama), but a host may inject a cloud model — so treat the chat context as leaving the process boundary. Per the [notifications domain rules](../../.claude/rules/notifications-domain.md), the engine **never logs** the question, the history, the retrieved context, or the model output.

### Errors

All of these are returned as **normal JSON before any streaming** (the generator's first `.next()` runs the gate before the response is hijacked):

| Status | Body                                     | Reason                                                                                                                                                                                                             |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | `{ "error": "invalid request body" }`    | Body failed zod validation — missing/empty `question`, over 2000 chars, bad `history` shape, or `history` with > 8 items.                                                                                          |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie / the host `auth` adapter resolved no `Principal`.                                                                                                                                         |
| `404`  | `{ "error": "chat disabled" }`           | The `chatbotEnabled` feature flag is off — chat is turned off for everyone (`AiDisabledError`).                                                                                                                    |
| `429`  | `{ "error": "rate limited" }`            | The per-recipient rate limit (10 model calls/min) was exceeded (`AiRateLimitError`).                                                                                                                               |
| `501`  | `{ "error": "ai not configured" }`       | No streaming `AiProvider` was injected — the feature is enabled but the host wired no provider implementing `completeStream` (`AiNotConfiguredError`).                                                             |
| `502`  | `{ "error": "chat unavailable" }`        | The injected provider failed **before the first token** — timeout, non-2xx, etc. (`AiProviderError`). A failure _after_ the first token is an in-band SSE `error` frame instead (see [Response](#response-200-3)). |

### Side effects

None on the caller's data — read-only (no read-state or notification writes, no events published, nothing persisted about the conversation). The only state touched is the in-process per-user rate-limit window, and — once past the gate — one streaming call to the injected `AiProvider`.

## Design decisions

These are baked into the contract deliberately (contract checkpoint, see
`docs/implementation-plan.md` "Task 2"):

- **Unknown top-level fields are stripped, not rejected.** The schema is forwards-compatible:
  a publisher on a newer contract version can send extra top-level fields and older intake
  will silently drop them rather than fail validation. If you need the system to _act_ on a
  new field, it must be added to the schema — an unknown field is never load-bearing.
- **`id` doubles as the idempotency key.** There is no separate dedupe key. The caller owns
  the `id` and is responsible for making it stable and unique per logical event, so a retry
  (or an at-least-once redelivery once intake moves to Redis Streams in Week 5) dedupes to a
  single notification.
- **`snoozable` is required.** Every publisher states explicitly whether a notification can
  be snoozed rather than inheriting a default that might be wrong for the domain.
- **Global-vs-per-user precedence (delivery, not the contract).** A global admin disable or
  snooze always wins; per-user preferences may only _further restrict_ delivery, never
  re-enable something an admin turned off. This affects the delivery pipeline, not the shape
  of the message — noted here so publishers understand a valid, well-formed notification can
  still be legitimately withheld from a recipient.

## The `metadata` field

`metadata` is the module's **escape hatch** for domain-specific data the core never
interprets. The backend stores it and passes it through verbatim; it never branches on its
contents. This is what keeps the backend domain-agnostic.

The frontend uses `metadata` **generically** — never with per-module `if` branches:

- **Details section (a).** The card can expand into a "Details" key/value section rendered
  straight from the `metadata` object.
- **Grouping / threading (b, FR-18).** A correlation value in `metadata` (e.g. a shared
  `dsrId` or `scanId`) is used as a grouping key to thread related notifications together.
- **Filter / search (c, FR-11).** `metadata` values are searchable/filterable alongside the
  top-level fields.
- **"Go to source" deep-link fallback (d, FR-21).** When no explicit `action` points at the
  originating record, a URL-like value in `metadata` can back a "go to source" link.

The rule of thumb:

> If the **system** must act on a piece of data (dedupe, audience, policy) → promote it to a
> top-level field. If only the **module or the UI** cares about it → it belongs in
> `metadata`.

## Examples

All four validate against the schema. They are illustrative Securiti-module notifications.

### A — Access Governance approval

User-scoped, high priority, actions with icons.

```json
{
  "id": "accessreq-8842-approval",
  "module": "access-governance",
  "title": "Access request awaiting your approval",
  "description": "Priya Nair requested Admin access to the \"Prod-EU\" data catalog.",
  "priority": "high",
  "snoozable": false,
  "audience": { "scope": "user", "id": "u_212" },
  "category": "approvals",
  "actions": [
    {
      "label": "Approve",
      "method": "POST",
      "url": "https://app/api/access/8842/approve",
      "icon": "check"
    },
    { "label": "Deny", "method": "POST", "url": "https://app/api/access/8842/deny", "icon": "x" },
    {
      "label": "Review",
      "method": "GET",
      "url": "https://app/access/8842",
      "icon": "external-link"
    }
  ],
  "metadata": {
    "requestId": "8842",
    "requester": "u_309",
    "resource": "catalog:prod-eu",
    "riskScore": 72
  }
}
```

### B — DSR SLA warning

Team-scoped, critical priority.

```json
{
  "id": "dsr-1234-sla-warning-72h",
  "module": "dsr",
  "title": "DSR #1234 is 3 days from SLA breach",
  "description": "A data-subject deletion request for a CA resident is due 2026-07-06.",
  "priority": "critical",
  "snoozable": true,
  "audience": { "scope": "team", "id": "privacy-ops" },
  "category": "sla",
  "actions": [
    { "label": "Open DSR", "method": "GET", "url": "https://app/dsr/1234", "icon": "folder-open" }
  ],
  "metadata": {
    "dsrId": "1234",
    "slaDueAt": "2026-07-06T00:00:00Z",
    "subjectRegion": "us-ca",
    "type": "erasure"
  }
}
```

### C — Data mapping discovery

Global-scoped, normal priority, no actions, `timestamp` and `category` omitted (derived on
intake).

```json
{
  "id": "scan-run-556-sensitive-found",
  "module": "data-mapping",
  "title": "Sensitive data found in 2 new data stores",
  "description": "The nightly scan classified SSN and credit-card data in newly connected stores.",
  "priority": "normal",
  "snoozable": true,
  "audience": { "scope": "global" },
  "metadata": { "scanId": "556", "storeCount": 2, "classifications": ["ssn", "credit-card"] }
}
```

### D — Assessments reminder

Role-scoped, low priority.

```json
{
  "id": "assessment-q3-reminder-security",
  "module": "assessments",
  "title": "Q3 vendor risk assessments due this week",
  "description": "4 assessments assigned to your role are still in draft.",
  "priority": "low",
  "snoozable": true,
  "audience": { "scope": "role", "id": "security-reviewer" },
  "category": "reminders",
  "actions": [
    {
      "label": "View assessments",
      "method": "GET",
      "url": "https://app/assessments?state=draft",
      "icon": "clipboard-list"
    }
  ],
  "metadata": { "quarter": "2026-Q3", "draftCount": 4 }
}
```

## Publish API

The contract above is validated at **`POST /internal/publish`** — the service-to-service
intake endpoint where backend modules publish notifications. Its auth (shared internal
token), batch behavior, dedupe/idempotency semantics, response shape, status codes, and
side effects are documented on the [Intake page](./intake.md).
