# PR: Extract the notification UI into `@notifications/vue` (reusable Vue 3 library)

**Branch:** `feat/ui-component-library` → `main`
**Status:** pushed; ready to open. Public contract needs mentor sign-off before merge (see "Still open").

---

## What changed

Pulls the entire notification-domain UI out of the reference `frontend/` app into a new,
publishable-shaped package **`@notifications/vue`** (`packages/vue/`). The reference `frontend/`
becomes a thin consumer — mirroring how `backend/` already consumes `@notifications/core`. This is
the frontend twin of the completed backend library extraction, and the last of the four
library-conversion tasks.

**New package `@notifications/vue`** exposes:

- **Components:** `NotificationProvider`, `NotificationBell`, `NotificationPanel`,
  `CriticalToastViewport`, `NotificationAdmin`, plus `FormRenderer`, the UI primitives
  (`Button`/`Icon`/`StatePanel`/…), and the design tokens for host reuse.
- **Mounting model:** a host wraps its app in `<NotificationProvider :config>` and drops the
  components in. `NotificationConfig { baseUrl?, transport?, connectSse?, user }` — the host injects
  its **own** transport + identity; the library never derives identity (server still enforces
  audience/admin; `user` is for UI gating only). Defaults are a cookie transport
  (`createCookieTransport`) + `EventSource` SSE; hosts override for token auth.
- **State:** each former Pinia store is now a provider-scoped composable factory
  (`createFeedState(deps)`, …) returning a `reactive(...)`, wired once in the provider and read via
  `useFeed()/useChat()/useSummary()/useSettings()/useToast()/usePanel()/useActions()`. No Pinia
  peer dependency is forced on hosts.
- **Styling:** components stay Tailwind v4; the build compiles `styles/lib.css` → `dist/style.css`.
  No global Preflight (a scoped `:where()` reset, in `@layer base`). Tokens renamed `--nt-*`, scoped
  to `.notifications-root`, with `--nt-font-sans: inherit` so the library adopts the host font.
  Ships `@notifications/vue/style.css` + `presets/{vuetify,dark}.css`.

**Reference `frontend/`** keeps login/session/router/dashboard chrome and rewires to import the
above from `@notifications/vue`; the moved source files are deleted.

**Late fixes on the branch (post-extraction parity):**

- `@theme inline` so tokens don't pollute the host's `:root` (themable); dev CSS build ordering.
- Restored visual parity: moved the button reset back into `@layer base` (unlayered, it was beating
  every Tailwind utility on `<button>` — chips/switches/action buttons lost their styles); and made
  the filter dropdown teleport to `.notifications-root` instead of `<body>` so it keeps the `--nt-*`
  token scope.
- Removed the AI chat input's focus outline (wrapper border is the focus affordance); simplified the
  admin feature-flag hints.

**AI chat improvements (latest):**

- AI answers now render **markdown** (bold/lists/headings/code/links) via a `marked`-tokens → VNode
  renderer (`MarkdownMessage`), **not `v-html`** — raw model HTML is never injected (`html` tokens
  dropped, link hrefs sanitized), so the module keeps its no-`v-html` property. Inline `[n#]`
  citations still render as the interactive `CitationChip` component.
- Composer is now a `<textarea>`: **Enter sends, Shift+Enter inserts a newline** (ignores Enter
  mid-IME composition); auto-grows to a few lines.
- The Assistant tab **auto-scrolls** to the newest message on open and follows the streaming answer
  while the user is near the bottom.
- **New runtime dependency:** `marked` (v18, ~zero-dep, widely maintained) added to
  `@notifications/vue` — flagged for the contract review since it's a new dep on the gated library.

## Why

Delivers the mentor's library-conversion goal: the notification system usable as an importable Vue
component library any host app can mount, injecting its own identity/auth/transport — proven by the
reference app consuming it exactly like `backend/` consumes `@notifications/core`.

## How it was tested

- **Unit:** `@notifications/vue` — 157 tests pass (Pinia-mock specs migrated to a provider-inject
  harness; incl. a `MarkdownMessage` spec covering formatting, inline citations, the no-raw-HTML
  security property, and unsafe-href stripping). Whole repo (core / server-fastify / backend /
  frontend) green.
- **`typecheck` + `lint` + `build` clean.**
- **e2e (behavioral proof of the extraction):** the existing Playwright suite passes **UNCHANGED —
  all 10** against the rewired reference app (feed/SSE/read, admin gating, AI chat + summary,
  generator, QoL/Dev-Labs).
- **Browser-verified** (computed styles, hard reload): Editorial-Ivory tokens genuinely apply; after
  the parity fix, filter chips render as 12px green pills, the teleported dropdown carries
  `--nt-color-surface` + a subtle border, admin toggle switches show the green accent track; 0
  console errors. AI chat (real model): markdown answers render real `<ul>/<li>/<strong>`, citation
  chips stay interactive, Shift+Enter newline vs Enter-send works, tab re-entry lands at the bottom.
- Reviews run this session: code-review (GO), security-review (GO — identity injected-not-derived,
  admin server-enforced), design-review (parity, the `:root`-pollution HIGH fixed).

## Still open

- **Mentor sign-off required before merge** on the public contract: `NotificationConfig`, the
  exported component API, and the `--nt-*` token names — other apps build against these, so they're
  the hard-to-reverse surface. Same gate-then-lift pattern as the prior library tasks.
- Contract note (from security review): `import.meta.env.DEV` hides Dev Labs but is **not** an
  authorization control — prod safety of admin/simulate is server-enforced.
- Package ships `private: true` with `types`/`import` pointed at `src/` (d.ts emit deferred: Vue's
  `reactive()` leaks an internal symbol into declarations). Flip `private` + add the d.ts step at the
  actual publish/split.

---

## Suggested PR title

`feat(vue): extract notification UI into reusable @notifications/vue package`

## Commits (18)

```
feat(vue): markdown AI answers + multiline composer + auto-scroll
fix(vue): remove AI chat input focus outline; simplify feature-flag hints
fix(vue): restore visual parity — layer the button reset + keep filter dropdown in token scope
fix(vue): @theme inline (no :root token pollution, themable) + a11y danger text + dev CSS build ordering
refactor(frontend): consume @notifications/vue; delete extracted source
refactor(vue): move admin + forms; NotificationAdmin; relative imports; public exports; build
refactor(vue): move notification components; read state via injected context; migrate specs to harness
refactor(vue): harden provider-harness (actions follow overridden feed) + document read-once config
test(vue): provider-inject mounting harness
feat(vue): NotificationProvider + context + inject accessors
refactor(vue): feed/chat/panel/actions as provider-scoped state factories (reactive returns)
refactor(vue): settings/toast/summary as provider-scoped state factories
feat(vue): Transport interface, cookie transport, and SSE client
feat(vue): scoped --nt-* token stylesheet (no preflight) + vuetify/dark presets
refactor(vue): move design tokens, lib utils, UI primitives into the package
chore(vue): scaffold @notifications/vue package
docs: UI component library implementation plan
docs: UI component library (@notifications/vue) design spec
```
