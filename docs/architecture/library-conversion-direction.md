# Direction: convert the notification system into importable libraries

**Status:** agreed direction, NOT yet started. Deferred until after sorting + audience scoping.
**Date:** 2026-07-21
**Origin:** mentor request — the project overall should become libraries, not just apps.

> This is a direction note, not a spec. When we take it on, it gets its own full
> brainstorm → spec → plan cycle. It's recorded here so the work leading up to it
> (especially audience scoping) is designed in a library-compatible way.

## The goal

Make the notification system **droppable into someone else's project**, both halves:

- **Backend as a Node library** — a team imports it into their existing Node app and either
  calls functions directly (`ingest()`, `list()`, `markRead()`, …) or mounts its HTTP+SSE
  routes onto their own server. No standalone service required.
- **Frontend as a Vue component library** — a team wraps their dashboard in a
  `<NotificationProvider>` and drops in components (`<NotificationBell>`, `<NotificationPanel>`,
  `<AdminModulesPanel>`) to get the whole notification UI, talking to the backend.

## THE load-bearing constraint (must inform audience scoping — the next-but-one task)

**In a library, the HOST app owns identity — the notification system does NOT.**

Today this project owns users, sessions, roles, `requireUser`/`requireAdmin`. A library dropped
into someone's admin panel can't own that; their app already has users + auth. So the core must
**consume identity through an adapter** ("given this request, who is the user and what are their
roles/teams?") rather than own a users table.

Audience scoping is entirely about identity (who receives what, by user/role/team). Therefore
**audience scoping must be designed to resolve audiences against host-provided identity, not an
owned users table.** If we build audience scoping assuming we own users, we rip it out later.
This decision is why the library direction is recorded now even though the extraction happens last.

## Agreed sequencing

1. Finish `feat/module-catalog-and-affordances` (module catalog + card/action affordances). ← current
2. **Sorting** (server-side default-by-time, priority as an option). Small, app-internal.
3. **Audience scoping** (per-user/role/team delivery; retire the global broadcast) — designed with
   host-injected identity from the start (see constraint above).
4. **Library-ification** — this note, as its own full cycle.

## Target shape (sketch, not final)

Monorepo becomes **packages + a reference app**:

- `@notifications/shared` — zod contract + types. _Already exists._ Becomes the public contract.
- `@notifications/core` (new) — framework-agnostic backend domain:
  `createNotificationService({ pool, config, auth })` → `ingest()`, `list({ user, cursor, sort })`,
  `markRead()`, `resolveModule()`, delivery hub, policy. No Fastify, no `process.env` reads —
  everything injected.
- `@notifications/server-fastify` (new, thin) — Fastify plugin mounting HTTP + SSE onto the host's
  server, wiring their auth adapter to the core. (Express adapter later if needed.)
- `@notifications/vue` (new) — `<NotificationProvider :baseUrl :getAuth>` (sets up store + SSE +
  API client via provide/inject) plus the drop-in components.
- `apps/reference` — the current `frontend/` + `backend/` become a **reference/dev app** that
  consumes the libraries: the dev harness, the test bed, and living "how to wire it up" docs.

### Consumer usage (illustrative)

Backend:

```ts
const notifications = createNotificationService({
  pool,                                  // their Postgres
  auth: (req) => ({ id, roles, teams }), // their identity, adapted
  config: { modules: [...] },            // module catalog is HOST config, not a DB seed
});
await notifications.ingest(payload);                                  // call directly…
app.register(notificationFastifyPlugin, { service: notifications });  // …or mount routes
```

Frontend:

```vue
<NotificationProvider :base-url="'/api/notifications'" :get-auth="myTokenFn">
  <MyDashboard />
  <NotificationBell />   <!-- or the whole <NotificationPanel /> -->
</NotificationProvider>
```

## Hard problems to resolve during the real design

1. **Auth injection** (the big one) — core takes an `auth` adapter; the current session/auth model
   moves into the _reference app_, not the library.
2. **DB ownership** — library ships migrations but runs against a host-provided `pg.Pool`; decide
   namespaced tables the host migrates vs. bring-your-own. Keep Postgres; don't over-abstract the store.
3. **Frontend styling isolation** — Tailwind v4 utilities + `@theme` tokens will collide/purge in a
   host app. Options span "ship compiled, scoped CSS under a root class" (pragmatic) to Web
   Components / shadow DOM (strongest isolation, constrains composition). Deliberate call needed.
4. **Peer dependencies** — `vue`, `pinia` (and `zod` on the backend) as `peerDependencies` to avoid
   duplicate instances.
5. **Vue-only** — `@notifications/vue` doesn't serve React consumers; a React port would be a
   separate adapter, likely out of scope. Name the boundary.

## Framing shifts this causes (nothing to undo now)

Some things already built change _meaning_ in a library world — the seeded module catalog becomes
**host-provided module config**; the app's auth/admin become **reference-app** concerns. These are
correct as reference-app defaults today; just know the framing changes on extraction.

## Note

This defines the contract other teams will build against — a hard-to-reverse, central decision. Its
public API shape (framework-agnostic core + adapters, auth injection, styling-isolation approach)
should be confirmed with the mentor before it's locked, per the project's "sanity-check hard-to-reverse
choices" rule.
