# Design: Dev/QA notification generator (hidden admin tool)

Date: 2026-07-16
Status: Approved (design); implementation plan to follow
Scope: A hidden, admin-gated, non-production page in the admin console that generates
notifications on demand through the real ingest pipeline — so the team can exercise the
feed / toast / policy without waiting for the module simulator or hand-crafting `curl` calls
with the internal intake token. Mentor-requested, to be built now.

## Context

Today the only ways to produce notifications are the module simulator scripts
(`backend/src/scripts/sim-publish*.ts`) and direct `POST /internal/publish` calls, both of
which need the service-to-service `x-internal-token`. That's fine for scripts but awkward for
interactive QA and impossible from the browser (the token must never reach the client). This
tool gives an authenticated admin a UI to generate notifications of any kind on demand. It
reuses the existing pure generator (`backend/src/sim/simulator.ts`) and runs everything through
the real `ingest()` pipeline, so it genuinely exercises dedupe, policy/suppression, and SSE
delivery — not a parallel fake path.

## Goals

- Generate notifications from the FE four ways: single **custom**, one-click **presets**,
  random **burst**, and **drip** (on an interval).
- Route everything through the real pipeline so the feed, toasts, and module policy all react
  authentically (e.g. a disabled module's generated notification comes back suppressed).
- Never expose the intake token to the browser; never be available in production.

## Non-goals

- **Custom per-action editing** — v1 attaches 0–3 _canned_ sample actions (enough to exercise
  the expandable action cards). A full add/remove actions editor (a repeating-array form field)
  is explicitly deferred; it's the highest-effort/highest-bug-risk part and easy to add later.
- **Freeform metadata JSON** editing — deferred.
- Saved payloads / replay; scheduled or delayed publish.
- Any production availability, and any non-admin access.

## Locked decisions

1. **Endpoint:** `POST /admin/simulate`, `requireAdmin`, **registered only when
   `NODE_ENV !== "production"`** (the route is simply absent in prod — mirrors how the sim
   scripts refuse to run in prod). Body is a zod discriminated union on `mode`:
   - `{ mode: "custom", notification }` — `notification` validated against the shared
     `notificationSchema` minus `id` (the server generates a `sim-<ts>-<rand>` id so it can't
     collide), plus an optional `sampleActions: 0..3`. Server attaches that many canned actions,
     then `ingest()`.
   - `{ mode: "preset", preset }` — `preset` is one of a fixed registry of named templates
     (built from `sim/simulator.ts`); the server materializes it (fresh id) and `ingest()`s.
   - `{ mode: "burst", count: 1..100, seed? }` — `simulate({ count, seed })` → `ingest()` each.
     Returns `{ published: number, suppressed: number }` (suppressed = generated but policy-
     suppressed, so the UI can show that policy took effect). **Drip is client-side** (the page
     calls this endpoint on an interval), so the backend stays stateless.
2. **Location & gating:** a **"Generator"** item in the existing `/admin` sub-nav (beside
   Modules/Features). The nav item **and** the `/admin` sub-view are gated on
   `import.meta.env.DEV` (absent from production builds) **and** `session.isAdmin`. Double guard:
   dev-only build + admin role + non-prod server route.
3. **Custom form** (rendered via the shared `FormRenderer`): `module` (text; a `<datalist>` of
   already-discovered modules as a convenience), `title`, `description` (textarea), `priority`
   (select), `category` (text, optional), `snoozable` (switch), `audience.scope`
   (select: global/team/role/user), `audience.id` (text; shown via existing `showIf` only when
   scope ≠ global), and `sampleActions` (number 0–3).
4. **Presets:** ~5 one-click cards materialized from the simulator/templates — e.g. _Critical
   DSR_, _High access request (with actions)_, _Normal data finding_, _Low assessment_,
   _Long body_. One click → publish one.
5. **Burst:** `count` (1–100) + optional `seed` → publishes N varied notifications.
6. **Drip:** an FE control — interval (seconds) + total count (or "until Stop") — that repeatedly
   invokes the selected Custom or Burst call; a Stop button; timers cleaned up on unmount/route
   change.

## Architecture

### Backend

- **`backend/src/http/admin/simulate.ts`** (new) — a `simulateRoutes(app)` plugin exporting the
  `POST /admin/simulate` handler behind `requireAdmin`. A `simulateSchema` (zod discriminated
  union as above). Custom/preset/burst all produce `Notification[]` (server-assigned ids) and
  loop `ingest()`, tallying `published`/`suppressed` from each `IngestResult`
  (`accepted` + delivered vs `accepted` + suppressed).
- **Preset registry + sample actions:** a small module (e.g. `backend/src/sim/presets.ts`) with
  the named preset templates and a canned `SAMPLE_ACTIONS` list; both reuse the existing
  `sim/simulator.ts` shapes. Sample-action attach = take the first N canned actions.
- **Registration:** in `backend/src/server.ts`, register `simulateRoutes` **only** when
  `getEnv().NODE_ENV !== "production"` (route truly absent in prod). No behavior change to the
  existing `adminRoutes`.
- Reuses `ingest()`, `sim/simulator.ts`, the policy cache — no pipeline changes.

### Frontend

- **`frontend/src/features/admin/GeneratorPanel.vue`** — the panel with a mode switcher
  (Custom · Presets · Burst · Drip) and a small result line ("Published 5 · 1 suppressed").
  Mounted from a new `"generator"` section in `AdminView.vue`'s sub-nav, rendered only when
  `import.meta.env.DEV`.
- **`frontend/src/forms/generator.form.ts`** — the custom-form `FormSchema`.
- **Mode subviews** (kept small): a Presets grid, a Burst control (count/seed), a Drip control
  (interval/total + Start/Stop) wrapping the Custom or Burst payload.
- **`adminApi.ts`** gains `simulate(spec)` → `POST /admin/simulate`.
- The `/admin` route already guards admins; the Generator sub-view additionally checks
  `import.meta.env.DEV`.

### Form-system extension (small, reusable)

Per the json-form convention (don't hand-roll), extend the shared renderer with the one missing
field type this form needs:

- **`SelectField.vue`** + a `select` branch in `FormRenderer` + `select` handling in
  `validation.ts` (validate as a string / one of `options`). `TextField` already renders
  `text`/`number`/`textarea`; `switch` already exists; `showIf` already exists. **No array field,
  no JSON field** (both deferred with custom actions).

## Behavior details

- Server always assigns notification ids (ignores any client-supplied id) so repeated generation
  never dedupes against itself.
- Burst `count` is capped (1–100) server-side to prevent accidental flooding; the UI mirrors the cap.
- Drip: the page owns a `setInterval`; it stops on total reached, on Stop, and on unmount
  (`onBeforeUnmount`) / navigation away. It calls the same `simulate()` endpoint each tick.
- A generated notification for an admin-disabled module returns in the `suppressed` tally and does
  not appear in the feed — a natural way to demo policy from this page.

## Error handling

- Non-admin → 403; unauthenticated → 401; in production the route is absent → 404. The FE nav
  item/sub-view is absent in prod builds regardless.
- Invalid body (bad priority, missing title, count out of range, unknown preset) → zod 400 before
  any `ingest()`.
- A failed `simulate()` call surfaces an inline error in the panel; drip stops on error.

## Testing

- **Backend (Vitest):** custom mode ingests one (server-assigned `sim-` id, `published: 1`);
  preset mode ingests the named template; burst `count: N` ingests N; a disabled-module custom
  publish returns `suppressed: 1` and is absent from `GET /notifications`; `requireAdmin` 401/403;
  zod rejects a bad body and an out-of-range count (400); the route is not registered when
  `NODE_ENV=production`.
- **Frontend (Vitest):** `SelectField` renders options + emits selection; `FormRenderer` renders a
  `select` field; `GeneratorPanel` switches modes; custom submit calls `simulate` with the mapped
  payload; burst calls with count/seed; drip start publishes on tick and Stop/unmount clears the
  timer (fake timers).
- **e2e (Playwright):** admin opens `/admin` → Generator → publishes a **critical** (preset or
  custom) → the bottom-right toast appears; a non-admin cannot reach `/admin`.
- Browser-verify the page + `frontend-design-reviewer`; not "done" on `tsc` alone.

## Review gates

- **`security-reviewer`** — new authed write + the non-prod registration guard (confirm the route
  cannot be reached in production and that ids/counts are server-controlled).
- `frontend-design-reviewer` (the panel against the ivory system), `code-reviewer`,
  `browser-tester`.
- `docs/api/admin.md` updated for `POST /admin/simulate` (api-documentation rule).
- Mentor sign-off gate still applies to anything pushed; this is a dev-only tool and does not
  change the audience model, but flag the new endpoint.

## Risks / open questions

- **Sample-only actions:** custom action labels/URLs aren't editable from this page (deferred). If
  that proves limiting, add the repeating-array field type then.
- **Client-side drip timers** must be cleaned up reliably (unmount + navigation) — the main
  correctness risk on the FE.
- **Non-prod guard robustness:** the route must be genuinely absent in prod (registration-time
  check), not merely hidden in the UI.
- **Burst cap** (100) is a guardrail against flooding the shared dev feed; adjustable if too low.
