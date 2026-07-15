# Design: Basic Admin panel + module policy (Week 2, FR-7 / FR-8)

Date: 2026-07-15
Status: Approved (design); implementation plan to follow
Scope: The Week-2 "Basic admin" deliverable — an admin console to enable/disable notification
modules and toggle global feature kill-switches, with the module toggle **actually enforced**
in the delivery pipeline. Builds on the Week-1 shell + intake pipeline on `chore/scaffold-monorepo`.

## Context

Week 1 delivered auth (incl. `requireAdmin`), the intake pipeline
(`validate → dedupe → persist → broadcast`, `backend/src/pipeline/ingest.ts`), SSE delivery, and
the dashboard shell with a role-aware sidebar that already carries a gated but dead "Admin" entry.
The mentor scrapped the earlier idea of a _separate_ admin frontend — admin lives in
`features/admin/*` inside the same app (the plan's original intent). This is the mentor-assigned
Week-2 deliverable: a basic admin panel (UI/UX + a few real settings). It corresponds to plan
tasks **W2-T1 (module auto-discovery, FR-7)**, **W2-T2 (global policy engine, FR-8-basic)**, and
**W2-T3 (admin panel, FR-8)** built together as one coherent slice so the toggles actually do
something.

## Goals

- An admin-only `/admin` console, reached from the existing sidebar entry.
- **Modules**: list the modules that have published (auto-discovered), enable/disable each; a
  disabled module's future notifications are recorded but **not delivered** (enforced in the
  pipeline). Filter the list by emitted priority; sort by criticality / volume / recency / name.
- **Features**: global kill-switches (AI summary, chatbot, grouping, actions). `ai_summary` takes
  effect today (hides the panel's AI band); the rest persist and gate their features as they ship.
- Stay within the "Editorial Command, ivory" design system and the JSON-form convention.

## Non-goals

- Audit log (who changed what) — explicitly deferred (plan puts a full one in Week 5).
- Per-module overrides (default priority/category per module) — Week-2 categorization/prioritization
  tasks, not this slice.
- AI config, broadcasts, observability admin areas — later weeks (shown dimmed in the sub-nav as
  "coming" so the console reads whole, but not built).
- Audience/tenant model — unchanged; still global, still behind the standing mentor gate.
- Rate-limiting the admin write endpoints — noted as a follow-up (see Risks), not in this slice.

## Locked decisions

### Entry point & layout

1. **Sidebar → `/admin`.** Wire the existing gated sidebar "Admin" item
   (`DashboardSidebar.vue`) to a real `/admin` route, admin-guarded in the router. Removes the
   "coming later" stub title.
2. **Layout C — secondary left sub-nav.** Inside `/admin`, a vertical sub-nav (`Modules`,
   `Features`, plus dimmed/disabled `AI config`, `Audit` placeholders) with the active view on the
   right. Chosen for a professional, future-proof console that grows over later weeks.

### Modules view

3. **Auto-discovered list.** Rows come from a `modules` table, upserted on every publish (first
   publish inserts; later publishes bump `last_seen_at`). FR-7.
4. **Row content.** Readable **label** + raw **`key`** (mono), `last_seen` (relative), a
   **priority-mix** cell (mono counts with priority dots — e.g. critical/high/normal breakdown), a
   **total** count, and an **enable/disable toggle**. A disabled module also surfaces a
   **suppressed** count (notifications recorded-but-not-delivered while off).
5. **Toolbar — filter + sort.** _Priority filter_ chips (`All` / `Critical` / `High` / `Normal` /
   `Low`) narrow the list to modules that have emitted the selected priority (the chip count = how
   many modules qualify). _Sort_: `Critical first`, `Total volume`, `Recently active`, `Name A–Z`.
   The server returns each module with its priority breakdown + totals; **filter/sort run
   client-side** over that small set (no new hot-path cost).
6. **Empty state.** Fresh environment with nothing published → an empty state ("No modules yet —
   they'll appear here once a source publishes"), never a blank table.

### Features view

7. **Global kill-switches**, rendered from a JSON form config through the shared `FormRenderer`
   (json-form convention): `ai_summary_enabled`, `chatbot_enabled`, `grouping_enabled`,
   `actions_enabled` (all boolean). Each switch is tagged **Live now** vs **Wk 3/4** so a
   not-yet-wired switch never reads as broken.
8. **`ai_summary_enabled` has a real effect now**: when off, the bell panel hides its AI-summary
   band for all users (`InboxTab.vue` reads the flag). The other three persist now and begin gating
   their features as those ship (chatbot Wk 3; grouping/actions Wk 4).

### Policy enforcement (the toggle bites)

9. **Record-suppressed, not delivered (option A).** A new `pipeline/policy.ts` step decides, before
   delivery, whether a notification's module is enabled. If disabled, the notification is **still
   persisted** but flagged `suppressed = true` and **not broadcast** and **excluded from the feed
   list/read paths**. Keeps a record of what would have arrived; re-enabling is clean (future
   notifications flow again; already-suppressed ones stay suppressed).
10. **Settings cached in memory, invalidated on admin change.** Policy reads module-enabled +
    feature flags from an in-memory cache refreshed on any admin `PATCH`, so enforcement adds no
    per-notification DB read. FR-8-basic / plan W2-T2.

## Architecture

### Data model — one migration (`backend/migrations/005_admin_settings.sql`)

- **`modules`**: `key text primary key`, `label text not null`, `enabled boolean not null default
true`, `first_seen_at timestamptz not null default now()`, `last_seen_at timestamptz not null
default now()`. `label` defaults to a derived title-case of `key` on first insert; admin does not
  rename in this slice (future).
- **`global_settings`**: single-row settings table (enforced e.g. `id boolean primary key default
true check (id)`), columns `ai_summary_enabled`, `chatbot_enabled`, `grouping_enabled`,
  `actions_enabled` (boolean, sane defaults), `updated_at`. Seeded with one row.
- **`notifications`**: add `suppressed boolean not null default false`. The list/read queries
  gain `AND suppressed = false`; the keyset index (004) still applies.

### Backend

- **`pipeline/modules.ts`** — `upsertModuleSeen(key)`: idempotent insert-or-bump, called from
  `persist` (or ingest) on every accepted notification. FR-7 test: a never-seen module creates
  exactly one row.
- **`pipeline/policy.ts`** — `isModuleEnabled(key): boolean` + `getFeatureFlags()`, backed by an
  in-memory cache with `invalidate()`. `ingest` consults it: if the module is disabled, persist with
  `suppressed=true` and skip `deliveryHub.broadcast`.
- **`http/admin/routes.ts`** (all `requireAdmin`, zod-validated):
  - `GET /admin/modules` → `[{ key, label, enabled, lastSeenAt, total, suppressed, byPriority: {critical,high,normal,low} }]` (the priority breakdown via a small `GROUP BY module, priority` aggregate joined to `modules`).
  - `PATCH /admin/modules/:key` → `{ enabled: boolean }` → updates + invalidates cache → 204.
  - `GET /admin/settings` → the feature flags.
  - `PATCH /admin/settings` → partial flag update → invalidates cache → 204.
  - Registered in `server.ts`. `docs/api/admin.md` written (api-documentation rule).

### Frontend (`features/admin/*`)

- **Router**: add `/admin` child route with an admin-only guard (redirect non-admins to dashboard);
  wire the sidebar entry; drop its "coming later" stub title.
- **`AdminView.vue`** — the layout-C shell: sub-nav (`Modules` / `Features` / dimmed future) +
  routed/switched content.
- **`ModulesPanel.vue`** — fetches `GET /admin/modules`; renders the toolbar (priority chips +
  sort), the table (label/key/last-seen/priority-mix/total/toggle + suppressed on disabled rows),
  and the empty state. Filter/sort in a small local store or computed. Toggling calls
  `PATCH /admin/modules/:key` optimistically (revert + inline error on failure).
- **`FeaturesPanel.vue`** — a JSON form config (`features.form.ts`) rendered via `FormRenderer`;
  submit calls `PATCH /admin/settings` (optimistic, revert on failure). Live/Wk-N tags in the field
  descriptions.
- **`stores/adminSettings.ts`** (or reuse session) — exposes the feature flags app-wide so
  `InboxTab.vue` can hide the AI-summary band when `ai_summary_enabled` is false.

## Behavior details

- **Suppression** applies only to notifications arriving **after** a module is disabled; already-
  delivered items are untouched. Re-enabling resumes delivery for new notifications only.
- **Priority filter** semantics: a module qualifies for a chip if `byPriority[p] > 0`.
- **Sort**: `Critical first` = by `byPriority.critical` desc then total desc; `Total volume` = total
  desc; `Recently active` = `lastSeenAt` desc; `Name` = label asc.
- **Feature flags** are advisory for not-yet-built features: storing `chatbot_enabled=false` does
  nothing visible until Wk 3 wires the assistant to read it. `ai_summary_enabled` is wired now.

## Error handling

- Non-admin at `/admin`: router guard redirects; API returns **403** independently (never trust the
  client guard). Unauthenticated: **401**.
- `PATCH` failure: optimistic UI reverts, inline error in design-system voice.
- Empty modules list: dedicated empty state.
- Malformed admin input: zod rejects → **400** before any DB write.

## Testing

- **Backend (Vitest):** module upsert idempotency (one row for repeated publishes of a new module);
  **policy suppression** — a disabled module's notification is persisted `suppressed=true`, not
  broadcast, and excluded from `GET /notifications`; settings read/write + cache invalidation takes
  effect on the next ingest; admin authz (403 non-admin, 401 unauth) on every admin route; the
  priority-breakdown aggregate returns correct counts.
- **Frontend (Vitest + @vue/test-utils):** `/admin` guard redirects a non-admin; `FeaturesPanel`
  renders + submits through `FormRenderer`; `ModulesPanel` filter (priority chip) + sort logic;
  `InboxTab` hides the AI band when `ai_summary_enabled` is false.
- **e2e (Playwright):** the Week-2 demo — log in as admin → disable a module in `/admin` → publish a
  notification from that module → it does **not** appear in the feed; re-enable → a new one does.
  Plus a non-admin cannot reach `/admin`.
- **Reviews:** `security-reviewer` (admin authz + new authed writes + the suppression path),
  `frontend-design-reviewer` (console against the design system), `code-reviewer`. Not "done" on
  `tsc` alone — browser-verify the console + the disable→suppress demo.

## Review gates / process

- Touches DB schema (migration), auth (`requireAdmin`), and a new admin API contract → **plan mode**,
  and `security-reviewer` before merge (security.md).
- `docs/api/admin.md` created; `docs/api/notifications.md` updated for the `suppressed` exclusion.
- The standing mentor gate (global audience model) still precedes any Week-2 PR; this slice does not
  change the audience model, but the admin API contract is new surface worth flagging to the mentor.

## Risks / open questions

- **Suppressed rows accumulate** in `notifications`. Fine at prototype scale; a retention/trim policy
  is a Week-5 hardening concern, noted not built.
- **No rate limit on admin writes** — low risk (admin-only, small payloads); a follow-up to add
  route-level `@fastify/rate-limit` alongside `/auth/login`, consistent with the notifications-domain
  guidance. Not in this slice.
- **`label` derivation** (title-case of `key`) may look rough for multi-word keys; admin rename is a
  future nicety, not blocking.
- **Feature-flag drift**: switches for unbuilt features must stay clearly tagged (Live vs Wk N) so
  they don't read as broken; revisit copy when each feature lands.
