# @notifications/core

Framework-agnostic notification domain: the ingest pipeline (validate → dedupe → persist), the
audience-scoped read path (feed + counts), per-user read state, the in-process delivery hub, and
module/settings policy. Drop it into any Node app — you inject a `pg.Pool` and identity; the library
owns no connection, no `process.env`, and **no users table**.

## Install

```
pnpm add @notifications/core pg zod
```

`pg` and `zod` are peer/runtime deps you already have; `@notifications/shared` carries the contract.

## Migrate

The library ships its own schema and runs it against your pool under a dedicated
`notifications_schema_migrations` ledger (won't collide with your own migrations):

```ts
import pg from "pg";
import { migrate } from "@notifications/core";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool); // creates notifications, notification_reads, modules, global_settings + indexes
```

Reserved table names: `notifications`, `notification_reads`, `modules`, `global_settings`.

## Use

```ts
import { createNotificationService } from "@notifications/core";

const service = createNotificationService({
  pool,
  config: {
    // The module catalog is HOST config (ids + display labels) — not seeded in the DB.
    modules: [
      { id: "dsr", label: "DSR" },
      { id: "assessments", label: "Assessments" },
    ],
    adminRole: "admin", // role that gates listModules/setModuleEnabled/settings (default "admin")
  },
});

await service.ready(); // one-time: reconcile module state rows for the configured catalog
```

### Identity is injected — `Principal`

Every read takes an already-resolved principal. You resolve it however your app authenticates; the
library never derives identity itself.

```ts
interface Principal {
  userKey: string; // opaque, stable, non-reassignable user id (matches audience.id for scope "user")
  roles: string[]; // match audience.id for scope "role"
  teamKeys: string[]; // match audience.id for scope "team"
}
```

> **`userKey` must be stable and non-reassignable.** Read state is keyed on it with no FK to any
> users table. If you recycle a user id, the new holder inherits the old one's read state — key on an
> immutable subject id, and clean up `notification_reads` on user deletion if ids can be reused.

### Service API

```ts
service.ingest(raw): Promise<IngestResult>                       // producer side — validate/dedupe/persist/deliver
service.list({ principal, cursor?, limit?, sort? }): Promise<NotificationPage>  // throws InvalidCursorError
service.counts({ principal }): Promise<NotificationCounts>
service.markRead({ principal, id }): Promise<void>              // out-of-audience id throws NotFoundError
service.markReadBulk({ principal, ids }): Promise<void>
service.markUnread({ principal, id }): Promise<void>
service.listModules(): Promise<ModulePolicyView[]>
service.setModuleEnabled(id, enabled): Promise<void>
service.getSettings(): Promise<Settings>
service.updateSettings(patch): Promise<void>
service.delivery                                                 // DeliveryHub — subscribe({ principal, deliver })
service.adminRole                                               // the configured admin role
```

Audience matching is identical on the read side (SQL `audienceWhere`) and the live side (in-memory
`matchAudience` in the hub), so what a user sees equals what they receive.

## Delivery

`service.delivery` is an **in-process** hub — live push to currently-connected subscribers only.
Durability is Postgres: every accepted notification is persisted regardless of who's connected, and
offline recipients see it on their next `list()`. A distributed (multi-instance) transport behind the
same surface is a future seam.

## HTTP + SSE

To expose this over HTTP/SSE, mount `@notifications/server-fastify` (a thin Fastify plugin) rather
than hand-rolling routes.
