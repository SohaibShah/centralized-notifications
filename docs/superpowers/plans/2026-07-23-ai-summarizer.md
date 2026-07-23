# AI Summarizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the notification panel's canned AI-summary disclosure into a real, factor-aware triage digest produced by a local LLM, wired through the BE library's injectable provider seam.

**Architecture:** Add an `AiProvider.complete(messages)` transport seam to `@notifications/core`; core owns the summary prompt and `service.summarize({ principal })` over the audience-scoped unread set (gating, signature cache, rate limit). `@notifications/server-fastify` mounts `GET /notifications/summary`. The reference app injects an OpenAI-compatible HTTP provider pointed at local Ollama (`qwen2.5:7b`), selectable to a fake in the test lane. The frontend disclosure fetches lazily on expand.

**Tech Stack:** TypeScript (strict, ESM), `@notifications/core`/`server-fastify`, Fastify 5, node-pg, zod, Vue 3 + Pinia, Vitest, Playwright, Ollama (OpenAI-compatible `/v1`).

## Global Constraints

- TS strict; `pnpm lint` + `pnpm typecheck` + `pnpm -r build` clean before a task is "done".
- New logic carries a Vitest test in the same task; failure paths tested, not just happy path.
- Parameterized SQL only. **`packages/core` reads no `process.env` and references no identity table** — the existing `packages/core/test/boundary.test.ts` must stay green.
- **No secret in code.** Provider config (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`) comes from env, shape-validated at startup in `backend/src/config/env.ts`. `AI_API_KEY` is never logged or returned to the browser.
- **PII:** never log the summary context or the model output in full (`notifications-domain.md`, `security.md`).
- Provider selection is **real Ollama by default**; the fake provider is used **only** when `AI_PROVIDER=fake`.
- Cap the unread set at **25**; per-recipient rate limit **6/min**; provider request timeout **30 s**; description truncation **280 chars**; `temperature 0.3`, `maxTokens 300`.
- No AI-attribution commit trailers. Conventional Commits.
- **Mentor sanity-check on the new `/notifications/summary` endpoint + the `AiProvider` interface before merge.**

---

## File Structure

**`packages/core/`**

- `src/types.ts` (modify) — add `AiMessage`, `AiProvider`; add `ai?: { provider: AiProvider }` to `NotificationServiceConfig`.
- `src/ai/prompt.ts` (create) — `buildSummaryMessages(ctx)`; the core-owned triage prompt.
- `src/ai/summarize.ts` (create) — `SummaryContext`/`SummaryItem` types, `buildSummaryContext(query, principal, cap)`, and the `SummaryEngine` class (cache + rate limit + gating + provider call).
- `src/service.ts` (modify) — add the AI error classes + `summarize` to `NotificationService`; wire a `SummaryEngine`.
- `src/index.ts` (modify) — export `AiProvider`, `AiMessage`, and the AI error classes.
- `test/summarize.test.ts`, `test/prompt.test.ts` (create).

**`packages/server-fastify/`**

- `src/routes/summary.ts` (create) — `GET /notifications/summary`.
- `src/index.ts` (modify) — register it.
- `test/summary.route.test.ts` (create).

**`backend/` (reference app)**

- `src/config/env.ts` (modify) — `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`.
- `src/reference/ai/openai-provider.ts` (create) — OpenAI-compatible HTTP `AiProvider`.
- `src/reference/ai/fake-provider.ts` (create) — the test-lane fake.
- `src/reference/service.ts` (modify) — build + inject the provider (real/fake by env).
- `test/ai-provider.test.ts` (create).

**`frontend/`**

- `src/stores/summary.ts` (create) — `fetchSummary` + states.
- `src/features/notifications/panel/InboxTab.vue` (modify) — wire the disclosure.
- `src/stores/summary.spec.ts`, `src/features/notifications/panel/InboxTab.spec.ts` (create/modify).
- `e2e/ai-summary.spec.ts` (create).

**Docs:** `docs/api/notifications.md` (docs-writer), root `README.md` Build & run (Ollama).

---

## Unit A — Core: seam + summarize

### Task 1: The `AiProvider` seam types + config

**Files:**

- Modify: `packages/core/src/types.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/ai-types.test.ts`

**Interfaces:**

- Produces:
  - `interface AiMessage { role: "system" | "user" | "assistant"; content: string }`
  - `interface AiProvider { complete(messages: AiMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> }`
  - `NotificationServiceConfig` gains `ai?: { provider: AiProvider }`.

- [ ] **Step 1: Write the failing test** `packages/core/test/ai-types.test.ts`

```ts
import { expect, test } from "vitest";
import type { AiProvider, NotificationServiceConfig } from "../src/index";

test("NotificationServiceConfig accepts an ai provider", () => {
  const provider: AiProvider = { complete: async () => "ok" };
  const config: NotificationServiceConfig = { modules: [], ai: { provider } };
  expect(config.ai?.provider).toBe(provider);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notifications/core test ai-types`
Expected: FAIL — `AiProvider` not exported / `ai` not on the config type.

- [ ] **Step 3: Implement** — in `types.ts`, add above `NotificationServiceConfig`:

```ts
/** One chat message in the OpenAI-compatible shape. */
export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * A raw model transport the host injects. Core owns the domain prompts (summary now, Q/A later) and
 * only asks the provider to turn messages into a completion — so a host brings a model endpoint, not
 * prompt logic. OpenAI-compatible on purpose: local Ollama, a cloud API, or a scaled cluster all fit.
 */
export interface AiProvider {
  complete(
    messages: AiMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
}
```

Replace the reserved comment line in `NotificationServiceConfig` with:

```ts
  /** Optional AI transport. When absent, AI features (summarize) report "not configured". */
  ai?: { provider: AiProvider };
```

In `index.ts`, add to the `types` export block: `AiMessage, AiProvider`.

- [ ] **Step 4: Run the test to verify it passes** — Run: `pnpm --filter @notifications/core test ai-types` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): AiProvider transport seam + config.ai slot`

### Task 2: Build the summary context from the audience-scoped unread set

**Files:**

- Create: `packages/core/src/ai/summarize.ts` (context piece only this task), `packages/core/test/summary-context.test.ts`

**Interfaces:**

- Consumes: `QueryFn` (`../db`), `Principal` (`../types`), `audienceWhere` (`../audience/match`), `counts` (`../read/counts`).
- Produces:
  - `interface SummaryItem { title: string; description: string; priority: NotificationPriority; module: string; category?: string; ageMinutes: number; hasActions: boolean }`
  - `interface SummaryContext { items: SummaryItem[]; totalUnread: number; now: string }`
  - `buildSummaryContext(query: QueryFn, principal: Principal, cap: number): Promise<{ context: SummaryContext; ids: string[] }>`

- [ ] **Step 1: Write the failing test** `packages/core/test/summary-context.test.ts` — using the core test harness (`testPool` + `createDb`) and `persist`: seed 2 unread global notifications (one critical, one normal) for a fresh principal + 1 read one; assert `buildSummaryContext(query, principal, 25)` returns `context.items` critical-first, each carrying `title`/`priority`/`module`/`ageMinutes` (a number ≥ 0)/`hasActions`, `context.totalUnread` ≥ 2, and `ids.length === context.items.length`. (Mirror the setup in `test/read.test.ts`.)

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/core test summary-context` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `packages/core/src/ai/summarize.ts` (context portion):

```ts
import type { NotificationPriority } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";
import { counts } from "../read/counts";

export interface SummaryItem {
  title: string;
  description: string; // truncated to 280 chars
  priority: NotificationPriority;
  module: string;
  category?: string;
  ageMinutes: number;
  hasActions: boolean;
}
export interface SummaryContext {
  items: SummaryItem[];
  totalUnread: number;
  now: string; // ISO reference time for staleness reasoning
}

interface Row {
  id: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  module: string;
  category: string | null;
  actions: unknown[] | null;
  created_at: Date;
}

/** The principal's audience-scoped UNREAD set, capped, critical-first then oldest, shaped for the
 *  prompt. Also returns the ordered ids (for the cache signature). No identity-table join. */
export async function buildSummaryContext(
  query: QueryFn,
  principal: Principal,
  cap: number,
): Promise<{ context: SummaryContext; ids: string[] }> {
  const params: unknown[] = [principal.userKey];
  const audience = audienceWhere(principal, params);
  params.push(cap);
  const { rows } = await query<Row>(
    `SELECT n.id, n.title, n.description, n.priority, n.module, n.category, n.actions, n.created_at
       FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_key = $1
      WHERE n.suppressed = false AND r.user_key IS NULL AND ${audience}
      ORDER BY n.priority_rank ASC, n.created_at ASC
      LIMIT $${params.length}`,
    params,
  );

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const items: SummaryItem[] = rows.map((r) => ({
    title: r.title,
    description: r.description.slice(0, 280),
    priority: r.priority,
    module: r.module,
    ...(r.category != null ? { category: r.category } : {}),
    ageMinutes: Math.max(0, Math.floor((nowMs - r.created_at.getTime()) / 60000)),
    hasActions: Array.isArray(r.actions) && r.actions.length > 0,
  }));
  const totalUnread = (await counts(query, { principal })).unread;
  return { context: { items, totalUnread, now }, ids: rows.map((r) => r.id) };
}
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): build audience-scoped summary context`

### Task 3: The core-owned triage prompt

**Files:**

- Create: `packages/core/src/ai/prompt.ts`, `packages/core/test/prompt.test.ts`

**Interfaces:**

- Consumes: `AiMessage` (`../types`), `SummaryContext` (`./summarize`).
- Produces: `buildSummaryMessages(ctx: SummaryContext): AiMessage[]`.

- [ ] **Step 1: Write the failing test** `packages/core/test/prompt.test.ts`

```ts
import { expect, test } from "vitest";
import { buildSummaryMessages } from "../src/ai/prompt";

test("system prompt names the factors; user message carries the items + total", () => {
  const msgs = buildSummaryMessages({
    now: new Date().toISOString(),
    totalUnread: 3,
    items: [
      {
        title: "Acme DSAR overdue",
        description: "d",
        priority: "critical",
        module: "dsr",
        ageMinutes: 4000,
        hasActions: true,
      },
      {
        title: "New tracker finding",
        description: "d",
        priority: "high",
        module: "data-mapping",
        ageMinutes: 30,
        hasActions: false,
      },
    ],
  });
  const system = msgs.find((m) => m.role === "system")!.content.toLowerCase();
  expect(system).toContain("cluster");
  expect(system).toContain("start"); // "start here" ordering
  const user = msgs.find((m) => m.role === "user")!.content;
  expect(user).toContain("Acme DSAR overdue");
  expect(user).toContain("3"); // total unread
});
```

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** `packages/core/src/ai/prompt.ts`:

```ts
import type { AiMessage } from "../types";
import type { SummaryContext } from "./summarize";

const SYSTEM = [
  "You are a triage assistant for a security & privacy operations notification inbox.",
  "Summarize the user's UNREAD notifications in 2-4 sentences of plain prose (no markdown headers, no lists).",
  "Weigh three things: clusters of related items (same module or category), staleness (older high-priority items still unactioned), and finish with a concrete 'start here' recommendation of what to tackle first and why.",
  "Reference actual items by their titles. Never invent details that are not in the list. Be concise and specific.",
].join(" ");

/** Build the chat messages for a summary. Core owns this prompt so every host gets the same tuned
 *  triage behavior and only injects a model transport. */
export function buildSummaryMessages(ctx: SummaryContext): AiMessage[] {
  const lines = ctx.items.map((i) => {
    const age =
      i.ageMinutes >= 1440
        ? `${Math.floor(i.ageMinutes / 1440)}d`
        : `${Math.floor(i.ageMinutes / 60)}h`;
    const cat = i.category ? `, ${i.category}` : "";
    return `- [${i.priority}] (${i.module}${cat}, ${age} old${i.hasActions ? ", has actions" : ""}): ${i.title} — ${i.description}`;
  });
  const user = [
    `Unread: ${ctx.totalUnread} total (showing ${ctx.items.length}). Reference time: ${ctx.now}.`,
    "",
    ...lines,
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): core-owned triage summary prompt`

### Task 4: `SummaryEngine` + `service.summarize`

**Files:**

- Modify: `packages/core/src/ai/summarize.ts` (add the engine), `packages/core/src/service.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/summarize.test.ts`

**Interfaces:**

- Consumes: `buildSummaryContext`, `buildSummaryMessages`, `AiProvider`, `Settings`.
- Produces (in `service.ts`): error classes `AiDisabledError`, `AiNotConfiguredError`, `AiRateLimitError`, `AiProviderError`; `NotificationService.summarize(args: { principal: Principal }): Promise<{ summary: string; basedOn: number }>`.
- Produces (in `summarize.ts`): `class SummaryEngine` constructed with `{ query: QueryFn; getSettings: () => Promise<Settings>; provider?: AiProvider }`, method `summarize(principal: Principal): Promise<{ summary: string; basedOn: number }>`.

Behavior order (matters): disabled → not-configured → build context → empty ⇒ "You're all caught up." (no provider call) → signature → cache hit ⇒ return → rate-limit (miss path only) → provider.complete → cache + return; provider throw ⇒ `AiProviderError`.

- [ ] **Step 1: Write the failing test** `packages/core/test/summarize.test.ts` — construct a `SummaryEngine` with the test pool, a `getSettings` returning `{ aiSummaryEnabled: true, … }`, and a `vi.fn()` provider. Assert:
  1. `aiSummaryEnabled: false` ⇒ rejects `AiDisabledError`, provider not called.
  2. no provider ⇒ rejects `AiNotConfiguredError`.
  3. a principal with **no unread** ⇒ resolves `{ summary: "You're all caught up.", basedOn: 0 }`, provider **not called**.
  4. with unread ⇒ resolves the provider's string; a second call on the **unchanged** set does **not** call the provider again (cache hit).
  5. a provider that throws ⇒ rejects `AiProviderError`.
     (Seed via `persist`; use unique userKeys per case.)

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** — append to `summarize.ts`:

```ts
import { createHash } from "node:crypto";
import type { AiProvider, Settings } from "../types";
import { buildSummaryMessages } from "./prompt";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
} from "../service";

const CAP = 25;
const RATE_LIMIT = 6; // provider calls per recipient per minute

export class SummaryEngine {
  private readonly cache = new Map<
    string,
    { signature: string; summary: string; basedOn: number }
  >();
  private readonly calls = new Map<string, number[]>();
  constructor(
    private readonly deps: {
      query: QueryFn;
      getSettings: () => Promise<Settings>;
      provider?: AiProvider;
    },
  ) {}

  async summarize(principal: Principal): Promise<{ summary: string; basedOn: number }> {
    if (!(await this.deps.getSettings()).aiSummaryEnabled) throw new AiDisabledError();
    if (!this.deps.provider) throw new AiNotConfiguredError();

    const { context, ids } = await buildSummaryContext(this.deps.query, principal, CAP);
    if (context.items.length === 0) return { summary: "You're all caught up.", basedOn: 0 };

    const signature = createHash("sha256").update(ids.join("|")).digest("hex");
    const cached = this.cache.get(principal.userKey);
    if (cached && cached.signature === signature) {
      return { summary: cached.summary, basedOn: cached.basedOn };
    }

    this.checkRate(principal.userKey);
    let text: string;
    try {
      text = await this.deps.provider.complete(buildSummaryMessages(context), {
        maxTokens: 300,
        temperature: 0.3,
      });
    } catch (err) {
      throw new AiProviderError((err as Error).message);
    }
    const result = { summary: text.trim(), basedOn: context.items.length };
    this.cache.set(principal.userKey, { signature, ...result });
    return result;
  }

  private checkRate(userKey: string): void {
    const now = Date.now();
    const recent = (this.calls.get(userKey) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= RATE_LIMIT) throw new AiRateLimitError();
    recent.push(now);
    this.calls.set(userKey, recent);
  }
}
```

Add the error classes to `service.ts` (next to `InvalidCursorError`):

```ts
export class AiDisabledError extends Error {
  constructor() {
    super("ai summary disabled");
    this.name = "AiDisabledError";
  }
}
export class AiNotConfiguredError extends Error {
  constructor() {
    super("ai not configured");
    this.name = "AiNotConfiguredError";
  }
}
export class AiRateLimitError extends Error {
  constructor() {
    super("ai rate limit");
    this.name = "AiRateLimitError";
  }
}
export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}
```

Wire the engine in `createNotificationService` (after `policy`):

```ts
import { SummaryEngine } from "./ai/summarize";
// …
const summaryEngine = new SummaryEngine({
  query,
  getSettings: () => policy.getSettings(),
  provider: opts.config.ai?.provider,
});
```

Add to the returned object + the `NotificationService` interface:

```ts
summarize: (args) => summaryEngine.summarize(args.principal),
// interface: summarize(args: { principal: Principal }): Promise<{ summary: string; basedOn: number }>;
```

Export from `index.ts`: `AiDisabledError, AiNotConfiguredError, AiRateLimitError, AiProviderError` (and the `NotificationService` change flows automatically).

**Note (import cycle):** `summarize.ts` imports the error classes from `service.ts`, and `service.ts` imports `SummaryEngine` from `summarize.ts`. These are separate symbols and TS/ESM handle the cycle for classes used at call-time; if the runtime cycle bites, move the four error classes into `summarize.ts` and re-export them from `service.ts`.

- [ ] **Step 4: Run the test to verify it passes** — Run: `pnpm --filter @notifications/core test summarize` — Expected: PASS.

- [ ] **Step 5: Full core gate + commit**

Run: `pnpm --filter @notifications/core test && pnpm --filter @notifications/core typecheck && pnpm --filter @notifications/core build`
Expected: green (incl. `boundary.test.ts` — no env/identity refs added). Commit — `feat(core): service.summarize with gating, signature cache, rate limit`

---

## Unit B — Plugin route

### Task 5: `GET /notifications/summary`

**Files:**

- Create: `packages/server-fastify/src/routes/summary.ts`, `packages/server-fastify/test/summary.route.test.ts`
- Modify: `packages/server-fastify/src/index.ts`

**Interfaces:**

- Consumes: `NotificationService`, `requirePrincipal`, and the four AI error classes from `@notifications/core`.
- Produces: `notificationSummaryRoute(app, { service, requirePrincipal })` mounting `GET /notifications/summary`.

Error mapping: `AiDisabledError` → 404 `{ error: "ai summary disabled" }`; `AiNotConfiguredError` → 501; `AiRateLimitError` → 429; `AiProviderError` → 502.

- [ ] **Step 1: Write the failing test** `packages/server-fastify/test/summary.route.test.ts` — register the plugin with a real service (test pool + a fake provider returning `"FAKE SUMMARY"`) + the header `fakeAuth`. Assert: authed principal with unread ⇒ 200 `{ summary }`; missing auth ⇒ 401; with `aiSummaryEnabled` toggled false (via `service.updateSettings`) ⇒ 404 (restore after); a service built with **no** `ai` provider ⇒ 501; a provider that throws ⇒ 502. (Model the setup on `foreign-host.test.ts`.)

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** `packages/server-fastify/src/routes/summary.ts`:

```ts
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
  type NotificationService,
} from "@notifications/core";

export function notificationSummaryRoute(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;
  app.get("/notifications/summary", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    try {
      return reply.code(200).send(await service.summarize({ principal }));
    } catch (err) {
      if (err instanceof AiDisabledError)
        return reply.code(404).send({ error: "ai summary disabled" });
      if (err instanceof AiNotConfiguredError)
        return reply.code(501).send({ error: "ai not configured" });
      if (err instanceof AiRateLimitError) return reply.code(429).send({ error: "rate limited" });
      if (err instanceof AiProviderError)
        return reply.code(502).send({ error: "summary unavailable" });
      throw err;
    }
  });
}
```

Register in `index.ts` (after the SSE route): import and call `notificationSummaryRoute(app, { service: opts.service, requirePrincipal });`.

- [ ] **Step 4: Run the test to verify it passes** — Run: `pnpm --filter @notifications/server-fastify test summary.route` — Expected: PASS.

- [ ] **Step 5: Plugin gate + commit**

Run: `pnpm --filter @notifications/server-fastify test && pnpm --filter @notifications/server-fastify typecheck && pnpm --filter @notifications/server-fastify build`
Commit — `feat(server-fastify): GET /notifications/summary route`

---

## Unit C — Reference provider

### Task 6: Provider env config

**Files:**

- Modify: `backend/src/config/env.ts`
- Test: `backend/test/env.test.ts` (add cases)

**Interfaces:**

- Produces on `Env`: `AI_PROVIDER: "real" | "fake"` (default `"real"`), `AI_BASE_URL: string` (default `http://localhost:11434/v1`), `AI_MODEL: string` (default `qwen2.5:7b`), `AI_API_KEY?: string`.

- [ ] **Step 1: Write the failing test** — add to `backend/test/env.test.ts`: with the base env, `loadEnv(base).AI_PROVIDER === "real"`, `AI_BASE_URL === "http://localhost:11434/v1"`, `AI_MODEL === "qwen2.5:7b"`; and `loadEnv({ ...base, AI_PROVIDER: "fake" }).AI_PROVIDER === "fake"`.

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** — add to `envSchema` in `env.ts`:

```ts
  // AI summarizer provider. Real Ollama by default; `fake` selects the deterministic test-lane
  // provider. No secret is required for local Ollama; AI_API_KEY is only for a cloud/scaled endpoint
  // and is never logged.
  AI_PROVIDER: z.enum(["real", "fake"]).default("real"),
  AI_BASE_URL: z.string().url().default("http://localhost:11434/v1"),
  AI_MODEL: z.string().min(1).default("qwen2.5:7b"),
  AI_API_KEY: z.string().min(1).optional(),
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(backend): AI provider env config (startup-validated)`

### Task 7: OpenAI-compatible provider + fake

**Files:**

- Create: `backend/src/reference/ai/openai-provider.ts`, `backend/src/reference/ai/fake-provider.ts`, `backend/test/ai-provider.test.ts`

**Interfaces:**

- Consumes: `AiProvider`, `AiMessage` (`@notifications/core`).
- Produces:
  - `createOpenAiProvider(cfg: { baseUrl: string; model: string; apiKey?: string; timeoutMs?: number }): AiProvider`
  - `createFakeProvider(): AiProvider`

- [ ] **Step 1: Write the failing test** `backend/test/ai-provider.test.ts` — `createFakeProvider().complete([...])` resolves a non-empty string. For `createOpenAiProvider`, stub `global.fetch` with a `vi.fn()` returning `{ ok: true, json: async () => ({ choices: [{ message: { content: "hi" } }] }) }`; assert `complete` returns `"hi"` and that fetch was called with a URL ending `/chat/completions` and a body containing the model; then a `{ ok: false, status: 502 }` response ⇒ `complete` rejects. Restore `fetch` after.

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** `openai-provider.ts`:

```ts
import type { AiMessage, AiProvider } from "@notifications/core";

/** An OpenAI-compatible chat-completions transport. Points at local Ollama's /v1 by default; the same
 *  adapter targets a cloud/scaled endpoint by changing baseUrl (+ apiKey). Never logs prompt/output. */
export function createOpenAiProvider(cfg: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}): AiProvider {
  return {
    async complete(messages: AiMessage[], opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);
      try {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            max_tokens: opts?.maxTokens ?? 300,
            temperature: opts?.temperature ?? 0.3,
            stream: false,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("AI provider returned no content");
        return content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
```

`fake-provider.ts`:

```ts
import type { AiProvider } from "@notifications/core";

/** Deterministic offline provider for the test lane (AI_PROVIDER=fake). NOT a product path. */
export function createFakeProvider(): AiProvider {
  return {
    complete: async () =>
      "A few notifications need attention. Start with the highest-priority unactioned item.",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(backend): OpenAI-compatible + fake AiProvider adapters`

### Task 8: Inject the provider into the reference service

**Files:**

- Modify: `backend/src/reference/service.ts`
- Test: `backend/test/ai-provider.test.ts` (add a selection case) or a small `reference-service.test.ts`

**Interfaces:**

- Consumes: `createOpenAiProvider`, `createFakeProvider`, `getEnv`.
- Produces: `createReferenceService()` injects `config.ai = { provider }`, real by default, fake when `AI_PROVIDER=fake`.

- [ ] **Step 1: Write the failing test** — a unit test for a small exported helper `buildAiProvider()`: with `AI_PROVIDER=fake` in a `loadEnv` source it returns a provider whose `complete` resolves the fake string; document that `real` returns the OpenAI adapter (assert it's an object with a `complete` fn — don't call it, no network).

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** `service.ts`:

```ts
import {
  createNotificationService,
  type AiProvider,
  type NotificationService,
} from "@notifications/core";
import { getEnv } from "../config/env";
import { getPool } from "../db/pool";
import { REFERENCE_CATALOG } from "./catalog";
import { createFakeProvider } from "./ai/fake-provider";
import { createOpenAiProvider } from "./ai/openai-provider";

/** Real Ollama provider by default; the fake only when AI_PROVIDER=fake (test lane). */
export function buildAiProvider(): AiProvider {
  const env = getEnv();
  if (env.AI_PROVIDER === "fake") return createFakeProvider();
  return createOpenAiProvider({
    baseUrl: env.AI_BASE_URL,
    model: env.AI_MODEL,
    apiKey: env.AI_API_KEY,
  });
}

export function createReferenceService(): NotificationService {
  return createNotificationService({
    pool: getPool(),
    config: { modules: REFERENCE_CATALOG, adminRole: "admin", ai: { provider: buildAiProvider() } },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Backend gate + commit**

Run: `pnpm --filter @notifications/backend test && pnpm --filter @notifications/backend typecheck`
Commit — `feat(backend): inject Ai provider into the reference service (real/fake by env)`

---

## Unit D — Frontend

### Task 9: Summary store

**Files:**

- Create: `frontend/src/stores/summary.ts`, `frontend/src/stores/summary.spec.ts`

**Interfaces:**

- Consumes: `api` (`@/api/client`), `ApiError`.
- Produces: `useSummaryStore` with `status: "idle"|"loading"|"ready"|"error"`, `text: string`, `error: string | null`, `fetchSummary(force?: boolean): Promise<void>`, `reset(): void`.

- [ ] **Step 1: Write the failing test** `frontend/src/stores/summary.spec.ts` — with a mocked `api.get`: resolving `{ summary: "S", basedOn: 2 }` ⇒ after `fetchSummary()`, `status === "ready"`, `text === "S"`; a second `fetchSummary()` (not forced) does **not** call `api.get` again; `fetchSummary(true)` does; `api.get` rejecting an `ApiError(502, "summary unavailable")` ⇒ `status === "error"`, `error` set. (Mirror `stores/settings.spec.ts` mocking style.)

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/frontend test summary` — Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/stores/summary.ts`:

```ts
import { ref } from "vue";
import { defineStore } from "pinia";
import { api, ApiError } from "@/api/client";

interface SummaryResponse {
  summary: string;
  basedOn: number;
}

/** The AI triage summary for the current user's unread set. Fetched lazily on first disclosure
 *  expand; the server caches by the unread signature, so re-fetches are cheap. */
export const useSummaryStore = defineStore("summary", () => {
  const status = ref<"idle" | "loading" | "ready" | "error">("idle");
  const text = ref("");
  const error = ref<string | null>(null);

  async function fetchSummary(force = false): Promise<void> {
    if (!force && (status.value === "loading" || status.value === "ready")) return;
    status.value = "loading";
    error.value = null;
    try {
      const res = await api.get<SummaryResponse>("/notifications/summary");
      text.value = res.summary;
      status.value = "ready";
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "Couldn't generate a summary";
      status.value = "error";
    }
  }

  function reset(): void {
    status.value = "idle";
    text.value = "";
    error.value = null;
  }

  return { status, text, error, fetchSummary, reset };
});
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(frontend): summary store (lazy fetch + states)`

### Task 10: Wire the InboxTab disclosure

**Files:**

- Modify: `frontend/src/features/notifications/panel/InboxTab.vue`
- Test: `frontend/src/features/notifications/panel/InboxTab.spec.ts` (create or extend)

**Interfaces:**

- Consumes: `useSummaryStore`.

- [ ] **Step 1: Write the failing test** `InboxTab.spec.ts` — mount `InboxTab` with a Pinia test setup (stub the feed store); with the settings flag on, expanding the disclosure (click the AI-summary button) calls `summary.fetchSummary`; when the summary store is `ready` with text, the body shows the text and the "Sample" badge is absent; when `error`, a "Retry" control is present. (Use `@vue/test-utils` + a mocked summary store, mirroring existing panel specs.)

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** — in `InboxTab.vue`:
  - Import + instantiate: `import { useSummaryStore } from "@/stores/summary"; const summary = useSummaryStore();`.
  - In `toggleSummary`, after toggling open, trigger a lazy fetch:

    ```ts
    function toggleSummary(): void {
      aiOpen.value = !aiOpen.value;
      bloomCount.value++;
      if (aiOpen.value && summary.status === "idle") void summary.fetchSummary();
    }
    ```

  - Remove the static "Sample" badge span.
  - Replace the canned `<p>…</p>` detail body (the "2 need action today…" paragraph) with state-driven content inside `v-if="aiOpen"`:

    ```html
    <div
      v-if="aiOpen"
      id="ai-summary-detail"
      class="relative z-10 px-3 pb-2.5 text-[12px] leading-relaxed text-muted"
    >
      <Skeleton v-if="summary.status === 'loading'" class="h-4 w-3/4" />
      <p v-else-if="summary.status === 'ready'">{{ summary.text }}</p>
      <p v-else-if="summary.status === 'error'" class="text-danger-ink">
        Couldn't generate a summary — is the local model running?
        <button type="button" class="underline" @click="summary.fetchSummary(true)">Retry</button>
      </p>
    </div>
    ```

  (`Skeleton` is already imported in this file.)

- [ ] **Step 4: Run the test + verify** — Run: `pnpm --filter @notifications/frontend test InboxTab && pnpm --filter @notifications/frontend typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(frontend): wire AI-summary disclosure to the summary endpoint`

---

## Unit E — e2e, docs, verification

### Task 11: e2e (deterministic, provider-agnostic)

**Files:**

- Create: `frontend/e2e/ai-summary.spec.ts`

- [ ] **Step 1: Write the test** — log in (reuse the `login` helper pattern), open the bell, publish one `dsr` global notification via `/internal/publish` (so the set is non-empty), expand the AI-summary disclosure, and assert it **resolves out of loading** within 20 s — i.e. the detail region shows either summary text or the graceful error (never stuck on the skeleton). This passes with the fake provider, a live Ollama, or Ollama down (→ graceful error), so it needs no model. (The CI lane may set `AI_PROVIDER=fake` for a deterministic body, but the assertion does not depend on it.)

```ts
// Assert: aiOpen detail is present AND does not still contain only the skeleton after settle.
// Prefer asserting the detail text is non-empty OR the Retry button is visible.
```

- [ ] **Step 2: Run it** — Run: `pnpm test:e2e ai-summary` (dev server up) — Expected: PASS. Note the login-rate-limit caveat (single clean run).

- [ ] **Step 3: Commit** — `test(e2e): AI-summary disclosure resolves (provider-agnostic)`

### Task 12: Docs + README + final verification

**Files:**

- Update via **docs-writer**: `docs/api/notifications.md` — add `GET /notifications/summary` (auth, response `{ summary, basedOn }`, the 404/501/429/502 semantics, and that it summarizes the caller's audience-scoped unread set via the injected `AiProvider`).
- Modify: root `README.md` Build & run — add the Ollama prerequisite.

- [ ] **Step 1: Dispatch docs-writer** for `docs/api/notifications.md` with the endpoint contract above. Do not hand-write it.

- [ ] **Step 2: Update `README.md`** Build & run with:

```
- AI summary (optional, for the live model): install Ollama (`brew install ollama`) and
  `ollama pull qwen2.5:7b`. Without it the app + tests still run; the summary shows a graceful
  "is the local model running?" state. Tests use a fake provider (`AI_PROVIDER=fake`).
```

- [ ] **Step 3: Whole-repo verification**

Run: `pnpm -r test && pnpm typecheck && pnpm lint && pnpm -r build`
Expected: green — core (incl. boundary), server-fastify, backend, frontend. Then `pnpm test:e2e` (single clean run).

- [ ] **Step 4: Manual model check** — `ollama pull qwen2.5:7b`, `pnpm dev`, expand the disclosure → a real digest. Confirm via `browser-tester`.

- [ ] **Step 5: Commit** — `docs: document GET /notifications/summary + Ollama prerequisite`

---

## Verification (whole-branch, before finishing)

1. `pnpm -r test` — core / server-fastify / backend / frontend green, including the new AI tests and the unchanged boundary test.
2. `pnpm typecheck && pnpm lint && pnpm -r build` — clean; core still emits no env/identity coupling.
3. `pnpm test:e2e` — AI-summary spec resolves; existing 8 specs still pass.
4. Manual: `pnpm dev` + Ollama + `qwen2.5:7b` → a real factor-aware digest on expand (`browser-tester`).
5. Reviews: `code-reviewer` (whole branch), then `security-reviewer` (the new endpoint + provider egress + env/secret handling — titles/descriptions leave the process to the model). Then `/code-review` → mentor sign-off on the endpoint + `AiProvider` shape → `/open-pr`.

## Out of scope (deliberate)

AI Q/A (step 4 — reuses the same `AiProvider.complete`); streaming the summary; a `dueAt` contract field; cross-instance cache invalidation (single-instance assumption, documented seam).

## Self-Review

- **Spec coverage:** seam → Task 1; context (enriched, cap 25, factors data) → Task 2; core-owned prompt → Task 3; gating/empty/cache/rate-limit/provider-error → Task 4; endpoint + 404/501/429/502 → Task 5; env config → Task 6; OpenAI-compatible + fake providers → Task 7; real-default/fake-lane selection → Task 8; frontend store + disclosure (drop Sample, states, retry) → Tasks 9-10; e2e (provider-agnostic) → Task 11; docs + README Ollama → Task 12. PII (no full logging) is honored — neither the provider adapters nor the engine log context/output. No env/identity added to core. No gaps.
- **Placeholder scan:** every code step carries real code; the docs step delegates to docs-writer with the exact contract.
- **Type consistency:** `AiProvider.complete(messages, opts)`, `AiMessage`, `SummaryContext`/`SummaryItem`, `buildSummaryContext`, `buildSummaryMessages`, `SummaryEngine`, the four `Ai*Error` classes, and `summarize({ principal }) → { summary, basedOn }` are named identically across the tasks that define and consume them. The one risk (error-class import cycle between `service.ts` and `summarize.ts`) is called out in Task 4 with the fix.
