# UI component library extraction (`@notifications/vue`) — design

**Date:** 2026-07-24
**Branch:** `feat/ui-component-library` (off `main`, which now has the BE library + AI summarizer + AI
chat all merged)
**Status:** approved (design converged in discussion). **The public component contract —
`NotificationConfig`, the exported component API, and the theme token names — is a host-facing
contract; mentor sign-off before merge, same gate as the BE library.**

## Goal

Extract the notification-domain UI out of the reference `frontend/` app into a reusable Vue 3 package,
`@notifications/vue`, that any host Vue app can install and mount — injecting its own backend
connection and identity rather than the library owning login/session/api-client. This is the frontend
twin of the completed backend extraction (`@notifications/core` + `@notifications/server-fastify`, with
`backend/` as the reference consumer). The reference `frontend/` app becomes a thin consumer that
proves the extraction, and its existing Playwright e2e must keep passing unchanged.

## Locked decisions

- **Scope: end-user UI + admin UI.** The package ships the end-user surface
  (`<NotificationBell>`/`<NotificationPanel>`/critical-toast viewport) **and** the operator surface
  (`<NotificationAdmin>`: modules, feature flags, generator, maintenance), mirroring the BE library
  which includes admin routes. The host keeps login, router, and the dashboard chrome.
- **Injection: `baseUrl` + optional overrides.** `<NotificationProvider :config>` takes a `baseUrl`
  (+ the current user/roles for UI gating); the library ships a default cookie-based fetch + EventSource
  that just work for same-origin/cookie hosts like the reference app. A host with token/bearer auth or a
  custom client overrides the `transport` + `connectSse` hooks. Batteries-included with an escape hatch.
- **State: provider-scoped composables (no Pinia).** Each store's setup body becomes a factory the
  provider instantiates once with the injected transport and shares via `provide`/`inject`. No Pinia
  peer-dependency, no global-singleton id collisions, provider-isolated state.
- **Styling: prefix-free, preflight-free, token-themed CSS that adapts to the host.** Components stay
  authored in Tailwind v4; the build ships a self-contained `style.css`. Isolation via no Preflight +
  namespaced tokens (`--nt-*`) scoped to `.notifications-root`. `--nt-font-sans` defaults to `inherit`
  so it takes on the host's typography. Ship theme presets (Vuetify, dark). The host re-themes by
  overriding the token variables.

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` + `pnpm -r build` clean before a task is "done".
- New/moved logic keeps its Vitest test in the same task; failure paths tested.
- **The library never derives identity** — it receives the host's resolved user (roles/teamKeys) for UI
  gating only, and the server still enforces audience scoping + admin via the carried credential. Same
  principle the BE library enforces.
- No secrets in the library; it holds no auth logic beyond carrying the host's credential/transport.
- Design-system compliance is preserved (the reference app looks identical after the move).
- **The reference app's existing Playwright e2e must pass unchanged** — the behavioral proof.
- Public contract additions are mentor-gated (see Mentor sign-off).

## Package layout (`packages/vue/`)

Mirrors `packages/core` / `packages/server-fastify`.

```
packages/vue/
  src/
    provider/         NotificationProvider.vue, context key, NotificationConfig + Transport types,
                      default cookie transport + default SSE client
    components/        NotificationBell, NotificationPopover,
                       panel/{InboxTab, AssistantTab, CitationChip},
                       components/{FeedList, FilterMenu},
                       renderers/NotificationCardRenderer,
                       CriticalToast, CriticalToastViewport
    admin/             ModulesPanel, FeaturesPanel, GeneratorPanel, MaintenancePanel, DevLabsPanel,
                       adminApi, NotificationAdmin (composite)
    state/             createFeedState, createChatState, createSummaryState, createSettingsState,
                       createToastState, createPanelState  (+ useFeed/useChat/... inject accessors)
    transport/         Transport interface, createCookieTransport(baseUrl), connectSse(baseUrl, …)
    ui/                Button, Chip, Icon, Skeleton, Spinner, StatePanel
    forms/             FormRenderer, fields/*, types, validation, generator/burst/drip/features forms
    design/            tokens, icons
    lib/               cn, time
    styles/            lib.css (Tailwind entry → compiled to dist/style.css), presets/{vuetify,dark}.css
    index.ts           public exports
  package.json         type: module, exports ./ + ./style.css + ./presets/*, peerDep vue, vite lib build
```

`frontend/` **keeps**: `features/auth/*` + `stores/session` + `login.form`, `router`, `main.ts`,
`App.vue`, the dashboard chrome (`DashboardLayout`, `DashboardSidebar`, `DashboardTopBar`,
`DashboardHome`), `features/settings/SettingsStub`. It **consumes** the package: `DashboardTopBar` →
`<NotificationBell>`, `DashboardLayout` → `<CriticalToastViewport>`, `AdminView` → `<NotificationAdmin>`,
`LoginView` → the library's exported `FormRenderer`.

## The public contract (mentor-gated)

```ts
interface Transport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}
interface SseClient {
  close(): void;
}
type SseFactory = (opts: {
  onBatch: (batch: Notification[]) => void;
  onStatus?: (s: "connecting" | "open" | "closed") => void;
}) => SseClient;

interface NotificationConfig {
  baseUrl?: string; // default "" (same-origin)
  transport?: Transport; // default: createCookieTransport(baseUrl)
  connectSse?: SseFactory; // default: EventSource(baseUrl + "/sse")
  user: { roles: string[]; teamKeys?: string[] } | null; // UI gating only; server still enforces
}
```

Usage:

```vue
<NotificationProvider :config="cfg">
  <NotificationBell />
  <CriticalToastViewport />
  <!-- elsewhere / admin route -->
  <NotificationAdmin />
</NotificationProvider>
```

- The provider builds the state composables **with** the resolved transport/SSE and provides the
  context; components read it via `useFeed()`/`useChat()`/… (no props).
- **Transport surface** the default must cover (verified from the code):
  `GET/POST /notifications/{counts,read,:id/read,chat,summary}`, `GET /settings/features`, `GET /sse`,
  and the admin set `/admin/{modules,modules/:id,settings,simulate,maintenance/*}`.
- **Public exports:** `NotificationProvider`, `NotificationBell`, `NotificationPopover` (as
  `NotificationPanel`), `CriticalToastViewport`, `NotificationAdmin`; `FormRenderer` + the UI primitives
  - design tokens for host reuse; the `NotificationConfig`/`Transport`/`SseClient` types;
    `@notifications/vue/style.css` and `@notifications/vue/presets/{vuetify,dark}.css`.

## State model conversion

Per store: `defineStore(id, setup)` → `export function createXState(deps)` with the **same body**, the
only change being `api`/`connectSse` references → `deps.transport`/`deps.connectSse`.
`NotificationProvider` calls each factory once, wires cross-store dependencies explicitly (e.g.
`useNotificationActions` receives `feed.markRead`; the panel store coordinates feed + chat), bundles them
into a context object, and `provide(NOTIFICATIONS_KEY, ctx)`. `useFeed()` = `inject(NOTIFICATIONS_KEY)`

- a guard that throws "must be used inside `<NotificationProvider>`" when absent. Component call sites
  change `useFeedStore()` → `useFeed()`. Tests call the factory directly with a fake transport — no Pinia,
  no mount.

## Styling / theming

- Library authored in Tailwind v4 (dev unchanged); the build compiles `styles/lib.css` to a
  self-contained `dist/style.css` (only the utilities it uses + the token layer).
- **No Preflight** shipped — the library inherits the host's base styles instead of resetting them.
- **Tokens** renamed to `--nt-*` and defined on `.notifications-root` (applied by the provider / each
  mounted root), not bare `:root`, so they don't override or get overridden by the host.
  `--nt-font-sans: inherit` by default.
- Utility-name overlap is a non-issue: Vuetify uses a disjoint class vocabulary; a Tailwind host shares
  identical utility definitions. A `ntf-` class prefix is available as hardening if a specific host ever
  collides, but is not applied by default.
- **Presets:** `presets/vuetify.css` maps `--nt-*` → Vuetify's `--v-theme-*`; `presets/dark.css` a dark
  token set. The reference app ships a small theme file setting `--nt-*` to today's "Editorial Ivory"
  values so it renders identically.

## Reference-app rewiring

- Add `@notifications/vue: workspace:*` to `frontend`.
- Build `cfg: NotificationConfig` from the `session` store's user (`roles`, `teamKeys`) with
  `baseUrl: ""` (same-origin via the existing dev proxy) and the default cookie transport; wrap the
  authenticated app region (e.g. in `DashboardLayout` / `App.vue`) in `<NotificationProvider :config>`.
- Repoint imports in `DashboardTopBar`, `DashboardLayout`, `AdminView`, `LoginView` to
  `@notifications/vue`; delete the moved source from `frontend/src`.
- `main.ts`: `import "@notifications/vue/style.css"` + the Ivory theme file; keep the host's font imports
  (or rely on inherit).

## Testing

- **State factories:** unit-tested by passing a fake `Transport` (asserting the same behaviors the
  current Pinia store specs assert), no Pinia/mount.
- **Components:** mounted inside a test provider helper that supplies a fake context; the migrated
  component specs (Popover, InboxTab, AssistantTab, CitationChip, admin panels) adapt from Pinia-mock to
  provider-inject.
- **Package build:** `@notifications/vue` typechecks + builds (ESM + d.ts + style.css) standalone.
- **Reference e2e (Playwright):** unchanged, runs against the rewired `frontend/`, must stay green — the
  behavioral proof the extraction preserved every flow (login → live feed → read → chat → admin).
- **Visual:** `frontend-design-reviewer` + `browser-tester` confirm the reference app looks/behaves
  identical after the move.

## Packaging

- `package.json`: `type: module`, `sideEffects` limited to the CSS, `exports` for `.`/`./style.css`/
  `./presets/*`, **`peerDependencies`: `vue` (^3.5)** (no pinia), `dependencies`: `@notifications/shared`,
  design/util libs (clsx, tailwind-merge, cva, lucide, virtua). Build: vite library mode (JS + d.ts) +
  Tailwind compile for the CSS. `private: true` for now, flipped at the real publish split (like
  `server-fastify`).

## Mentor sign-off

Confirm before merge: `NotificationConfig` (the injection contract), the exported component API
(`NotificationProvider`/`NotificationBell`/`NotificationPanel`/`CriticalToastViewport`/
`NotificationAdmin`), and the `--nt-*` theme token names — the surface hosts build against.

## Out of scope (deliberate)

- Publishing to npm (stays `private: true`; the package is publishable-shaped).
- Shadow-DOM isolation (documented escape hatch if a host's CSS actively breaks the library; not built).
- Deep per-framework component mimicry (e.g. rendering as Vuetify Material components) — the library
  stays its own neutral component set that adopts the host's colors/typography via tokens.
- A `.dark` theme for the reference app itself (the token layer is structured for it; only the preset
  ships).
- Any change to the backend, the API contract, or the notification domain logic — this is a pure
  frontend extraction.

## Self-review

- **Placeholders:** none. Concrete package path (`packages/vue`), export names, `NotificationConfig`
  fields, token prefix (`--nt-*`), root class (`.notifications-root`), transport endpoint surface, and
  the peerDep (`vue`, no pinia).
- **Consistency:** mirrors the proven BE extraction shape (library package + reference consumer +
  private-for-now packaging + host-injected adapters + mentor-gated contract). The four locked decisions
  are internally consistent — provider-scoped composables are what make the per-provider transport
  injection clean, and token-scoping is what makes the styling host-adaptive.
- **Scope:** one cohesive package extraction. Decomposition into units happens in the plan (transport +
  state factories → provider → components → admin → styling/build → reference rewiring → e2e).
- **Ambiguity resolved:** styling isolation is "no preflight + scoped namespaced tokens", not per-class
  prefixing (prefix is an optional fallback); state is provider-scoped composables, not Pinia; admin UI
  is in scope; identity is injected for gating only, never derived.
