# AI chat — actionable notifications (citations + action buttons) — design

**Date:** 2026-07-23
**Branch:** `feat/ai-qa` (same branch as the AI Q/A feature; this extends it before the PR)
**Status:** approved (design converged in discussion). **The chat response contract changes (adds a
`sources` SSE frame + turns `service.answer` into a chunk stream) — mentor sign-off on the contract
before merge, same gate as the rest of `feat/ai-qa`.**

## Goal

Two capabilities on the existing streaming chat:

1. The model can **describe the actual actions** a notification offers (today retrieval passes only
   `hasActions: boolean`, so the model has no idea what the actions are).
2. When the answer **cites** a specific notification, that notification renders as an **inline chip**
   in the chat prose; expanding the chip shows the notification and its **real action buttons**, which
   perform the action **exactly as pressing the button on the notification card does**.

This builds directly on the AI Q/A feature (`docs/superpowers/specs/2026-07-23-ai-qa-design.md`) and
its fixes (broadened retrieval + true distribution + off-topic guardrail).

## Locked decisions

- **Cite-based selection.** Each grounding item gets a stable ref (`n1..nK`); the model cites `[n#]`
  inline; the client maps cited refs back to the **trusted server-sent** items and renders their
  buttons. The model's text only _selects_ from trusted data — it can never fabricate an action
  (prompt-injection safe). If the model cites nothing, no chips appear (accepted).
- **Dispatch actions render exactly like the card.** Chat reuses the same action handler; `"link"`
  works today, `"dispatch"` runs the shared stub (`"coming soon"`) and will work automatically the day
  the server-side dispatch proxy lands — zero chat changes. No chat-specific divergence.
- **Inline citation chips.** `[n#]` markers in the answer render as chips labelled with the
  notification's title; clicking expands an inline panel (priority dot + title + age + action buttons).
- **Grounding travels with the stream.** `service.answer` yields a discriminated union; the first
  chunk is the `sources` set, then token deltas. The route emits `sources` as a dedicated SSE frame
  before the deltas.
- **One shared action path.** Extract InboxTab's inline `onAction` into a `useNotificationActions`
  composable used by both the card and the chat, so "exactly as if pressed" is literally the same code.

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` + `pnpm -r build` clean before a task is "done".
- New logic carries a Vitest test in the same task; failure paths tested, not just the happy path.
- **`packages/core` reads no `process.env` and references no identity table** — the boundary test stays
  green. The `sources` set is built from the same `audienceWhere`-scoped grounding — **no new query**,
  so audience scoping is unchanged and still enforced in SQL.
- **Audience isolation:** a principal's `sources` frame must only ever contain that principal's
  audience-scoped notifications (tested foreign-host style, mirroring the existing chat tests).
- PII: the sources carry the user's own notification titles/actions (already sent to the client by the
  feed) — nothing is logged server-side (question/history/context/output stay unlogged).
- **URL safety is already enforced at intake:** `actionSchema` restricts `url` to `http(s)` (no
  `javascript:`/`data:`/`file:`), so surfaced action buttons carry only vetted URLs.
- No AI-attribution commit trailers. Conventional Commits. `docs/api/notifications.md` updated.

## The contract change (`@notifications/core`)

`service.answer` changes from `AsyncIterable<string>` to `AsyncIterable<AnswerChunk>`:

```ts
export interface ChatSource {
  ref: string; // stable "n1".."nK" within this answer
  id: string;
  title: string;
  priority: NotificationPriority;
  actions: NotificationAction[]; // the notification's REAL actions; may be []
}

export type AnswerChunk =
  | { type: "sources"; sources: ChatSource[] } // emitted FIRST, exactly once
  | { type: "delta"; text: string }; // then the token stream
```

- `NotificationAction` is the existing shared type (`{ label, kind: "link"|"dispatch", method, url,
icon? }`).
- Ref assignment (`n1..nK`) happens in `answer` over the retrieved items **in prompt order**, so a
  `[n#]` tag in the prompt and the `ref` in the `sources` frame denote the same item.
- **Order in the generator body (before the first yield):** gate (`chatbotEnabled`→`AiDisabledError`;
  no `completeStream`→`AiNotConfiguredError`) → rate limit (10/min→`AiRateLimitError`) → retrieve →
  **yield `{ type: "sources", … }`** → build prompt (with `[n#]` tags) → `for await` the provider
  stream, **yield `{ type: "delta", text }`** per token; a stream error → `AiProviderError`.
- `retrieveForAnswer` is **unchanged** (still returns `{ items, stats }`); `answer` derives refs +
  the `ChatSource[]` from `items` (carrying each item's real `actions`). Retrieval already selects
  `n.actions`; it currently only exposes `hasActions` on `ChatContextItem` — add the raw `actions`
  (typed) to `ChatContextItem` (or carry them alongside) so `answer` can build `ChatSource`.

## Prompt (`chat-prompt.ts`)

- Each grounding item's line is **prefixed with its ref tag**: `[n1] [unread] [critical] (dsr, 2d
old, has actions): Acme DSAR — …`.
- Add one instruction: _"Each notification below is prefixed with a tag like `[n1]`. When your answer
  refers to a specific notification, include its exact tag inline (e.g. 'The Acme DSAR [n1] is
  overdue.'). Only use tags that appear below."_
- Keep the existing grounding + read/unread scoping + off-topic-refusal instructions and the true
  distribution line.

## Endpoint (`@notifications/server-fastify`)

`POST /notifications/chat` is otherwise unchanged (same body, auth, pre-stream error → JSON mapping).
The streaming section now handles two chunk types:

- `{ type: "sources", sources }` → `event: sources\ndata: ${JSON.stringify(sources)}\n\n`
- `{ type: "delta", text }` → `data: ${JSON.stringify({ delta: text })}\n\n`
- then `data: {"done":true}\n\n`; a mid-stream throw → `event: error\ndata: {"error":"stream failed"}`.

The first `.next()` (now the `sources` chunk) is still advanced **before** `reply.hijack()`, so
gate/rate-limit failures still return a JSON status.

## Frontend

**`useNotificationActions()` composable (new, shared):** lift InboxTab's `onAction` verbatim —
`runAction(action: NotificationAction, target: { id: string })`: `feed.markRead(target.id)`, then
`kind === "dispatch"` → the current `console.info("… coming soon")` stub, else
`window.open(action.url, "_blank", "noopener,noreferrer")`. InboxTab refactors to call it (no behavior
change; its existing action test still passes).

**Chat store (`stores/chat.ts`):** the per-turn AI entry gains `sources: Record<string, ChatSource>`
(ref→source). The stream parser handles the new frame: an `event: sources` frame populates the map;
`data:{delta}` frames append text as today; `done`/`error` unchanged. History mapping to the server is
unchanged (text only).

**`AssistantTab.vue`:** render the AI turn's text split on the `/\[n\d+\]/` pattern — literal text
segments as text, each `[n#]` whose ref exists in the turn's `sources` map as a `<CitationChip>`
(unknown refs render as plain text). Re-split on each streamed update (a marker split across chunks
briefly shows as text until complete — acceptable).

**`CitationChip.vue` (new):** a small inline chip showing the source's title; clicking toggles an
inline expansion with the priority dot + title + relative age and, if `actions.length`, the action
buttons (reusing the same action-button markup/icons as the card via `actionIcon`), each calling
`useNotificationActions().runAction(action, { id: source.id })`.

## Testing

Fake provider drives everything offline; the real model is verified manually.

- **core `chat-prompt.test.ts`:** each item line carries its `[n#]` tag; the system prompt contains the
  cite instruction; unchanged: guardrail + distribution + read/unread.
- **core `answer.test.ts`:** the **first** yielded chunk is `{ type: "sources", sources }` with
  `ref`/`id`/`title`/`priority`/`actions` (actions populated for an item seeded with actions), then
  `{ type: "delta" }` chunks whose text concatenates to the fake answer; audience isolation — A's
  `sources` never contain a title seeded only for B; gating/rate-limit/`AiProviderError` unchanged
  (adjust the existing string-concatenation helper to read `.type === "delta"`).
- **server-fastify `chat.route.test.ts`:** the response contains an `event: sources` frame (carrying the
  seeded notification's actions) **before** the delta frames; deltas still assemble the answer; the
  404/401/400/501 cases unchanged; audience isolation on the `sources` frame.
- **backend `ai-provider.test.ts`:** the fake `completeStream` yields a canned answer that **contains
  `[n1]`** (so the chip path is exercised); the OpenAI SSE-parse test is unchanged.
- **frontend `chat.spec.ts`:** the store parses an `event: sources` frame into the turn's `sources`
  map, then appends deltas; history bounding unchanged.
- **frontend `CitationChip.spec.ts` + `AssistantTab.spec.ts`:** a `[n#]` with a matching source renders
  a chip; expanding shows the action buttons; clicking a button calls `runAction`; an unknown `[n#]`
  renders as plain text; the off-state (chatbot disabled) still hides the composer.
- **frontend `InboxTab` action test:** still green after the composable extraction (same behavior).
- **e2e `ai-chat.spec.ts`:** seed a notification **with a `link` action**; ask a question; assert a
  citation chip appears, expand it, and assert an action button is present (fake provider cites `[n1]`,
  so this is deterministic and provider-agnostic in spirit).

## Build & run

No new prerequisite — same Ollama + `qwen2.5:7b` setup. The dev server must be restarted to pick up the
new core (workspace build).

## Out of scope

- Making `dispatch` actions actually execute (the server-side action proxy is its own later cycle) —
  this feature only surfaces the buttons and wires them to the shared handler.
- Semantic retrieval, server-persisted history, multi-conversation management, cross-instance rate
  limit — all still out of scope from the parent feature.
- The model _performing_ actions itself (it may cite/suggest; the human clicks).

## Mentor sign-off

Confirm before merge (bundled with the parent AI Q/A gate): the `sources` SSE frame + the
`AnswerChunk` discriminated-union shape of `service.answer` — the streaming contract hosts build
against.

## Self-review

- **Placeholders:** none. Concrete: ref format `n1..nK`, split regex `/\[n\d+\]/`, chunk union, frame
  names (`event: sources`), the fake provider must emit `[n1]`.
- **Consistency:** reuses the existing `NotificationAction` type, the `audienceWhere`-scoped grounding
  (no new query, no scoping change), the SSE hijack/error pattern, and the fake/real provider seam. The
  one behavior change (dispatch in chat) is explicitly "same as the card."
- **Scope:** one cohesive feature — contract change + ref/prompt + one shared composable + chip UI +
  tests. Dispatch execution and semantic retrieval explicitly deferred.
- **Ambiguity resolved:** cite-based selection (not "all actionable"); chips (not grouped rows);
  dispatch renders like the card; every grounding item is a possible chip, only actionable ones show
  buttons.
