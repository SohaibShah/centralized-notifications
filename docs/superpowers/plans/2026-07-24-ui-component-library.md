# UI Component Library (`@notifications/vue`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the notification-domain UI into a reusable Vue 3 package `@notifications/vue`, with the reference `frontend/` app rewired as a thin consumer that keeps every existing behavior (its Playwright e2e stays green).

**Architecture:** New `packages/vue/` mirrors the BE extraction (`packages/core` + `server-fastify` consumed by `backend/`). The library owns the components, admin UI, provider-scoped state composables, transport, primitives, forms, tokens, and a compiled stylesheet. A `<NotificationProvider :config>` injects the host's `baseUrl`/transport/SSE/user via `provide`/`inject`; components read state through `useFeed()`/`useChat()`/… No Pinia in the library. `frontend/` keeps auth/router/dashboard-chrome and consumes the package.

**Tech Stack:** Vue 3 (`<script setup>`), TypeScript strict, Vite library mode + Tailwind v4 (compiled to a shipped `style.css`), Vitest + `@vue/test-utils` + jsdom, `@notifications/shared`.

## Global Constraints

- TS strict; `pnpm lint` + `pnpm typecheck` + `pnpm -r build` clean before a task is "done".
- New/moved logic keeps its Vitest test in the same task; failure paths tested.
- **The library never derives identity** — it receives the host's `user` (roles/teamKeys) for UI gating only; the server enforces audience/admin via the carried credential.
- No secrets in the library; it holds no auth logic beyond carrying the host's credential/transport.
- **The reference app's existing Playwright e2e must pass UNCHANGED** — the behavioral proof.
- Design-system parity: the reference app looks identical after the move.
- Styling: NO Tailwind Preflight shipped; tokens are `--nt-*` on `.notifications-root` (not `:root`); `--nt-font-sans: inherit`. No default class prefix.
- Package: `type: module`, `peerDependencies: { vue: "^3.5" }` (NO pinia), `private: true`.
- **Mentor sign-off before merge** on `NotificationConfig`, the exported component API, and the `--nt-*` token names.

---

## File Structure (target `packages/vue/src/`)

- `provider/NotificationProvider.vue` — wraps a `.notifications-root`, builds deps + state, provides context.
- `provider/context.ts` — `NotificationConfig`, `NotificationsContext`, `NOTIFICATIONS_KEY`, `useNotifications()` + `useFeed/useChat/useSummary/useSettings/useToast/usePanel/useActions/useUser`.
- `transport/types.ts` — `Transport`, `SseClient`, `SseFactory`.
- `transport/cookie-transport.ts` — `createCookieTransport(baseUrl)` (from `api/client.ts`).
- `transport/sse.ts` — `connectSse(baseUrl, opts)` (from `api/sse.ts`).
- `state/{feed,chat,summary,settings,toast,panel,actions}.ts` — `createXState(deps)` factories (from the Pinia stores + `useNotificationActions`).
- `components/…` — moved notification components.
- `admin/…` — moved admin panels + `adminApi` + `NotificationAdmin.vue`.
- `ui/…`, `forms/…`, `design/…`, `lib/…` — moved primitives/forms/tokens/utils.
- `styles/lib.css` — Tailwind entry (tokens `--nt-*`, no preflight) → compiled `dist/style.css`; `styles/presets/{vuetify,dark}.css`.
- `test/provider-harness.ts` — `mountWithProvider(component, { state overrides })` test helper.
- `index.ts` — public exports.
- `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `test-setup.ts`.

`frontend/` keeps: `features/auth/*`, `stores/session.ts`, `forms/login.form.ts`, `router/`, `main.ts`, `App.vue`, `features/dashboard/*`, `features/admin/AdminView.vue`, `features/settings/*`; adds a `@notifications/vue` dep + an ivory theme file.

---

## Unit A — Scaffold the package + move primitives/tokens + styling build

### Task A1: Package scaffold that builds an empty entry

**Files:** Create `packages/vue/package.json`, `packages/vue/tsconfig.json`, `packages/vue/vite.config.ts`, `packages/vue/vitest.config.ts`, `packages/vue/src/test-setup.ts`, `packages/vue/src/index.ts`.

**Interfaces:** Produces the buildable package `@notifications/vue`.

- [ ] **Step 1:** Create `packages/vue/package.json`:

```json
{
  "name": "@notifications/vue",
  "version": "0.0.0",
  "private": true,
  "description": "Reusable Vue 3 notification UI (bell, panel, chat, admin) mounted via <NotificationProvider>. Host injects transport + identity. Publishable-shaped; flip private -> false at the split.",
  "type": "module",
  "sideEffects": ["**/*.css"],
  "exports": {
    ".": { "types": "./src/index.ts", "import": "./src/index.ts" },
    "./style.css": "./dist/style.css",
    "./presets/vuetify.css": "./src/styles/presets/vuetify.css",
    "./presets/dark.css": "./src/styles/presets/dark.css"
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "files": ["src", "dist"],
  "scripts": {
    "build": "vite build && vue-tsc -p tsconfig.build.json --emitDeclarationOnly && pnpm build:css",
    "build:css": "tailwindcss -i ./src/styles/lib.css -o ./dist/style.css --minify",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@notifications/shared": "workspace:*",
    "@lucide/vue": "^1.23.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.6.0",
    "virtua": "^0.41.5",
    "zod": "^3.24.1"
  },
  "peerDependencies": { "vue": "^3.5" },
  "devDependencies": {
    "@tailwindcss/cli": "^4.3.2",
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/test-utils": "^2.4.11",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4.3.2",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "vitest": "^3.0.0",
    "vue": "^3.5.13",
    "vue-tsc": "^2.2.0"
  }
}
```

(Confirm `virtua`'s version against `frontend`'s installed version — copy whatever `frontend` resolves; the spec lists it as a dep. If `frontend/package.json` lacks it, run `pnpm --filter @notifications/frontend why virtua` to get the resolved version and use that.)

- [ ] **Step 2:** Create `packages/vue/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "env.d.ts"]
}
```

Create `packages/vue/env.d.ts`:

```ts
/// <reference types="vite/client" />
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
```

Create `packages/vue/tsconfig.build.json` (for d.ts emit):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "./dist"
  }
}
```

- [ ] **Step 3:** Create `packages/vue/vite.config.ts` (library build + vitest):

```ts
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    lib: { entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)), formats: ["es"], fileName: "index" },
    rollupOptions: { external: ["vue", "@notifications/shared"] },
  },
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    setupFiles: ["./src/test-setup.ts"],
    environment: "jsdom",
  },
});
```

- [ ] **Step 4:** Create `packages/vue/src/test-setup.ts` (copy verbatim from `frontend/src/test-setup.ts` — the IntersectionObserver stub), and a placeholder `packages/vue/src/index.ts`:

```ts
export {};
```

- [ ] **Step 5:** Install + verify the empty package builds a JS bundle.

Run: `pnpm install && pnpm --filter @notifications/vue build`
Expected: Vite emits `dist/index.js`; `build:css` will fail only because `styles/lib.css` doesn't exist yet — that's Task A3. For THIS task, temporarily run just `pnpm --filter @notifications/vue exec vite build` and expect success.

- [ ] **Step 6: Commit** — `chore(vue): scaffold @notifications/vue package`

### Task A2: Move design tokens (TS), lib utils, and UI primitives

**Files:** `git mv` from `frontend/src` into `packages/vue/src`: `design/{tokens,icons}.ts`, `lib/{cn,time}.ts`, `components/ui/*` → `ui/*` (Button, Chip, Icon, Skeleton, Spinner, StatePanel + their `.spec.ts`).

**Interfaces:** Produces `@/design`, `@/lib`, `@/ui/*` inside the package (same `@` alias → `packages/vue/src`).

- [ ] **Step 1:** Move the files:

```bash
cd /Users/so.shah/Documents/centralized-notifications-test
git mv frontend/src/design packages/vue/src/design
git mv frontend/src/lib packages/vue/src/lib
mkdir -p packages/vue/src/ui
git mv frontend/src/components/ui/* packages/vue/src/ui/
rmdir frontend/src/components/ui frontend/src/components 2>/dev/null || true
```

- [ ] **Step 2:** Rewrite intra-moved imports. In every moved file the `@/` alias now points at `packages/vue/src`, so `@/lib/cn`, `@/design/tokens`, `@/components/ui/Icon` must become `@/ui/Icon` where the path changed (`components/ui` → `ui`). Run:

```bash
cd packages/vue/src
grep -rl "@/components/ui/" . | xargs sed -i '' 's#@/components/ui/#@/ui/#g'
```

- [ ] **Step 3:** Run the moved primitive specs against the package.

Run: `pnpm --filter @notifications/vue test`
Expected: the moved `ui/*.spec.ts` pass (they don't touch stores). If a spec imports `@/components/ui/...`, fix to `@/ui/...`.

- [ ] **Step 4: Commit** — `refactor(vue): move design tokens, lib utils, UI primitives into the package`

### Task A3: Styling — `--nt-*` tokens, no preflight, compiled stylesheet + presets

**Files:** Create `packages/vue/src/styles/lib.css` (from `frontend/src/styles/main.css`), `packages/vue/src/styles/presets/vuetify.css`, `packages/vue/src/styles/presets/dark.css`.

**Interfaces:** Produces the buildable `dist/style.css` and the token contract (`--nt-*` on `.notifications-root`).

- [ ] **Step 1:** Create `packages/vue/src/styles/lib.css`. Start from `frontend/src/styles/main.css` but: (a) drop the `@fontsource` imports (host owns fonts); (b) put the `@theme` token block AND base element styles inside a `.notifications-root` scope; (c) rename every `--color-*`/`--font-*`/`--radius-*` token to `--nt-*`; (d) default `--nt-font-sans` to `inherit`; (e) do NOT emit Preflight. Concretely:

```css
@import "tailwindcss" theme(reference);

/* Utilities only — NO preflight/base reset (the library inherits the host's base styles). */
@layer utilities {
  /* Tailwind generates the used utilities here at build time. */
}

/* Tokens are the public theming API. Scoped to .notifications-root so they neither override
   the host's variables nor get overridden. Renamed --nt-* to avoid collisions. */
.notifications-root {
  --nt-font-sans: inherit;
  --nt-font-display: "Fraunces Variable", ui-serif, Georgia, serif;
  --nt-font-mono: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace;

  --nt-color-bg: oklch(0.975 0.012 85);
  --nt-color-surface: oklch(0.995 0.006 85);
  --nt-color-sunken: oklch(0.965 0.013 85);
  --nt-color-text: oklch(0.23 0.02 60);
  --nt-color-muted: oklch(0.5 0.02 60);
  --nt-color-faint: oklch(0.55 0.018 70);
  --nt-color-line: oklch(0.9 0.012 80);
  --nt-color-line-strong: oklch(0.87 0.014 80);
  --nt-color-accent: oklch(0.45 0.09 155);
  --nt-color-accent-ink: oklch(0.98 0.01 155);
  --nt-color-danger: oklch(0.52 0.17 28);
  --nt-color-danger-ink: oklch(0.98 0.01 28);
  --nt-color-warning: oklch(0.72 0.14 68);
  /* …carry over EVERY token from frontend/src/styles/main.css, renamed --color-X → --nt-color-X,
     --font-X → --nt-font-X, etc. Read that file and port the full set verbatim (values unchanged). */

  color: var(--nt-color-text);
  font-family: var(--nt-font-sans);
}

/* Map Tailwind's @theme names onto the --nt-* tokens so the utilities the components already use
   (bg-accent, text-muted, …) resolve to the scoped tokens. */
@theme inline {
  --color-bg: var(--nt-color-bg);
  --color-surface: var(--nt-color-surface);
  --color-sunken: var(--nt-color-sunken);
  --color-text: var(--nt-color-text);
  --color-muted: var(--nt-color-muted);
  --color-faint: var(--nt-color-faint);
  --color-line: var(--nt-color-line);
  --color-line-strong: var(--nt-color-line-strong);
  --color-accent: var(--nt-color-accent);
  --color-accent-ink: var(--nt-color-accent-ink);
  --color-danger: var(--nt-color-danger);
  --color-danger-ink: var(--nt-color-danger-ink);
  --color-warning: var(--nt-color-warning);
  --font-sans: var(--nt-font-sans);
  --font-display: var(--nt-font-display);
  --font-mono: var(--nt-font-mono);
  /* …one line per token, same set as above. */
}
```

(The `@theme inline` bridge lets the existing `bg-accent`/`text-muted`/… utility class strings in the components keep working while sourcing values from the scoped `--nt-*` tokens. Read `frontend/src/styles/main.css` and port EVERY token — do not drop any, or a component will render an unset color.)

- [ ] **Step 2:** Create `packages/vue/src/styles/presets/dark.css` — a dark token set:

```css
.notifications-root {
  --nt-color-bg: oklch(0.22 0.01 260);
  --nt-color-surface: oklch(0.26 0.012 260);
  --nt-color-sunken: oklch(0.2 0.01 260);
  --nt-color-text: oklch(0.95 0.01 90);
  --nt-color-muted: oklch(0.72 0.02 260);
  --nt-color-faint: oklch(0.6 0.02 260);
  --nt-color-line: oklch(0.34 0.012 260);
  --nt-color-line-strong: oklch(0.4 0.014 260);
  /* accent/danger/warning inherit from the base unless overridden. */
}
```

Create `packages/vue/src/styles/presets/vuetify.css` — map `--nt-*` onto Vuetify v3 theme vars:

```css
.notifications-root {
  --nt-color-surface: rgb(var(--v-theme-surface));
  --nt-color-bg: rgb(var(--v-theme-background));
  --nt-color-text: rgb(var(--v-theme-on-surface));
  --nt-color-accent: rgb(var(--v-theme-primary));
  --nt-color-accent-ink: rgb(var(--v-theme-on-primary));
  --nt-color-danger: rgb(var(--v-theme-error));
  --nt-color-warning: rgb(var(--v-theme-warning));
  --nt-font-sans: inherit;
  /* muted/faint/line derive from on-surface with reduced emphasis if the host wants; defaults are fine. */
}
```

- [ ] **Step 3:** Build the CSS.

Run: `pnpm --filter @notifications/vue exec tailwindcss -i ./src/styles/lib.css -o ./dist/style.css --minify`
Expected: `dist/style.css` written, non-empty, contains `.notifications-root` and no global `*,::before` preflight reset. Grep to confirm no preflight: `grep -c "\\*,::before" dist/style.css` → expect `0` (Tailwind preflight's signature selector absent). If preflight leaked, the `theme(reference)` import + utilities-only layering needs adjustment (do not `@import "tailwindcss"` bare).

- [ ] **Step 4: Commit** — `feat(vue): scoped --nt-* token stylesheet (no preflight) + vuetify/dark presets`

---

## Unit B — Transport

### Task B1: `Transport` interface + default cookie transport

**Files:** Create `packages/vue/src/transport/types.ts`, `packages/vue/src/transport/cookie-transport.ts`, `packages/vue/src/transport/cookie-transport.spec.ts`. Remove `frontend/src/api/client.ts` after (Task F).

**Interfaces:**
- Produces `Transport`, `ApiError`, `createCookieTransport(baseUrl: string): Transport`.

- [ ] **Step 1: Write the failing test** `packages/vue/src/transport/cookie-transport.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createCookieTransport } from "./cookie-transport";

describe("cookie transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefixes baseUrl, sends credentials, parses JSON", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ n: 1 }) }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const t = createCookieTransport("https://api.example");
    expect(await t.get("/notifications/counts")).toEqual({ n: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.example/notifications/counts");
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("throws ApiError carrying status + server error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "nope" }) })) as unknown as typeof fetch,
    );
    const t = createCookieTransport("");
    await expect(t.get("/x")).rejects.toMatchObject({ status: 404, message: "nope" });
    await expect(t.get("/x")).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @notifications/vue test cookie-transport` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Create `packages/vue/src/transport/types.ts`:

```ts
import type { Notification } from "@notifications/shared";

export interface Transport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export interface SseClient {
  close(): void;
}
export type SseStatus = "connecting" | "open" | "closed";
export type SseFactory = (opts: {
  onBatch: (batch: Notification[]) => void;
  onStatus?: (status: SseStatus) => void;
}) => SseClient;
```

Create `packages/vue/src/transport/cookie-transport.ts` — port `frontend/src/api/client.ts` verbatim, but (a) `ApiError` class unchanged, (b) wrap `request` in `createCookieTransport(baseUrl)` that prefixes `baseUrl + path`:

```ts
import type { Transport } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Same-origin/cookie transport (the reference host). `credentials:"include"` sends the session
 *  cookie; a host with token auth injects its own Transport instead. */
export function createCookieTransport(baseUrl: string): Transport {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
    if (init?.body !== undefined && !("content-type" in headers)) headers["content-type"] = "application/json";
    const res = await fetch(baseUrl + path, { credentials: "include", ...init, headers });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* non-JSON body */
      }
      throw new ApiError(res.status, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
  return {
    get: (p) => request(p),
    post: (p, b) => request(p, { method: "POST", body: b === undefined ? undefined : JSON.stringify(b) }),
    patch: (p, b) => request(p, { method: "PATCH", body: b === undefined ? undefined : JSON.stringify(b) }),
    del: (p) => request(p, { method: "DELETE" }),
  };
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(vue): Transport interface + default cookie transport`

### Task B2: Default SSE client

**Files:** Create `packages/vue/src/transport/sse.ts` (from `frontend/src/api/sse.ts`), `packages/vue/src/transport/sse.spec.ts`.

**Interfaces:** Produces `connectSse(baseUrl: string, opts): SseClient` (a `SseFactory` once `baseUrl` is bound).

- [ ] **Step 1: Write the failing test** `packages/vue/src/transport/sse.spec.ts` — stub `EventSource` and assert it opens `baseUrl + "/sse"` and hands a parsed batch to `onBatch`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSse } from "./sse";

class ESStub {
  static last: ESStub | undefined;
  url: string;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onopen: (() => void) | null = null;
  constructor(url: string) { this.url = url; ESStub.last = this; }
  addEventListener(t: string, cb: (e: MessageEvent) => void) { (this.listeners[t] ??= []).push(cb); }
  emit(t: string, data: string) { for (const cb of this.listeners[t] ?? []) cb(new MessageEvent(t, { data })); }
  close() {}
}

describe("connectSse", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("opens baseUrl+/sse and delivers a validated batch", () => {
    vi.stubGlobal("EventSource", ESStub as unknown as typeof EventSource);
    const batches: unknown[] = [];
    connectSse("https://api.example", { onBatch: (b) => batches.push(b) });
    expect(ESStub.last!.url).toBe("https://api.example/sse");
    const n = { id: "a", module: "dsr", title: "t", description: "", priority: "high", snoozable: false, audience: { scope: "global" } };
    ESStub.last!.emit("notifications", JSON.stringify([n]));
    expect(batches[0]).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Implement** — copy `frontend/src/api/sse.ts` into `packages/vue/src/transport/sse.ts`, changing the signature to `connectSse(baseUrl: string, opts: {...})` and `new EventSource(baseUrl + "/sse", { withCredentials: true })`. Keep the zod validation-at-the-boundary logic verbatim.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(vue): default SSE client bound to baseUrl`

---

## Unit C — State factories + provider

### Task C1: Convert the simple stores to factories (settings, toast, summary)

**Files:** Create `packages/vue/src/state/{settings,toast,summary}.ts` + move their `.spec.ts`. Source: `frontend/src/stores/{settings,toast,summary}.ts`.

**Interfaces:**
- Produces `createSettingsState(deps: { transport: Transport })`, `createToastState()`, `createSummaryState(deps: { transport: Transport })` — each returning the SAME shape the Pinia store returned.

**Conversion rule (apply to every store):** `export const useXStore = defineStore("x", () => { BODY; return R })` becomes `export function createXState(deps) { BODY'; return R }` where `BODY'` is `BODY` with `import { api } from "@/api/client"` removed and every `api.` replaced by `deps.transport.`, and every `connectSse(` replaced by `deps.connectSse(`. No other logic changes.

- [ ] **Step 1: Write the failing test** `packages/vue/src/state/settings.spec.ts` (adapt `frontend/src/stores/settings.spec.ts` from Pinia to a direct factory call):

```ts
import { describe, expect, it, vi } from "vitest";
import { createSettingsState } from "./settings";
import type { Transport } from "../transport/types";

function fakeTransport(over: Partial<Transport> = {}): Transport {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over } as Transport;
}

describe("settings state", () => {
  it("loads feature flags via the injected transport", async () => {
    const get = vi.fn(async () => ({ aiSummaryEnabled: true, chatbotEnabled: false, groupingEnabled: true, actionsEnabled: true }));
    const s = createSettingsState({ transport: fakeTransport({ get }) });
    await s.load();
    expect(get).toHaveBeenCalledWith("/settings/features");
    expect(s.flags.chatbotEnabled).toBe(false);
    expect(s.loaded.value).toBe(true);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @notifications/vue test state/settings` — Expected: FAIL.

- [ ] **Step 3: Implement** `packages/vue/src/state/settings.ts` by applying the conversion rule to `frontend/src/stores/settings.ts`:

```ts
import { reactive, ref } from "vue";
import type { Transport } from "../transport/types";

export interface FeatureFlags {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
}

export function createSettingsState(deps: { transport: Transport }) {
  const flags = reactive<FeatureFlags>({
    aiSummaryEnabled: true,
    chatbotEnabled: true,
    groupingEnabled: true,
    actionsEnabled: true,
  });
  const loaded = ref(false);
  async function load(): Promise<void> {
    const data = await deps.transport.get<FeatureFlags>("/settings/features");
    Object.assign(flags, data);
    loaded.value = true;
  }
  return { flags, loaded, load };
}
```

- [ ] **Step 4:** Do the same for `state/toast.ts` (from `stores/toast.ts`; `createToastState()` — no transport dep unless it calls the API; keep its body) and `state/summary.ts` (from `stores/summary.ts`; `createSummaryState({ transport })`, `api.get` → `deps.transport.get`). Move + adapt `toast.spec.ts` and `summary.spec.ts` (replace `setActivePinia`/`useXStore()` with `createXState(...)`; where the old spec mocked `@/api/client`'s `api.get`, now pass a `fakeTransport({ get })`).

- [ ] **Step 5: Run** — `pnpm --filter @notifications/vue test state/` — Expected: PASS.
- [ ] **Step 6: Commit** — `refactor(vue): settings/toast/summary as provider-scoped state factories`

### Task C2: Convert the coupled stores (feed, chat, notificationPanel) + actions

**Files:** Create `packages/vue/src/state/{feed,chat,panel,actions}.ts` + move their `.spec.ts`. Source: `frontend/src/stores/{feed,chat,notificationPanel}.ts` + `frontend/src/composables/useNotificationActions.ts`.

**Interfaces:**
- Produces `createFeedState(deps: { transport; connectSse: (o)=>SseClient })`, `createChatState(deps: { baseUrl: string })`, `createPanelState(deps: { feed; chat; summary })`, `createNotificationActions(deps: { feed })` (returns `{ runAction }`).

- [ ] **Step 1:** Read each source file and list its cross-store calls: `grep -n "use.*Store(\|connectSse\|api\.\|fetch(" frontend/src/stores/{feed,chat,notificationPanel}.ts frontend/src/composables/useNotificationActions.ts`. Each `useSiblingStore()` call becomes a `deps.sibling` passed in. Known: `useNotificationActions` → `feed.markRead` (so `createNotificationActions({ feed })`); `notificationPanel` coordinates feed/chat/summary (pass those). **chat** uses raw `fetch("/notifications/chat")` (streaming) — change to `fetch(deps.baseUrl + "/notifications/chat", { credentials: "include", ... })` (NOT the JSON transport). Document the token-auth limitation in a comment (custom-auth hosts need a future streaming-fetch override).

- [ ] **Step 2: Write the failing tests** — move `stores/feed.spec.ts`, `stores/chat.spec.ts`, `stores/notificationPanel.spec.ts`, `composables/useNotificationActions.spec.ts` into `packages/vue/src/state/` and adapt: replace `setActivePinia(createPinia())` + `useXStore()` with the factory call, and replace any `vi.mock("@/api/client")`/`vi.mock("@/api/sse")` with injected fakes (`fakeTransport`, a fake `connectSse`, a `feed` stub for actions). Keep every behavioral assertion. For chat, keep the existing `streamResponse` fetch-mock helper; assert it POSTs to `deps.baseUrl + "/notifications/chat"`.

- [ ] **Step 3: Run to verify they fail** — `pnpm --filter @notifications/vue test state/` — Expected: FAIL (modules missing).

- [ ] **Step 4: Implement** each factory by applying the conversion rule to its source file:
  - `state/feed.ts` — `createFeedState({ transport, connectSse })`; `api.` → `transport.`, `connectSse(` → `deps.connectSse(`.
  - `state/chat.ts` — `createChatState({ baseUrl })`; the `fetch("/notifications/chat", …)` → `fetch(deps.baseUrl + "/notifications/chat", …)` (credentials include preserved). No transport dep.
  - `state/panel.ts` — `createPanelState({ feed, chat, summary })`; sibling `useXStore()` calls → `deps.X`.
  - `state/actions.ts` — from `useNotificationActions`: `createNotificationActions({ feed })`; `feed.markRead(id)` via `deps.feed.markRead`; keep the `window.open`/dispatch-stub logic verbatim.

- [ ] **Step 5: Run** — `pnpm --filter @notifications/vue test state/` + `pnpm --filter @notifications/vue typecheck` — Expected: PASS + clean.
- [ ] **Step 6: Commit** — `refactor(vue): feed/chat/panel/actions as provider-scoped state factories`

### Task C3: `NotificationProvider` + context + inject accessors

**Files:** Create `packages/vue/src/provider/context.ts`, `packages/vue/src/provider/NotificationProvider.vue`, `packages/vue/src/provider/context.spec.ts`.

**Interfaces:**
- Produces `NotificationConfig`, `NOTIFICATIONS_KEY`, `NotificationsContext`, `useNotifications()`, and `useFeed/useChat/useSummary/useSettings/useToast/usePanel/useActions/useUser`.

- [ ] **Step 1: Write the failing test** `packages/vue/src/provider/context.spec.ts` — mount a tiny component that calls `useFeed()` inside `<NotificationProvider>` and one that calls it OUTSIDE (expects a thrown guard):

```ts
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import NotificationProvider from "./NotificationProvider.vue";
import { useFeed, useUser } from "./context";

const Probe = defineComponent({
  setup() {
    const feed = useFeed();
    const user = useUser();
    return () => h("div", { "data-test": "probe" }, `${typeof feed.loadInitial}:${user.value?.roles.join(",") ?? "none"}`);
  },
});

describe("NotificationProvider", () => {
  it("provides state to descendants and injects the user", () => {
    vi.stubGlobal("EventSource", class { addEventListener() {} close() {} onopen = null; } as unknown as typeof EventSource);
    const w = mount(NotificationProvider, {
      props: { config: { baseUrl: "", user: { roles: ["admin"] } } },
      slots: { default: () => h(Probe) },
    });
    expect(w.find('[data-test="probe"]').text()).toContain("function:admin");
    expect(w.find(".notifications-root").exists()).toBe(true);
  });

  it("useFeed() outside a provider throws a helpful error", () => {
    expect(() => mount(Probe)).toThrow(/NotificationProvider/);
  });
});
```

(Adjust `loadInitial` to whatever `createFeedState` actually names its initial-load action — read `state/feed.ts` and use the real method name.)

- [ ] **Step 2: Run it** — Expected: FAIL.

- [ ] **Step 3: Implement** `packages/vue/src/provider/context.ts`:

```ts
import { inject, type InjectionKey, type Ref } from "vue";
import type { Transport, SseFactory } from "../transport/types";
import type { createFeedState } from "../state/feed";
import type { createChatState } from "../state/chat";
import type { createSummaryState } from "../state/summary";
import type { createSettingsState } from "../state/settings";
import type { createToastState } from "../state/toast";
import type { createPanelState } from "../state/panel";
import type { createNotificationActions } from "../state/actions";

export interface NotificationUser {
  roles: string[];
  teamKeys?: string[];
}
export interface NotificationConfig {
  baseUrl?: string;
  transport?: Transport;
  connectSse?: SseFactory;
  user: NotificationUser | null;
}

export interface NotificationsContext {
  feed: ReturnType<typeof createFeedState>;
  chat: ReturnType<typeof createChatState>;
  summary: ReturnType<typeof createSummaryState>;
  settings: ReturnType<typeof createSettingsState>;
  toast: ReturnType<typeof createToastState>;
  panel: ReturnType<typeof createPanelState>;
  actions: ReturnType<typeof createNotificationActions>;
  user: Ref<NotificationUser | null>;
  baseUrl: string;
}

export const NOTIFICATIONS_KEY: InjectionKey<NotificationsContext> = Symbol("notifications");

export function useNotifications(): NotificationsContext {
  const ctx = inject(NOTIFICATIONS_KEY);
  if (!ctx) throw new Error("useFeed()/useChat()/… must be used inside <NotificationProvider>.");
  return ctx;
}
export const useFeed = () => useNotifications().feed;
export const useChat = () => useNotifications().chat;
export const useSummary = () => useNotifications().summary;
export const useSettings = () => useNotifications().settings;
export const useToast = () => useNotifications().toast;
export const usePanel = () => useNotifications().panel;
export const useActions = () => useNotifications().actions;
export const useUser = () => useNotifications().user;
```

Create `packages/vue/src/provider/NotificationProvider.vue`:

```vue
<script setup lang="ts">
import { provide, toRef } from "vue";
import { createCookieTransport } from "../transport/cookie-transport";
import { connectSse as defaultConnectSse } from "../transport/sse";
import { createFeedState } from "../state/feed";
import { createChatState } from "../state/chat";
import { createSummaryState } from "../state/summary";
import { createSettingsState } from "../state/settings";
import { createToastState } from "../state/toast";
import { createPanelState } from "../state/panel";
import { createNotificationActions } from "../state/actions";
import { NOTIFICATIONS_KEY, type NotificationConfig, type NotificationsContext } from "./context";

const props = defineProps<{ config: NotificationConfig }>();

const baseUrl = props.config.baseUrl ?? "";
const transport = props.config.transport ?? createCookieTransport(baseUrl);
const connectSse = props.config.connectSse ?? ((opts) => defaultConnectSse(baseUrl, opts));

// Build once. Order matters: leaf state first, then the coordinators that depend on siblings.
const toast = createToastState();
const settings = createSettingsState({ transport });
const summary = createSummaryState({ transport });
const feed = createFeedState({ transport, connectSse });
const chat = createChatState({ baseUrl });
const actions = createNotificationActions({ feed });
const panel = createPanelState({ feed, chat, summary });

const ctx: NotificationsContext = {
  feed, chat, summary, settings, toast, panel, actions,
  user: toRef(() => props.config.user),
  baseUrl,
};
provide(NOTIFICATIONS_KEY, ctx);
</script>

<template>
  <div class="notifications-root"><slot /></div>
</template>
```

(If `createToastState`/`createPanelState` need a sibling not listed — e.g. feed emits toasts — pass it here; reconcile against the real factory signatures from Task C1/C2. Keep the build order leaf→coordinator.)

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5:** Full package gate — `pnpm --filter @notifications/vue test && pnpm --filter @notifications/vue typecheck` — Expected: green.
- [ ] **Step 6: Commit** — `feat(vue): NotificationProvider + context + inject accessors`

### Task C4: The provider-inject test harness

**Files:** Create `packages/vue/src/test/provider-harness.ts`.

**Interfaces:** Produces `mountWithProvider(component, opts?)` used by the component specs in Units D/E.

- [ ] **Step 1: Implement** a helper that provides a real (fake-transport-backed) context so component specs render without a live backend:

```ts
import { defineComponent, h, provide } from "vue";
import { mount, type ComponentMountingOptions } from "@vue/test-utils";
import { vi } from "vitest";
import { NOTIFICATIONS_KEY, type NotificationsContext } from "../provider/context";

/** Mount a component inside a provided notifications context. Pass `context` to override slices
 *  (e.g. a fake `feed` with canned items). Anything omitted gets a minimal stub. */
export function mountWithProvider(
  component: Parameters<typeof mount>[0],
  opts: { context?: Partial<NotificationsContext> } & ComponentMountingOptions<unknown> = {},
) {
  const { context, ...mountOpts } = opts;
  const Wrapper = defineComponent({
    setup(_, { slots }) {
      provide(NOTIFICATIONS_KEY, { ...(minimalContext()), ...(context ?? {}) } as NotificationsContext);
      return () => h("div", { class: "notifications-root" }, slots.default?.());
    },
  });
  return mount(Wrapper, { ...mountOpts, slots: { default: () => h(component as never) } });
}

function minimalContext(): NotificationsContext {
  // Minimal stubs; specs override the slice they exercise.
  const noop = vi.fn();
  return {
    // Fill with the smallest shape each factory returns — specs that need behavior pass a real slice.
    // (Read the factory return types; stub methods with vi.fn() and refs with ref(...) as needed.)
  } as unknown as NotificationsContext;
}
```

(Complete `minimalContext()` against the real factory return shapes once C1–C3 exist — stub each method with `vi.fn()` and each ref with a `ref()` default; the point is specs only override the slice they test.)

- [ ] **Step 2:** No standalone test (it's test infra); it's exercised by Unit D. Typecheck: `pnpm --filter @notifications/vue typecheck`.
- [ ] **Step 3: Commit** — `test(vue): provider-inject mounting harness`

---

## Unit D — Move the components

### Task D1: Move notification components + rewire to `useX()`/injected context

**Files:** `git mv` `frontend/src/features/notifications/*` → `packages/vue/src/components/*` (NotificationBell, NotificationPopover, CriticalToast, CriticalToastViewport, `components/{FeedList,FilterMenu}`, `panel/{InboxTab,AssistantTab,CitationChip}`, `renderers/NotificationCardRenderer`) + their `.spec.ts`.

**Interfaces:** Produces the moved components importing state via `useFeed()` etc. and primitives via `@/ui/*`.

- [ ] **Step 1:** Move:

```bash
cd /Users/so.shah/Documents/centralized-notifications-test
mkdir -p packages/vue/src/components
git mv frontend/src/features/notifications/* packages/vue/src/components/
rmdir frontend/src/features/notifications 2>/dev/null || true
```

- [ ] **Step 2:** Rewire imports across the moved tree (`packages/vue/src/components`):
  - `@/stores/feed` → `@/provider/context` and `useFeedStore()` → `useFeed()` (same for chat/summary/settings/toast/notificationPanel → useChat/useSummary/useSettings/useToast/usePanel).
  - `@/composables/useNotificationActions` → `useActions()` from `@/provider/context` (call site: `const { runAction } = useActions()`).
  - `@/api/*` → not referenced by components (only stores were).
  - `@/components/ui/` → `@/ui/`.
  - `useSessionStore()` for admin gating → `useUser()` (the injected user); `isAdmin` becomes `user.value?.roles.includes("admin")`.

  Concretely:

```bash
cd packages/vue/src/components
grep -rl "@/stores/\|@/composables/useNotificationActions\|@/components/ui/\|useFeedStore\|useChatStore\|useSummaryStore\|useSettingsStore\|useToastStore\|useNotificationPanelStore" . | while read f; do
  sed -i '' \
    -e 's#@/components/ui/#@/ui/#g' \
    -e 's#import { useFeedStore } from "@/stores/feed";#import { useFeed } from "@/provider/context";#' \
    -e 's#useFeedStore()#useFeed()#g' \
    -e 's#import { useChatStore } from "@/stores/chat";#import { useChat } from "@/provider/context";#' \
    -e 's#useChatStore()#useChat()#g' \
    -e 's#import { useSummaryStore } from "@/stores/summary";#import { useSummary } from "@/provider/context";#' \
    -e 's#useSummaryStore()#useSummary()#g' \
    -e 's#import { useSettingsStore } from "@/stores/settings";#import { useSettings } from "@/provider/context";#' \
    -e 's#useSettingsStore()#useSettings()#g' \
    -e 's#import { useToastStore } from "@/stores/toast";#import { useToast } from "@/provider/context";#' \
    -e 's#useToastStore()#useToast()#g' \
    -e 's#import { useNotificationPanelStore } from "@/stores/notificationPanel";#import { usePanel } from "@/provider/context";#' \
    -e 's#useNotificationPanelStore()#usePanel()#g' \
    -e 's#import { useNotificationActions } from "@/composables/useNotificationActions";#import { useActions } from "@/provider/context";#' \
    -e 's#useNotificationActions()#useActions()#g' \
    "$f"
done
```

  Then hand-fix the few `useSessionStore`/`isAdmin` gating spots (grep for them) to `useUser()`.

- [ ] **Step 3:** Rewire the moved component **specs** to `mountWithProvider(...)`. Each `NotificationPopover.spec.ts`/`InboxTab.spec.ts`/etc. currently mocks Pinia stores via `vi.mock` or `createTestingPinia`; replace with `mountWithProvider(Component, { context: { feed: <fake slice>, ... } })`. Keep every assertion. (The AssistantTab/CitationChip specs already mock `@/stores/chat` + `@/composables/useNotificationActions` via `vi.mock`; repoint those mocks at `@/provider/context`'s `useChat`/`useActions`.)

- [ ] **Step 4:** Run + typecheck: `pnpm --filter @notifications/vue test && pnpm --filter @notifications/vue typecheck` — Expected: PASS + clean. Fix any missed import.

- [ ] **Step 5: Commit** — `refactor(vue): move notification components; read state via injected context`

---

## Unit E — Move admin + forms

### Task E1: Move forms + admin panels; add `NotificationAdmin`

**Files:** `git mv` `frontend/src/forms/*` (EXCEPT `login.form.ts`) → `packages/vue/src/forms/*`; `git mv` `frontend/src/features/admin/{ModulesPanel,FeaturesPanel,GeneratorPanel,MaintenancePanel,DevLabsPanel}.vue` + `adminApi.ts` (+ specs) → `packages/vue/src/admin/`; create `packages/vue/src/admin/NotificationAdmin.vue`.

**Interfaces:** Produces `NotificationAdmin` (composite of the panels) + the exported `FormRenderer`.

- [ ] **Step 1:** Move (keep `login.form.ts` in the host):

```bash
cd /Users/so.shah/Documents/centralized-notifications-test
mkdir -p packages/vue/src/forms packages/vue/src/admin
git mv frontend/src/forms/FormRenderer.vue frontend/src/forms/fields frontend/src/forms/types.ts frontend/src/forms/validation.ts packages/vue/src/forms/
git mv frontend/src/forms/generator.form.ts frontend/src/forms/burst.form.ts frontend/src/forms/drip.form.ts frontend/src/forms/features.form.ts packages/vue/src/forms/
# specs
git mv frontend/src/forms/FormRenderer.spec.ts frontend/src/forms/SelectField.spec.ts frontend/src/forms/generator.form.spec.ts frontend/src/forms/validation.spec.ts packages/vue/src/forms/ 2>/dev/null || true
git mv frontend/src/features/admin/ModulesPanel.vue frontend/src/features/admin/FeaturesPanel.vue frontend/src/features/admin/GeneratorPanel.vue frontend/src/features/admin/MaintenancePanel.vue frontend/src/features/admin/DevLabsPanel.vue frontend/src/features/admin/adminApi.ts packages/vue/src/admin/
git mv frontend/src/features/admin/FeaturesPanel.spec.ts frontend/src/features/admin/GeneratorPanel.spec.ts frontend/src/features/admin/MaintenancePanel.spec.ts frontend/src/features/admin/ModulesPanel.spec.ts packages/vue/src/admin/ 2>/dev/null || true
```

(`login.form.ts` stays in `frontend/src/forms/`; `AdminView.vue` + its spec stay in `frontend/src/features/admin/`.)

- [ ] **Step 2:** Rewire imports in the moved `forms/` + `admin/` trees: `@/components/ui/` → `@/ui/`; `@/api/client` → the injected transport. **adminApi** currently imports the global `api`; convert `adminApi.ts` to a factory `createAdminApi(transport: Transport)` OR have the admin panels call `useNotifications().feed`/a new `admin` transport accessor. Simplest: `createAdminApi(transport)` returning the same methods; the panels get the transport from context — add `useTransport = () => useNotifications().transport` to `context.ts` and store `transport` on the context (add `transport` to `NotificationsContext` + set it in the provider). Panels: `const admin = createAdminApi(useTransport())`.

  Apply the same `sed` store/ui rewrites as D1-Step2 to `packages/vue/src/admin` and `packages/vue/src/forms`, plus:

```bash
cd packages/vue/src
grep -rl "@/api/client" admin forms | xargs sed -i '' 's#import { api } from "@/api/client";##' 2>/dev/null || true
```

  Then hand-wire each admin panel's data calls through `createAdminApi(useTransport())` (read each panel; replace `api.get/post(...)` with `admin.get/post` or the created client's methods). Add to `context.ts`: `transport: Transport` field + `export const useTransport = () => useNotifications().transport;`, and set `transport` in `NotificationProvider.vue`'s `ctx`.

- [ ] **Step 3:** Create `packages/vue/src/admin/NotificationAdmin.vue` — a composite that renders the panels (mirror the layout `frontend/src/features/admin/AdminView.vue` used; read it and reproduce the panel composition, minus the page chrome):

```vue
<script setup lang="ts">
import ModulesPanel from "./ModulesPanel.vue";
import FeaturesPanel from "./FeaturesPanel.vue";
import GeneratorPanel from "./GeneratorPanel.vue";
import MaintenancePanel from "./MaintenancePanel.vue";
import DevLabsPanel from "./DevLabsPanel.vue";
</script>

<template>
  <div class="flex flex-col gap-6">
    <ModulesPanel />
    <FeaturesPanel />
    <GeneratorPanel />
    <DevLabsPanel />
    <MaintenancePanel />
  </div>
</template>
```

(Match the exact panel set + order AdminView used; drop the sidebar/page heading which stay in the host's AdminView.)

- [ ] **Step 4:** Rewire the moved admin/forms specs to `mountWithProvider` (panels need the context's `transport`/`settings`); keep assertions. Run + typecheck: `pnpm --filter @notifications/vue test && pnpm --filter @notifications/vue typecheck` — Expected: PASS + clean.
- [ ] **Step 5: Commit** — `refactor(vue): move forms + admin panels; NotificationAdmin composite`

### Task E2: Public exports (`index.ts`)

**Files:** Modify `packages/vue/src/index.ts`.

- [ ] **Step 1:** Export the public surface:

```ts
// Components
export { default as NotificationProvider } from "./provider/NotificationProvider.vue";
export { default as NotificationBell } from "./components/NotificationBell.vue";
export { default as NotificationPanel } from "./components/NotificationPopover.vue";
export { default as CriticalToastViewport } from "./components/CriticalToastViewport.vue";
export { default as NotificationAdmin } from "./admin/NotificationAdmin.vue";
// Reusable primitives the host may need (LoginView uses FormRenderer)
export { default as FormRenderer } from "./forms/FormRenderer.vue";
export { default as Button } from "./ui/Button.vue";
export { default as Icon } from "./ui/Icon.vue";
// Composables (advanced hosts)
export { useNotifications, useFeed, useChat, useSummary, useSettings, useToast, usePanel, useActions, useUser } from "./provider/context";
// Types
export type { NotificationConfig, NotificationUser, NotificationsContext } from "./provider/context";
export type { Transport, SseClient, SseFactory, SseStatus } from "./transport/types";
export { ApiError, createCookieTransport } from "./transport/cookie-transport";
export { connectSse } from "./transport/sse";
// Form schema types (host login form reuse)
export type { FormSchema } from "./forms/types";
```

(Reconcile named exports against actual filenames/exported symbols. Add any primitive the host's `LoginView`/`SettingsStub` actually imports.)

- [ ] **Step 2:** Full package gate: `pnpm --filter @notifications/vue test && pnpm --filter @notifications/vue typecheck && pnpm --filter @notifications/vue build` — Expected: green (JS + d.ts + `dist/style.css`).
- [ ] **Step 3: Commit** — `feat(vue): public exports (components, provider, transport, types)`

---

## Unit F — Rewire the reference app

### Task F1: `frontend/` consumes `@notifications/vue`

**Files:** Modify `frontend/package.json`, `frontend/src/main.ts`, `frontend/src/App.vue` (or `DashboardLayout.vue`), `frontend/src/features/dashboard/components/DashboardTopBar.vue`, `frontend/src/features/dashboard/DashboardLayout.vue`, `frontend/src/features/admin/AdminView.vue`, `frontend/src/features/auth/LoginView.vue`; Create `frontend/src/styles/notifications-theme.css`. Delete leftover moved dirs.

- [ ] **Step 1:** Add the dep + drop now-unused ones. In `frontend/package.json` add `"@notifications/vue": "workspace:*"`. Remove `pinia` ONLY if the host no longer uses it — the `session` store is Pinia, so **keep pinia**. Keep `@fontsource-*` (host owns fonts). Run `pnpm install`.

- [ ] **Step 2:** Create `frontend/src/styles/notifications-theme.css` — the reference app's chosen token values (identical to today's look). Since `lib.css` already ships the Ivory defaults as `--nt-*`, this file only needs to (a) set `--nt-font-sans` to the app's Hanken font (so it's not left to inherit) and (b) override any token the host wants:

```css
.notifications-root {
  --nt-font-sans: "Hanken Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 3:** `frontend/src/main.ts` — import the library CSS + theme, keep fonts + host styles:

```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "@notifications/vue/style.css";
import "./styles/notifications-theme.css";
import "./styles/main.css"; // host's own app-shell styles (see Step 6)
import App from "./App.vue";
import { router } from "./router";

createApp(App).use(createPinia()).use(router).mount("#app");
```

- [ ] **Step 4:** Wrap the authenticated region in `<NotificationProvider>`. In `DashboardLayout.vue` (the shell that renders the bell + toast), build the config from the session store and wrap the template:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { NotificationProvider, CriticalToastViewport, type NotificationConfig } from "@notifications/vue";
import { useSessionStore } from "@/stores/session";
// …existing imports (Sidebar, TopBar)…
const session = useSessionStore();
const config = computed<NotificationConfig>(() => ({
  baseUrl: "",
  user: session.user ? { roles: session.user.roles, teamKeys: session.user.teamIds } : null,
}));
</script>

<template>
  <NotificationProvider :config="config">
    <!-- existing shell markup, with <CriticalToastViewport /> where it was -->
  </NotificationProvider>
</template>
```

  (The bell in `DashboardTopBar` and the admin in `AdminView` are descendants of this provider, so they get the context. If `AdminView` is a separate router view NOT nested under `DashboardLayout`, ensure the provider wraps the router-view region in `App.vue` instead — check the router: `frontend/src/router/index.ts` shows admin under the dashboard layout, so wrapping `DashboardLayout` covers it.)

- [ ] **Step 5:** Repoint host imports to the package:
  - `DashboardTopBar.vue`: `import NotificationBell from "@/features/notifications/NotificationBell.vue"` → `import { NotificationBell } from "@notifications/vue"`.
  - `DashboardLayout.vue`: `CriticalToastViewport` → from `@notifications/vue`.
  - `AdminView.vue`: replace the panel imports with `import { NotificationAdmin } from "@notifications/vue"` and render `<NotificationAdmin />` in place of the panel list (keep the page heading/sidebar chrome).
  - `LoginView.vue`: `import FormRenderer from "@/forms/FormRenderer.vue"` → `import { FormRenderer } from "@notifications/vue"`. `login.form.ts` stays local.

- [ ] **Step 6:** Delete the now-moved-and-duplicated leftovers from `frontend/src` (they were `git mv`d, so only stragglers remain): confirm `frontend/src/{stores/{feed,chat,summary,settings,toast,notificationPanel}.ts, composables, api, design, lib, components}` are gone (moved) and `frontend/src/features/notifications`/`admin panels` are gone. Trim `frontend/src/styles/main.css` to ONLY the host-app-shell styles that aren't in the library (dashboard chrome). If the host shell used the same `@theme` tokens/utilities, the simplest correct move is: host keeps its own `main.css` with `@import "tailwindcss"` for the dashboard chrome (login/sidebar/topbar), since the host app still uses Tailwind. Keep the host's `vite.config` Tailwind plugin.

- [ ] **Step 7:** Update the host's `stores/session.spec.ts` etc. only if imports broke. Run the host unit suite + typecheck: `pnpm --filter @notifications/frontend test && pnpm --filter @notifications/frontend typecheck` — Expected: green (host now has far fewer specs — auth/dashboard/session only). Fix any dangling `@/` import to a moved file.

- [ ] **Step 8: Commit** — `refactor(frontend): consume @notifications/vue; delete extracted source`

---

## Unit G — Whole-repo verification + reviews

### Task G1: Whole-repo green + e2e + reviews

- [ ] **Step 1:** `pnpm -r test && pnpm typecheck && pnpm lint && pnpm -r build` — Expected: all green, incl. `@notifications/vue` (test/typecheck/build → JS + d.ts + `dist/style.css`) and the trimmed `frontend`.

- [ ] **Step 2:** e2e UNCHANGED: `pnpm test:e2e` — Expected: the existing Playwright specs (login → live feed → read → chat → admin) pass against the rewired reference app with zero spec edits. If a selector broke, the extraction changed rendered output — fix the extraction, NOT the e2e.

- [ ] **Step 3:** Manual + review: restart `pnpm dev`, confirm the app looks identical (design parity); dispatch `frontend-design-reviewer` (token/design-system parity) and `browser-tester` (bell → panel → chat → admin all work), then `code-reviewer` on the whole branch, then `security-reviewer` (the transport/identity injection boundary — confirm the library still never derives identity and the injected `user` is gating-only).

- [ ] **Step 4: Commit** any review fixes. Then: mentor sign-off on `NotificationConfig` + the exported component API + the `--nt-*` token names → `/open-pr`.

---

## Verification (whole-branch, before finishing)

1. `pnpm -r test` — shared/core/server-fastify/backend/frontend/**vue** all green.
2. `pnpm typecheck && pnpm lint && pnpm -r build` — clean; `@notifications/vue` emits JS + d.ts + `dist/style.css`.
3. `pnpm test:e2e` — the existing reference-app e2e passes UNCHANGED (behavioral proof).
4. Manual/`browser-tester`: reference app looks + works identically (design parity).
5. Reviews: `frontend-design-reviewer`, `code-reviewer`, `security-reviewer` (injection boundary). Then mentor sign-off on the public contract → `/open-pr`.

## Out of scope (deliberate)

npm publishing (`private: true`); Shadow-DOM isolation (documented escape hatch); per-framework component mimicry; a `.dark` theme for the reference app; any backend/API/domain-logic change.

## Self-Review

- **Spec coverage:** scaffold+primitives+tokens+styling → Unit A; transport → Unit B; state factories + provider + inject + harness → Unit C; components move+rewire → Unit D; admin+forms+NotificationAdmin+exports → Unit E; reference rewiring+ivory theme+deletions → Unit F; whole-repo+e2e+reviews → Unit G. Injection contract (`NotificationConfig`), no-Pinia, no-preflight/`--nt-*` tokens, identity-injected-not-derived, e2e-unchanged, mentor gate — all present. No gaps.
- **Placeholder scan:** the mechanical moves use exact `git mv` + `sed` rewrite rules and per-file hand-fix notes; new infra (package.json, transport, provider, context, styling, harness) carries full code. The few "reconcile against the real factory/return shape" notes are inherent to a move (the source exists in-repo) and are bounded to reading a named file — not open-ended TODOs.
- **Type consistency:** `Transport`/`SseFactory`/`NotificationConfig`/`NotificationsContext`/`NOTIFICATIONS_KEY`/`useFeed…`/`createXState(deps)`/`createCookieTransport`/`connectSse(baseUrl,opts)`/`createAdminApi(transport)` are named identically across defining and consuming tasks. Provider build order (leaf→coordinator) matches the factory dep signatures. `NotificationPanel` is the public alias of `NotificationPopover`.
