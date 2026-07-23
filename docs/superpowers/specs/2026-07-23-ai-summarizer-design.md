# AI summarizer for notifications — design

**Date:** 2026-07-23
**Branch:** `feat/ai-summarizer` (off `main`, which now has the BE library)
**Status:** approved (design converged in discussion); **new endpoint + `ai` config are public-API additions — smaller mentor sanity-check before merge**

## Goal

Turn the notification panel's **AI-summary disclosure** from a canned stub into a real, factor-aware
triage digest of the user's audience-scoped unread notifications, produced by a **local LLM** wired
through the BE library's injectable provider seam. This is sequence step **2 of 4** (BE lib →
**summarizer** → UI lib → Q/A), and it is the _first real consumer_ of the just-shipped
`@notifications/core` + `@notifications/server-fastify` — validating the library's extension points and
introducing the LLM-provider seam that the Q/A feature will reuse.

## Locked decisions

- **Real local model, no stub.** The running app uses an actual model; only the automated tests
  inject a fake provider (a test double — standard DI, not a product stub).
- **Serving: Ollama + an OpenAI-compatible adapter.** The reference provider talks
  OpenAI-compatible `/v1/chat/completions` to a local Ollama service. This mirrors the production
  "app → inference tier over HTTP" pattern, so local → cloud → scaled cluster is a base-URL/key swap.
  The **library seam stays serving-agnostic** — a host injects any provider.
- **Model: `qwen2.5:7b`** (~4.7 GB Q4, comfortable on a 16 GB M2 Air). Chosen for the _harder_ reuse
  case (Q/A grounding), serves summarization well too. Swappable via config.
- **Seam is a raw transport** — `AiProvider.complete(messages)`; **core owns the domain prompt.** Any
  host adopting the libraries gets the tuned triage prompt for free and only injects a model
  transport. Extends to Q/A with the same `complete()`.
- **Factors weighed:** patterns/clusters, staleness/age, and a recommended "start here" ordering.
  Deadlines/`dueAt` are **de-emphasized and out of scope** (no contract change this pass).
- **Compute: lazy on first expand, cached by the unread-set signature.** Re-expands/reopens are free
  until the set changes.

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before a task is "done".
- New logic carries a Vitest test in the same task (`testing.md`); failure paths tested, not just the
  happy path (`notifications-domain.md`).
- Parameterized SQL only; core reads no `process.env`, references no identity table (unchanged
  library invariants — enforced by the existing boundary test, which must stay green).
- **No secret in code.** Provider config (base URL, model, optional key) comes from env, shape-
  validated at process startup. `AI_API_KEY` (if ever set) is never logged or sent to the browser.
- **PII discipline** (`notifications-domain.md` + `security.md`): the prompt necessarily sends
  notification titles/descriptions to the provider (that is the feature); the context and the model
  output are **never logged in full** — truncate/redact.
- No AI-attribution commit trailers. Conventional Commits.
- `docs/api/*` updated via **docs-writer** for the new endpoint.

## The seam (`@notifications/core`)

The reserved `ai?` slot in `NotificationServiceConfig` becomes real:

```ts
interface AiProvider {
  // Raw OpenAI-compatible transport: given chat messages, return the completion text.
  complete(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
}
interface NotificationServiceConfig {
  modules: ModuleCatalogEntry[];
  adminRole?: string;
  ai?: { provider: AiProvider }; // was a reserved comment; now built
}
```

Core owns the prompt; the provider is pure transport. The same `complete()` serves the Q/A `answer()`
method in step 4 — one seam, two features.

## Core `summarize` (`packages/core/src/ai/summarize.ts`)

```ts
service.summarize({ principal }): Promise<{ summary: string; basedOn: number }>
```

1. **Gate server-side.** `aiSummaryEnabled === false` → `AiDisabledError` (route → 404). No
   `config.ai` provider → `AiNotConfiguredError` (route → 501). The UI flag is not the enforcement.
2. **Gather** the principal's audience-scoped **unread** set (reuse the existing read query + audience
   filter), **capped at 25**, critical-first then oldest, into the internal context:

   ```ts
   interface SummaryItem {
     title: string;
     description: string; // truncated ~280 chars
     priority: NotificationPriority;
     module: string;
     category?: string;
     ageMinutes: number;
     hasActions: boolean;
   }
   interface SummaryContext {
     items: SummaryItem[];
     totalUnread: number;
     now: string;
   }
   ```

3. **Empty set → return "You're all caught up."** directly, **no provider call**.
4. **Signature cache.** In-process `Map<userKey, { signature, summary, basedOn }>`;
   `signature = sha256(ordered unread ids)`. Hit → return cached (a new/read/removed notification
   changes the signature and invalidates naturally). Single-instance assumption, documented like the
   policy cache.
5. **Miss →** build messages (system: triage-assistant instructions weighing clusters, staleness, and
   a "start here" ordering; user: the formatted `items` + `totalUnread`) → `provider.complete(...)` →
   store → return. A **per-recipient rate limit** (e.g. ≤ 6/min) backstops rapid distinct-set churn.
6. **Provider failure** (timeout/refusal/Ollama down) propagates as an error the route maps to **502**.

Core builds the prompt; `SummaryContext` is internal (not the provider's input).

## Reference provider (`backend/src/reference/ai/`)

An OpenAI-compatible HTTP adapter implementing `AiProvider.complete` by POSTing to
`${AI_BASE_URL}/chat/completions` with `{ model, messages, ... }` and returning
`choices[0].message.content`.

- **Env config, shape-validated at startup** (extend `config/env.ts`): `AI_BASE_URL`
  (default `http://localhost:11434/v1`), `AI_MODEL` (default `qwen2.5:7b`), `AI_API_KEY` (optional;
  sent as `Authorization: Bearer` only when set — unused for local Ollama, present for a cloud swap).
- **Provider selection (default real):** `createReferenceService` injects the **real Ollama provider
  by default** — so `pnpm dev` and any non-test run give a live model experience. The **fake provider
  is selected only in the test lane**, via `AI_PROVIDER=fake` (set by the Vitest/Playwright configs);
  plain `pnpm dev` never sets it, so the developer always sees the real model. Ollama being _down_ is
  a **runtime** error (→ 502), never a boot failure — startup validates only config _shape_ (URL
  parses, model non-empty), not model availability.
- Timeouts: a bounded request timeout (e.g. 30 s) so a hung model doesn't wedge the request.
- **e2e determinism:** the AI-summary e2e runs its server lane with `AI_PROVIDER=fake` and asserts the
  wiring (expand → a summary _or_ the graceful error resolves, never stuck loading), so it never
  depends on Ollama; the real model is verified manually via `browser-tester`.

## Endpoint (`@notifications/server-fastify`)

`GET /notifications/summary`, `requirePrincipal`, → `service.summarize({ principal })` →
`{ summary, basedOn }`. Error mapping: `AiDisabledError` → 404, `AiNotConfiguredError` → 501,
provider error → 502.

## Frontend

Wire the existing disclosure in
`frontend/src/features/notifications/panel/InboxTab.vue` (currently canned + a "Sample" badge):

- On **first expand** (`aiOpen` false → true) and not yet loaded, call a new feed/AI store action
  `fetchSummary()` → `GET /notifications/summary`.
- States: **loading** (a shimmer line in the disclosure body), **loaded** (render `summary`, drop the
  "Sample" badge), **error** (inline "Couldn't generate a summary — is the local model running?" +
  a Retry).
- Client-cache the result keyed by the panel session; refetch when the feed's unread set changes
  (the server's signature cache makes a redundant call cheap anyway).
- Still gated by `settings.flags.aiSummaryEnabled` (the disclosure is hidden when the admin flag is
  off; the server enforces the same flag independently).

## Testing

- **Fake provider double** (`AiProvider` returning a fixed string) injected in unit + e2e — the real
  model never runs in CI.
- **Core** (`packages/core/test/summarize.test.ts`): disabled → `AiDisabledError`; no provider →
  `AiNotConfiguredError`; empty unread → "caught up" with **no provider call** (spy asserts zero
  calls); cache hit returns without a second provider call on an unchanged set; a new unread
  invalidates; provider throw propagates; the built messages contain the unread titles + counts.
- **server-fastify** (`test/summary.route.test.ts`): 200 + `{ summary }` for an authed principal with
  a fake provider; 404 when `aiSummaryEnabled` is false; 501 with no provider; 502 when the provider
  throws; 401 unauthed.
- **Frontend** (`InboxTab.spec.ts` / store spec): expand triggers one fetch; loading→loaded renders
  the text and drops "Sample"; error shows the retry; the flag-off case hides the disclosure.
- **e2e** (`ai-summary.spec.ts`): the reference app in test mode injects the fake provider; expanding
  the disclosure shows the (fake) summary; happy path + the error path (provider forced to throw).
- **Manual**: `pnpm dev` with Ollama running + `qwen2.5:7b` pulled → expand → a real digest;
  `browser-tester` confirms.

## Build & run

New local prerequisite for the _real_ summary (not for tests):

- Install Ollama (`brew install ollama` or the app), then `ollama pull qwen2.5:7b`. Add to the repo
  README's Build & run section. The app boots and all suites pass without Ollama; only the live
  summary needs it.

## Out of scope

- **AI Q/A** (step 4) — but the `complete()` seam + the reference provider are built here so Q/A is a
  drop-in (`answer()` on core + a Chat surface).
- **Streaming** the summary — a short digest doesn't need it; Q/A will revisit streaming.
- **`dueAt`/deadline** contract addition and overdue emphasis.
- Cross-instance cache invalidation (single-instance assumption, documented seam).

## Mentor sign-off

Smaller than the core-lib gate, but the **new `GET /notifications/summary` endpoint** and the
**`ai` provider config** are additions to the contract others build against — confirm the endpoint
shape + the `AiProvider` interface before merge.

## Self-review

- **Placeholders:** none. Concrete env var names, model, cap (25), rate limit (≤6/min), timeout
  (30 s), truncation (~280 chars).
- **Consistency:** the seam is `complete(messages)` throughout; core owns the prompt and the
  `SummaryContext` (internal); the reference provider is OpenAI-compatible transport → Ollama. The
  three gate paths (404/501/502) are consistent between core errors and the route mapping.
- **Scope:** one cohesive feature (seam + core summarize + provider + endpoint + frontend wiring);
  Q/A, streaming, and `dueAt` explicitly deferred.
- **Ambiguity resolved:** real model always injected (no key-based switching); tests use a fake
  double; lazy-on-expand + signature cache; factors = clusters/staleness/ordering (deadlines out).
