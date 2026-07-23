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

| Field    | Type                                              | Required | Notes                                                                                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`  | string (1–100 chars)                              | yes      | Button text.                                                                                                                                                                                                                                                                                                                           |
| `kind`   | `'link' \| 'dispatch'`                            | no       | **Client-behavior discriminator** (default `"link"`). This — **not** `method` — decides what the button does: `link` opens `url` in a new tab; `dispatch` is reserved for a future server-side action-dispatch proxy and is currently **stubbed in the UI**. A `navigate` value (route in-app) is anticipated but not yet implemented. |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | yes      | HTTP method associated with the action. **Superseded by `kind` for client behavior** — the UI branches on `kind`, not on `method`.                                                                                                                                                                                                     |
| `url`    | string (http(s) URL, ≤ 2048 chars)                | yes      | Target the action calls. **Restricted to `http`/`https`** — `javascript:`, `data:`, `file:`, and `ftp:` are rejected as an XSS/SSRF safeguard, since the URL is rendered as a clickable/fetchable target.                                                                                                                              |
| `icon`   | string (1–100 chars)                              | no       | An icon **name** from the design-system icon set (e.g. `"check"`, `"external-link"`), **not** a URL or image. Extensible later (e.g. variant, confirm).                                                                                                                                                                                |

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

## GET /notifications/summary

**Auth:** required — the host `auth` adapter must resolve a `Principal` (`requirePrincipal`; `401` if it returns `null`). In the reference app that means a valid `session` cookie.

Returns a short **AI triage digest** of the caller's own **unread** notifications — a couple of sentences telling the user what needs attention, rather than another list. It reads the same set the [counts](#get-notificationscounts) do (audience-scoped, unread, non-suppressed), takes the **top 25 critical-first** (`ORDER BY priority_rank ASC, created_at ASC` — highest priority first, oldest first within a priority), and hands their titles/descriptions to a **host-injected `AiProvider`** to summarize. In the reference app that provider is a local Ollama model behind an OpenAI-compatible adapter (see [`AiProvider`](../../packages/core/src/types.ts) and `NotificationServiceConfig.ai`); the library owns the prompt, the host owns the model transport. Read-only from the caller's perspective — it never changes read state.

**Empty unread set is short-circuited.** If the caller has nothing unread, the endpoint returns `{ "summary": "You're all caught up.", "basedOn": 0 }` **without calling the model at all** — no provider round-trip, no rate-limit charge.

Source of truth: [`packages/server-fastify/src/routes/summary.ts`](../../packages/server-fastify/src/routes/summary.ts) (the route + status mapping), [`packages/core/src/ai/summarize.ts`](../../packages/core/src/ai/summarize.ts) (`SummaryEngine.summarize` — gating, cache, rate limit, provider call), and [`packages/core/src/ai/errors.ts`](../../packages/core/src/ai/errors.ts) (the error → status contract).

> **Gated by a feature flag.** The digest is only available when the `aiSummaryEnabled` [setting](../../packages/core/src/types.ts) is on (see the [Admin API](./admin.md) feature flags). With it off the endpoint returns `404`, so a disabled feature is indistinguishable from a route that doesn't exist.

### Request

No parameters. The endpoint always summarizes the caller's full audience-scoped unread set (capped at 25); there are no query params, filters, or body.

### Response `200`

```json
{
  "summary": "2 critical items need attention: a DSR is 3 days from SLA breach and an access request is awaiting your approval. The rest can wait.",
  "basedOn": 2
}
```

| Field     | Type   | Notes                                                                                                                                                                                        |
| --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary` | string | The model-produced (trimmed) triage text, or the fixed `"You're all caught up."` when nothing is unread. A provider that returns empty content is treated as a `502`, never a blank summary. |
| `basedOn` | number | How many unread notifications informed the summary — the size of the (capped, ≤ 25) set fed to the model. `0` for the caught-up case.                                                        |

### Caching & cost

The server caches the last summary **per user**, keyed by a **signature of the unread set** (a SHA-256 of the total-unread count plus the ordered ids of the top-25). A repeat request whose unread set hasn't changed returns the cached summary **without re-invoking the model** — so re-opening the panel is free, and only a real change to the unread set (a new notification, or one marked read) triggers a fresh model call. The signature includes the total unread count, so a change _outside_ the top-25 window still invalidates the cache. The cache is single-instance, in-process (like the policy cache), not shared across replicas.

The frontend fetches this endpoint **lazily** — only on first expand of the AI-summary disclosure, not on every feed load — so a user who never opens it never triggers a model call.

### Rate limit

Provider calls are rate-limited **per recipient** to **6 per minute** (a sliding 60-second window). Exceeding it returns `429`. Cache hits and the empty-set short-circuit don't count against the limit — only calls that actually reach the model do.

### PII

To produce the summary, the caller's unread notification **titles and descriptions** (descriptions truncated to 280 chars) are sent to the configured AI provider. In the reference app that provider is local (Ollama), but a host is free to inject a cloud model — so treat the summary context as leaving the process boundary. Per the [notifications domain rules](../../.claude/rules/notifications-domain.md), the engine **never logs the prompt context or the model output**; neither the notification bodies fed in nor the generated summary appears in logs.

### Errors

| Status | Body                                     | Reason                                                                                                                   |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie / the host `auth` adapter resolved no `Principal`.                                               |
| `404`  | `{ "error": "ai summary disabled" }`     | The `aiSummaryEnabled` feature flag is off — the feature is turned off for everyone (`AiDisabledError`).                 |
| `429`  | `{ "error": "rate limited" }`            | The per-recipient rate limit (6 model calls/min) was exceeded (`AiRateLimitError`).                                      |
| `501`  | `{ "error": "ai not configured" }`       | No `AiProvider` was injected by the host — the feature is enabled but no model is wired (`AiNotConfiguredError`).        |
| `502`  | `{ "error": "summary unavailable" }`     | The injected provider failed — timeout, non-2xx, or empty completion (e.g. the local model is down) (`AiProviderError`). |

### Side effects

None on the caller's data — read-only (no read-state or notification writes, no events published). The only state touched is the in-process per-user summary cache and rate-limit window, and — on a cache miss for a non-empty set — one call to the injected `AiProvider`.

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
