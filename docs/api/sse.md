---
title: SSE API
tags: [api, sse, delivery, realtime]
---

# SSE (real-time delivery)

The live delivery channel (FR-5) — how a logged-in user's browser receives notifications
as they happen. The frontend feed opens one long-lived
[Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
connection to `GET /sse` and renders new cards as frames arrive.

This is the read side of the pipeline. Notifications enter via
[`POST /internal/publish`](./intake.md), are validated/deduped/persisted, and newly-accepted
ones are handed to an in-process **delivery hub** that fans them out to the open SSE
connections **the notification is addressed to**. The
[notification contract](./notifications.md) is the shape each frame carries.

Source of truth:
[`backend/src/http/sse/routes.ts`](../../backend/src/http/sse/routes.ts) (the endpoint,
headers, coalescing, heartbeat),
[`backend/src/http/sse/coalescing-buffer.ts`](../../backend/src/http/sse/coalescing-buffer.ts)
(burst batching),
[`backend/src/delivery/hub.ts`](../../backend/src/delivery/hub.ts) (fan-out),
[`backend/src/pipeline/ingest.ts`](../../backend/src/pipeline/ingest.ts) +
[`backend/src/audience/recipients.ts`](../../backend/src/audience/recipients.ts) (recipient
resolution).

> **Audience-scoped (implemented).** A notification is pushed only to connected users it is
> [addressed to](./notifications.md#audience-scoping): `audience.scope="global"` reaches
> every connected user (hub `broadcast()`), while `team` / `role` / `user` reaches only the
> resolved member set (hub `publishToRecipients()`). A `user`-scoped notification resolves by
> **username**; `team` / `role` resolve through the membership tables. If nobody addressed is
> currently connected, the live push simply reaches no one — the notification is still
> persisted and shows up on the next feed load. (This replaces the earlier prototype behavior
> where the stream was a global-only firehose; per-audience delivery is now in place, not
> deferred.)

---

## GET /sse

**Auth:** required (valid `session` cookie). Guarded by the same `requireUser` as
[`GET /auth/me`](./auth.md#get-authme). The browser's `EventSource` sends the `session`
cookie automatically on a same-origin request, so no extra header is needed. No cookie / not
logged in → `401`.

Opens a long-lived Server-Sent Events stream. This is **not** a normal request/response —
the socket stays open and the server pushes frames until the client disconnects.

### Response `200`

`Content-Type: text/event-stream`, with these headers to keep proxies and the browser from
buffering or closing an idle stream:

| Header              | Value                    |
| ------------------- | ------------------------ |
| `Content-Type`      | `text/event-stream`      |
| `Cache-Control`     | `no-cache, no-transform` |
| `Connection`        | `keep-alive`             |
| `X-Accel-Buffering` | `no`                     |

**On connect** the server immediately sends a reconnect-backoff hint and a comment line
marking the stream as open:

```
retry: 3000

: connected

```

### Notification frames

When notifications are delivered, the server sends a `notifications` event whose `data` line
is a **JSON array** of [Notification](./notifications.md#schema) objects:

```
event: notifications
data: [ {<Notification>}, {<Notification>}, ... ]

```

The `data` payload is always an **array** (never a bare object), because of coalescing —
see below. Each element is a full Notification exactly as defined in the
[contract](./notifications.md#schema); the shape is not redefined here.

### Coalescing

Notifications that arrive within a ~**100 ms** window are batched into a single
`notifications` frame (one `data` array with multiple items) rather than one frame per
notification. This cuts stream chatter under bursts. A quiet stream still delivers each
notification promptly in its own single-element array.

### Heartbeat

Roughly every **25 seconds** the server sends a comment line to keep the connection alive
through proxies and browsers:

```
: heartbeat

```

Clients must **ignore comment lines** (any line starting with `:`) — `EventSource` does this
for you; only lines with an `event:`/`data:` are surfaced as events. The `: connected` line
sent on connect is the same kind of comment.

### Delivery semantics

- **Newly-accepted only.** Only notifications freshly accepted by intake are pushed.
  Duplicates rejected by the idempotent intake (deduped on `id`) are **not** re-delivered.
- **At-most-once over the live stream.** Delivery is best-effort. A notification pushed while
  the client is briefly disconnected is **not replayed** on reconnect — there is **no
  `Last-Event-ID` / replay support** in the prototype. The durable record still exists in the
  database; the live stream is not the system of record.
- **Audience-scoped fan-out.** A notification is delivered only to connected users it is
  [addressed to](./notifications.md#audience-scoping) — `global` reaches all connected users,
  `team` / `role` / `user` reaches the resolved member set. See the banner above. Admins get
  no bypass: they receive only notifications addressed to them, like any other user.

### Errors

| Status | Body                                     | Reason                                     |
| ------ | ---------------------------------------- | ------------------------------------------ |
| 401    | `{ "error": "authentication required" }` | No valid `session` cookie (not logged in). |

The `401` is returned before the stream opens — an unauthenticated request gets an ordinary
JSON error response, not an event stream.

### Client example

Using the browser `EventSource` API (same-origin, so the `session` cookie is sent
automatically):

```ts
const es = new EventSource("/sse");

es.addEventListener("notifications", (e) => {
  const items = JSON.parse(e.data); // Notification[] — always an array (coalesced)
  for (const notification of items) {
    // render / prepend each card in the feed
  }
});

es.onerror = () => {
  // EventSource auto-reconnects using the server's `retry: 3000` backoff hint.
  // A 401 (not logged in) surfaces here too — send the user to log in.
};
```

Comment lines (`: connected`, `: heartbeat`) never fire a listener, so there is nothing to
handle for them.

### Side effects

None on the request itself (read-only). Each connection registers a subscriber on the
in-process delivery hub for its lifetime and unregisters it on disconnect; it publishes no
events and writes nothing.
