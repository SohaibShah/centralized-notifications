# AI Q/A with notifications — design

**Date:** 2026-07-23
**Branch:** `feat/ai-qa` (off `main`, which now has the BE library + AI summarizer)
**Status:** approved (design converged in discussion); **new streaming endpoint + the `completeStream` seam addition are public-API additions — mentor nod before merge**

## Goal

A chat where the user asks questions about their notifications and a local LLM answers, **grounded
in the user's own audience-scoped notifications** (read and unread). It is the fourth and final
feature before the UI-library extraction, and the **second consumer of the `AiProvider` seam** shipped
with the summarizer — proving the seam serves both AI features. It replaces the current
`AssistantTab.vue` visual stub (canned thread + inert composer, gated by `chatbotEnabled`) with a real
streaming chat.

## Locked decisions

- **Retrieval: Postgres full-text RAG-lite.** Ground answers by matching the question against the
  existing `notifications.search` tsvector (+ GIN index), audience-scoped, unioned with a few recent
  high-priority notifications; no new deps, no embeddings.
- **Read + unread, model differentiates.** Retrieval spans the whole audience-scoped set; each item
  carries a `read` flag and the prompt tells the model to scope its answer (unread / read / both) to
  the question. The read/unread split is a within-user distinction, never a security boundary.
- **Streaming answers.** `AiProvider` gains `completeStream`; the chat endpoint streams token deltas;
  the UI renders them live.
- **Client-only multi-turn.** The frontend holds the thread and sends the bounded recent history
  (~8 turns) with each question; nothing chat-related is persisted server-side.
- **Reuses the summarizer's architecture** — same provider seam, same Ollama/OpenAI-compatible
  reference adapter (real by default, fake when `AI_PROVIDER=fake`), same gating/error pattern.

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` + `pnpm -r build` clean before a task is "done".
- New logic carries a Vitest test in the same task; failure paths tested, not just the happy path.
- Parameterized SQL only. **`packages/core` reads no `process.env` and references no identity table**
  — the existing boundary test must stay green. Retrieval uses `audienceWhere` (bound params), not a
  join to identity tables.
- **No secret in code.** Provider config unchanged (from env, validated at startup); `AI_API_KEY`
  never logged or returned to the browser.
- **PII:** notification content, the user's question, and history go to the model (the intended
  egress) — **never logged in full**.
- **Audience scoping enforced in SQL at retrieval** — prompt injection cannot exfiltrate another
  user's/audience's notifications.
- No AI-attribution commit trailers. Conventional Commits. `docs/api/*` updated via docs-writer.
- **Mentor sanity-check on `POST /notifications/chat` + the `completeStream` addition before merge.**

## The seam extension (`@notifications/core`)

`AiProvider` gains a streaming sibling to `complete`:

```ts
interface AiProvider {
  complete(
    messages: AiMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
  completeStream(
    messages: AiMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): AsyncIterable<string>; // yields token deltas
}
```

- Reference Ollama adapter: `completeStream` calls `/v1/chat/completions` with `stream: true`, parses
  the streamed chunks, and yields each `choices[0].delta.content`.
- Fake adapter (`AI_PROVIDER=fake`): yields a short canned answer in a few chunks.

This is the mentor-gated addition — it grows the public `AiProvider` contract that hosts implement.

## Core `answer` (`packages/core/src/ai/answer.ts`)

```ts
service.answer(args: {
  principal: Principal;
  question: string;
  history: { role: "user" | "assistant"; content: string }[]; // bounded by the caller/route
}): AsyncIterable<string>
```

1. **Gate** (before streaming, so these map to clean HTTP statuses): `chatbotEnabled` false →
   `AiDisabledError` (route → 404); no `config.ai` provider → `AiNotConfiguredError` (→ 501).
2. **Rate limit** — per-recipient sliding window (10/min) → `AiRateLimitError` (→ 429). Reuses the
   summarizer's limiter pattern.
3. **Retrieve grounding (audience-scoped, read + unread):**
   - FTS: `WHERE n.suppressed = false AND <audienceWhere> AND n.search @@ websearch_to_tsquery('english', $question)`
     ordered by `ts_rank(n.search, websearch_to_tsquery(...)) DESC`, top **12**. `websearch_to_tsquery`
     safely converts a natural-language question to a tsquery (bound param — no injection).
   - Recency union: top **8** recent high-priority audience-scoped notifications (so general
     questions like "what's most urgent?" work even without a keyword hit).
   - Merge + dedupe by id, cap **20**. Each row carries `read` (via `LEFT JOIN notification_reads r ON
r.notification_id = n.id AND r.user_key = $userKey`).
   - Context item: `{ title, description(≤280), priority, module, category?, ageMinutes, read, hasActions }`.
   - Empty result (user has no matching notifications) → still answer; the model says it has nothing
     relevant.
4. **Build messages** (core-owned prompt): system = "Answer ONLY from the notifications provided
   below; if the answer isn't in them, say so. Each is tagged [read] or [unread] — scope your answer
   to the question (unread only / read only / both). Be concise." + the context block; then the
   bounded `history`; then the new `question`.
5. **Stream** — `yield*` `provider.completeStream(messages, { temperature: 0.2, maxTokens: 500 })`. A
   mid-stream provider failure throws; the route turns it into an `error` frame.

Never logs the context, question, history, or output.

## Endpoint (`@notifications/server-fastify`)

`POST /notifications/chat`, `requirePrincipal`. Body (zod): `{ question: string (1..2000), history:
Array<{ role: "user"|"assistant"; content: string (1..4000) }> (max 8) }`.

- Pre-stream errors map as JSON: 401 unauth, 400 invalid body, 404 `AiDisabledError`,
  501 `AiNotConfiguredError`, 429 `AiRateLimitError`.
- On success, responds `text/event-stream` and writes each delta as `data: {"delta":"..."}\n\n`,
  ending with `data: {"done":true}\n\n`. A provider failure _after_ streaming starts writes
  `event: error\ndata: {"error":"stream failed"}\n\n` and closes (headers already sent, so no status
  change). A bounded server-side timeout guards a hung model (reuses the adapter's 30s abort).

## Frontend

**Chat store (`frontend/src/stores/chat.ts`):** `thread: { from: "me" | "ai"; text: string }[]`,
`status: "idle" | "streaming" | "error"`, `send(question)`:

- Append the user turn and an empty AI turn; POST `{ question, history }` (map the last ~8 thread
  turns to `{ role, content }`); read `response.body` as a stream, parse `data:` frames, and append
  each `delta` to the in-progress AI turn's text live; on the `error` frame mark it errored; `done`
  finalizes. `send` is a no-op while `status === "streaming"`.

**AssistantTab (`frontend/src/features/notifications/panel/AssistantTab.vue`):**

- Replace the canned `thread` with the store's; render the AI bubble growing as tokens arrive.
- **Enable the composer** (input + send button; submit on Enter, disabled while streaming/empty).
- Gate on `settings.flags.chatbotEnabled`: when off, show a "chat is turned off" state instead of the
  composer (the server enforces the same flag independently).
- Keep the existing AI visual identity (sparkle, ai-bubble styling).

## Testing

Fake provider yields a canned streamed answer; the real model never runs in CI.

- **core** (`answer.test.ts`): `chatbotEnabled` false → `AiDisabledError`; no provider →
  `AiNotConfiguredError`; retrieval is audience-scoped — a **foreign-host-style test** proves user A's
  grounding context never includes user B's notifications; retrieval spans read + unread and carries
  the `read` flag; the async iterable yields the fake deltas in order; rate-limit → `AiRateLimitError`.
- **retrieval unit** (`retrieve.test.ts`): FTS matches a keyword in title/description; the recency
  union includes a high-priority item with no keyword hit; results are audience-scoped + deduped +
  capped.
- **server-fastify** (`chat.route.test.ts`): a fake-provider chat streams `data:` frames assembling
  the canned answer; 404 (disabled) / 501 (no provider) / 401 / 400 (bad body); audience isolation
  (asking about a notification only another user can see yields "no info").
- **frontend**: chat store (streamed appends, error frame, history bounding); AssistantTab (composer
  enabled, submit calls `send`, streaming renders, disabled-state when the flag is off).
- **e2e** (`ai-chat.spec.ts`, `AI_PROVIDER=fake`): open the Ask-AI tab, type a question, send, assert
  a streamed AI answer appears and resolves (provider-agnostic). Real model verified manually via
  `browser-tester`.

## Build & run

No new prerequisite — reuses the Ollama + `qwen2.5:7b` setup from the summarizer.

## Out of scope

- Semantic/embedding retrieval (pgvector); server-persisted conversation history; the model
  _executing_ actions ("open it" / "draft a reply" — it may suggest, not act); multi-conversation
  management; cross-instance rate-limit (single-instance, documented seam).

## Mentor sign-off

Confirm before merge: `POST /notifications/chat` (streaming SSE shape) and the `completeStream`
addition to the `AiProvider` interface — the contract hosts implement/build against.

## Self-review

- **Placeholders:** none. Concrete caps (FTS 12, recency 8, total 20, history 8 turns, question 2000
  chars), rate limit (10/min), temperature 0.2 / maxTokens 500, `websearch_to_tsquery('english', …)`.
- **Consistency:** reuses `AiProvider`, the reference Ollama/fake adapters, the gating error classes
  (`AiDisabledError`/`AiNotConfiguredError`/`AiRateLimitError`/`AiProviderError`), and the
  `audienceWhere` read pattern from the summarizer. `answer` returns an async iterable; the route
  turns it into SSE frames.
- **Scope:** one cohesive feature (seam extension + retrieval + answer + streaming endpoint + chat
  wiring). Embeddings, persistence, and action-execution explicitly deferred.
- **Ambiguity resolved:** retrieval spans read+unread with a `read` flag and prompt-driven scoping;
  streaming via `completeStream`; client-only bounded multi-turn; audience enforced in SQL at
  retrieval (not the prompt).
