---
title: BE library integration
tags: [architecture, backend, library, integration]
---

# Wiring the notification backend into a host app

## What this is

The notification backend is not a standalone service — it ships as two importable packages a
host application mounts into its own process:

- **`@notifications/core`** — the framework-agnostic domain. It owns the pipeline
  (validate → dedupe → persist → deliver), the audience-scoped read/counts/read-state queries,
  module policy + settings state, the in-process delivery hub, and its own schema migrations.
  It reads no environment and owns no identity or users table.
- **`@notifications/server-fastify`** — a thin Fastify plugin that mounts the HTTP + SSE
  routes ([`GET /notifications`](../api/notifications.md), [`GET /sse`](../api/sse.md),
  [`POST /internal/publish`](../api/intake.md), the [`/admin/*` + `/settings/features`](../api/admin.md)
  routes) onto the host's Fastify instance and adapts each request to a call on the core
  service.

The dashboard in [`backend/`](../../backend) is **itself just the reference consumer** of these
packages — it wires them the way any third-party host would, and adds only the things a host is
expected to own: login/sessions, the identity → `Principal` mapping, and the dev/QA
simulate + maintenance routes. Nothing about the notification domain is special-cased in
`backend/`; it is the worked example this guide describes.

The HTTP/SSE endpoint shapes are **unchanged** by this extraction — the same requests and
responses documented in the [API reference](../api/) are now produced by the plugin instead of
hand-written routes.

## The three wiring steps

### 1. Construct the service over your pool + catalog

`createNotificationService` takes a host-provided `pg` pool and a
`NotificationServiceConfig`. It reads no env and opens no connection of its own.

```ts
import { createNotificationService } from "@notifications/core";

const service = createNotificationService({
  pool, // your pg Pool
  config: {
    modules: [
      { id: "dsr", label: "DSR" },
      { id: "access-governance", label: "Access Governance" },
      { id: "data-mapping", label: "Data Mapping" },
      { id: "assessments", label: "Assessments" },
    ],
    adminRole: "admin", // role that gates the admin routes; defaults to "admin"
  },
});

await service.ready(); // one-time startup reconcile: ensures a state row per configured module
```

Call `service.ready()` once before serving. See the reference wiring in
[`backend/src/reference/service.ts`](../../backend/src/reference/service.ts) and
[`backend/src/reference/catalog.ts`](../../backend/src/reference/catalog.ts).

### 2. Run the library's migrations

The library owns its own schema (`notifications`, `notification_reads`, `modules`,
`global_settings`) and ships a forward-only runner. Point it at the same pool:

```ts
import { migrate } from "@notifications/core";

await migrate(pool);
```

`migrate` applies each `migrations/*.sql` in lexical order, each in its own transaction, and
records applied files in a `notifications_schema_migrations` ledger — a name chosen so it never
collides with a host's own migration system. It is idempotent (re-running is a no-op).

> The **reference `backend/` app does not call `migrate`** — its historical migrations already
> built these tables, so its ledger and the library's would overlap. A _fresh_ host with no
> prior notification tables calls `migrate(pool)` to build the whole schema. See
> [`packages/core/src/migrate.ts`](../../packages/core/src/migrate.ts).

### 3. Register the Fastify plugin with your auth adapters

```ts
import { notificationFastifyPlugin } from "@notifications/server-fastify";

const app = Fastify({ maxParamLength: 256 }); // REQUIRED — see below

await app.register(notificationFastifyPlugin, {
  service,
  // Resolve YOUR identity to a Principal. Return null -> 401. This is the sole identity
  // entry point; the plugin never reads sessions or a users table itself.
  auth: async (req) => {
    const user = await getSessionUser(req);
    return user ? { userKey: user.username, roles: user.roles, teamKeys: user.teamIds } : null;
  },
  // Gate the service-to-service publish endpoint. Return false -> 401. Whatever "a trusted
  // producer" means to the host lives here (a shared token in the reference app).
  intakeAuth: (req) => intakeTokenMatches(req),
});
```

The reference wiring is [`backend/src/server.ts`](../../backend/src/server.ts); its identity
mapping is [`backend/src/reference/principal-adapter.ts`](../../backend/src/reference/principal-adapter.ts).

Three things a host is responsible for:

- **`maxParamLength: 256`.** A notification `id` can be up to 200 chars and appears as the
  `:id` path param on the read routes. Fastify's default `maxParamLength` of 100 would `414` a
  valid long id _before_ the handler runs. A plugin can't change this server-level option, so
  the host must construct Fastify with `maxParamLength >= 256`.
- **Rate limiting.** The plugin does **not** rate-limit any route (including
  `/internal/publish`) — the host adds it around the registration if wanted. See the note on
  the [Intake page](../api/intake.md#rate-limiting).
- **Login / sessions / users.** Entirely the host's. The library only ever sees the resolved
  `Principal`.

## Identity: the `auth` adapter and `Principal`

The library's identity contract is the `Principal`:

```ts
interface Principal {
  userKey: string; // opaque host user key — matches audience.scope="user" (= username in the reference app)
  roles: string[]; // matches audience.scope="role" and gates admin via `adminRole`
  teamKeys: string[]; // matches audience.scope="team"
}
```

- **`auth(req) => Principal | null`** gates every user-facing route via the plugin's
  `requirePrincipal` preHandler; `null` → `401`. The admin routes additionally require the
  `Principal`'s `roles` to include the configured `adminRole`; missing → `403`.
- **`intakeAuth(req) => boolean`** gates only `POST /internal/publish`; `false` → `401`. This is
  a producer/service check, not a user session.

Read state is stored against the opaque **`user_key`** (= `Principal.userKey`), with **no
foreign key to any identity table** — the library deliberately owns no users. In the reference
app `userKey` is the username, so a user's read state follows their username.

## Host config vs. library-owned state

| Concern                                       | Owner           | Where                                                                                                        |
| --------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| Which modules exist + their display `label`   | **Host config** | `NotificationServiceConfig.modules` (the catalog passed at construction)                                     |
| Per-module `enabled` / `last_seen` state      | **Library DB**  | `modules` table, toggled via [`PATCH /admin/modules/:key`](../api/admin.md#patch-adminmoduleskey)            |
| Global feature flags + retention (`Settings`) | **Library DB**  | `global_settings` singleton, read/written via the [admin settings routes](../api/admin.md#get-adminsettings) |
| Identity (users, sessions, roles, teams)      | **Host**        | resolved to a `Principal` by the `auth` adapter                                                              |

A module absent from the host catalog is **unknown** even if a stale state row exists — the
catalog, not the DB, is the source of truth for "which modules exist". This is why a
notification naming a module outside the catalog is rejected as `invalid` at intake.

## Delivery is in-process (for now)

Real-time delivery is a single in-process fan-out hub
([`packages/core/src/delivery/hub.ts`](../../packages/core/src/delivery/hub.ts)): when the
pipeline accepts a notification for an enabled module, it calls `hub.publish(...)`, which
matches each connected SSE subscriber's `Principal` against the notification's `audience` and
delivers to the matches. The [`GET /sse`](../api/sse.md) route is the only subscriber.

This assumes a **single server instance**: the hub lives in one process's memory, so a
notification published on instance A is not seen by an SSE connection held on instance B. A
horizontally-scaled host would need a distributed pub/sub transport behind the hub (and the
`PolicyStore` cache would need TTL + pub/sub invalidation). That transport is a **documented
future seam**, not built in this pass — the hub interface is the place it would slot in without
touching the pipeline or the routes. The durable record is always the `notifications` table;
the live stream is best-effort and never the system of record.
