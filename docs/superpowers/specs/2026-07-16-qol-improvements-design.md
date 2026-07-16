# Design: QoL improvements batch (panel re-read, expand, Dev Labs, retention)

Date: 2026-07-16
Status: Approved (design); implementation plan to follow
Branch: `chore/qol-improvements` (cut from local `main` after `feat/notification-generator` is
fast-forward-merged into it — no push; the mentor-sign-off gate still applies to anything pushed)

## Context

Four independent QoL/fix items for the centralized-notifications prototype, batched onto one
branch as separate commit groups. Two are safe frontend-only panel fixes; two touch the database
(a migration + destructive maintenance endpoints) and are `security-reviewer` + mentor-sanity-check
territory.

Two findings from exploring the current code reframed the work:

- **"Earlier" is the _read_ bucket, not a time bucket.** `stores/feed.ts` splits the visible feed
  into "Needs action" (unread) and "Earlier" (read). The moment a notification is read — including
  an accidental click or "Mark all read" — it drops to Earlier and re-renders as a stripped
  title+date row (`FeedList.vue`) with no body and no actions. That is the core of issue 1.
- **Retention already has a planned home.** `migrations/002_notifications.sql` states verbatim:
  "Not partitioned yet (Week 5 T8 owns range-partitioning + retention)." Issue 4 therefore must not
  build a parallel auto-delete engine that Week 5 would rip out.

## Goals

1. Let a user re-read any read ("Earlier") notification in full and reach its original actions, and
   undo an accidental read.
2. Reveal a long notification body in full when a card is expanded (and make long-bodied cards
   expandable even when they have no actions).
3. Rename the admin "Generator" tab to "Dev Labs" (keep the `FlaskConical` icon) and add DB
   maintenance tooling to relieve the piled-up-notifications problem.
4. Capture a retention window as configuration now; defer automatic enforcement to Week-5
   partitioning.

## Non-goals

- Automatic background deletion / a scheduled retention sweep (Week-5 partitioning owns it).
- Table partitioning itself (Week 5).
- Any change to the audience model (still global broadcast; mentor-gated).
- A standalone "notification detail" drawer/modal (issue 1 is solved by reusing the existing card).

## Locked decisions

1. **Branch:** FF-merge `feat/notification-generator` into local `main` (no push), then cut
   `chore/qol-improvements`. Four separable commit groups (issues 1, 2, 3, 4).
2. **Issue 1:** reuse `NotificationCardRenderer` for Earlier items (approach A) **plus** a
   "Mark as unread" affordance backed by a new `DELETE /notifications/:id/read`.
3. **Issue 2:** the expand toggle reveals the full body; the chevron appears when the card has
   actions **or** a long body (approach A).
4. **Issue 3:** rename to "Dev Labs"; new `DevLabsPanel` with a Generate | Maintenance toggle;
   maintenance endpoints are **non-prod-only + `requireAdmin`** (same gate as `/admin/simulate`),
   return affected counts, and are confirm-gated. Ops: delete-all, delete-read, delete-older-than,
   reset-modules, reset-feature-flags.
5. **Issue 4:** migration adds `retention_days` to `global_settings`; edited in Dev Labs; **no
   background job** — the "delete older than N days" button defaults N to `retention_days`, and
   Week-5 partitioning will consume the same value.
6. **delete-read semantics (interim):** "read" = any notification with ≥1 row in
   `notification_reads` (read by anyone). Acceptable while all notifications are broadcast globally;
   revisit when per-recipient audience lands.

## Architecture

### Issue 1 — re-readable Earlier notifications (frontend)

- **`frontend/src/features/notifications/components/FeedList.vue`** — replace the bespoke Earlier
  `<button>` row with `<NotificationCardRenderer>` per item (still inside the "Show N earlier"
  toggle), forwarding the same `open` / `action` events as the Needs-action list. The card's
  existing read styling (muted title, normal weight) de-emphasizes it; no new visual language.
- **`NotificationCardRenderer.vue`** — add a **"Mark as unread"** control, shown only when
  `notification.read`. It emits a new `unread` event; the card does not mutate state itself.
- **`frontend/src/stores/feed.ts`** — add `markUnread(id)`: optimistic flip via `setRead(id, false)`
  (the row moves back into Needs action through the existing grouping computed), `DELETE`s the read
  record, and reverts on failure — the mirror of the existing `markRead`.
- **`frontend/src/features/notifications/panel/InboxTab.vue`** — wire the `unread` event to
  `feed.markUnread`.
- **Backend `frontend/... ` read path:** new `DELETE /notifications/:id/read`
  (`backend/src/http/notifications/routes.ts`), `requireUser`, deletes this user's row from
  `notification_reads` (idempotent — deleting a non-existent row is a no-op, returns 204).
  Parameterized SQL. `docs/api/notifications.md` updated (api-documentation rule).

### Issue 2 — expandable long descriptions (frontend)

- **`NotificationCardRenderer.vue`** — the body `<p>` is `truncate` when collapsed and full
  (`whitespace-pre-line break-words`, no clamp) when `expanded`. The expand chevron's visibility
  becomes `hasActions || isLongBody`, where `isLongBody` is a length-threshold proxy
  (`description.length > 140`). When neither actions nor a long body exist, no chevron (unchanged).
  Expanding still does not mark read.

### Issue 3 — Dev Labs + maintenance (backend + frontend)

- **`frontend/src/features/admin/AdminView.vue`** — the sub-nav item `generator` becomes label
  "Dev Labs" (icon stays `FlaskConical`); it renders a new `DevLabsPanel`.
- **`frontend/src/features/admin/DevLabsPanel.vue`** (new) — a segmented toggle **Generate |
  Maintenance**. "Generate" renders the existing `GeneratorPanel` unchanged. "Maintenance" renders
  a new `MaintenancePanel`.
- **`frontend/src/features/admin/MaintenancePanel.vue`** (new) — destructive-op buttons, each with a
  confirm step (delete-all uses a typed confirmation; others a simple confirm), a result line
  ("Deleted N"), and the retention-window input (issue 4). Uses the design-system primitives; no
  raw Tailwind defaults.
- **`frontend/src/features/admin/adminApi.ts`** — add typed maintenance calls + `reset* ` helpers +
  `getSettings`/`patchSettings` reuse for `retentionDays`.
- **Backend `backend/src/http/admin/maintenance.ts`** (new) — `maintenanceRoutes(app)` plugin,
  registered in `server.ts` under the **same `isSimulatorEnabled()` guard** as `simulateRoutes`
  (non-prod only). All routes `requireAdmin`, zod-validate any body, run **parameterized** SQL,
  return `{ deleted: number }` (or `{ ok: true }`), and call `invalidatePolicyCache()` where module
  or settings state changes. Endpoints:
  - `POST /admin/maintenance/notifications/delete-all` → delete all `notifications`
    (+ `notification_reads`); returns count.
  - `POST /admin/maintenance/notifications/delete-read` → delete notifications whose id appears in
    `notification_reads`; returns count.
  - `POST /admin/maintenance/notifications/delete-older-than` `{ days: int ≥ 1 }` → delete where
    `created_at < now() - (days || interval)`; returns count.
  - `POST /admin/maintenance/modules/reset` → delete all `modules` rows (re-discovered on next
    publish); invalidate cache; returns count.
  - `POST /admin/maintenance/settings/reset` → reset `global_settings` feature flags (and
    `retention_days`) to defaults; invalidate cache; returns `{ ok: true }`.
- `docs/api/admin.md` updated for the maintenance endpoints.

### Issue 4 — retention setting (migration + config)

- **`backend/migrations/006_retention_setting.sql`** (new) — `ALTER TABLE global_settings ADD
COLUMN retention_days integer NOT NULL DEFAULT 30`. (Setting only; no enforcement wired.)
- **`backend/src/http/admin/routes.ts`** — extend `GET/PATCH /admin/settings` and the
  `getFeatureFlags`/settings read to include `retentionDays` (zod: positive int).
- **`backend/src/pipeline/policy.ts`** — include `retentionDays` in the settings read if that's
  where `global_settings` is loaded; no policy behavior change.
- **Frontend** — the Maintenance panel reads `retentionDays`, lets the admin edit it (PATCH), and
  pre-fills the "delete older than N days" input from it. Documented inline that automatic
  enforcement arrives with Week-5 partitioning.

## Data flow

- **Mark unread:** card `unread` → `InboxTab` → `feed.markUnread(id)` → optimistic `setRead(id,
false)` (row regroups to Needs action) → `DELETE /notifications/:id/read` → revert on error.
- **Maintenance op:** button → confirm → `adminApi.<op>()` → `POST /admin/maintenance/...` →
  `{ deleted }` → result line; module/settings ops also refresh the relevant admin view.
- **Retention:** `retention_days` stored in `global_settings`, read via settings endpoint, used as
  the default for the manual older-than run; Week-5 partitioning will read the same column.

## Error handling

- New endpoints: `requireUser`/`requireAdmin` → 401/403; non-prod maintenance routes absent in prod
  → 404; invalid body (e.g. `days < 1`) → zod 400 before any SQL.
- `DELETE /notifications/:id/read` for a non-existent/never-read id → 204 (idempotent).
- Frontend maintenance failures surface the real server message (same pattern as GeneratorPanel);
  destructive ops require explicit confirmation before firing.

## Testing

- **Frontend (Vitest):** FeedList renders Earlier items with the full card + emits `unread`;
  `markUnread` optimistically regroups and reverts on failure; card shows full body when expanded
  and shows the chevron for a long body with no actions; MaintenancePanel calls each endpoint,
  gates delete-all behind typed confirmation, and surfaces errors.
- **Backend (Vitest):** each maintenance endpoint deletes the right rows and returns the count;
  `requireAdmin` 401/403; routes absent when `NODE_ENV=production`; `days` validation; migration 006
  adds `retention_days` with the default; `DELETE /notifications/:id/read` removes the row and is
  idempotent; settings round-trip includes `retentionDays`.
- **e2e (Playwright):** read a notification → open Earlier → expand it → full body + actions
  visible; "Mark as unread" moves it back to Needs action; Dev Labs → Maintenance → guarded
  delete-all clears the feed. Not "done" on `tsc` alone.

## Review gates

- `security-reviewer` — the destructive maintenance endpoints + the migration + the non-prod guard
  (confirm authz, non-prod absence, parameterized SQL, no data loss beyond intent).
- `code-reviewer`, `frontend-design-reviewer` (Dev Labs / Maintenance / card changes against the
  ivory system), `browser-tester`.
- `docs/api/admin.md` + `docs/api/notifications.md` updated (api-documentation rule).
- **Mentor sign-off** still gates any push; specifically raise the retention value and the
  "auto-enforcement deferred to Week-5 partitioning" plan, and the interim delete-read semantics.

## Risks / open questions

- **`isLongBody` threshold (140 chars)** is a proxy for "would truncate"; a precise measure needs
  DOM measurement. The threshold is good enough and cheap; revisit only if it feels off.
- **delete-read global semantics** are a stopgap tied to global broadcast; must be revisited when
  per-recipient audience resolution lands (Week 4).
- **Retention as config-only** means the pile still grows until an admin runs delete-older-than or
  Week-5 ships; acceptable and explicitly the chosen tradeoff.
- **Reset-modules** clears discovery; modules re-appear on next publish, and any disable state is
  lost — intended for a dev reset, but call it out in the confirm copy.
