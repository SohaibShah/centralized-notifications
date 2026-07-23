# AI Chat Actionable Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI chat cite specific notifications inline and render their real action buttons — where clicking a button does exactly what the notification card's button does.

**Architecture:** `service.answer` changes from `AsyncIterable<string>` to `AsyncIterable<AnswerChunk>` — it yields a `sources` chunk (the trusted, audience-scoped grounding items, each with a stable ref `n1..nK` and its real actions) first, then `delta` token chunks. The prompt tags each grounding item with its `[n#]` ref and asks the model to cite it. The route emits an `event: sources` SSE frame before the delta frames. The frontend parses `sources` into a per-turn map, renders `[n#]` markers in the answer as `<CitationChip>`s, and expands a chip to the notification + its action buttons wired to a new shared `useNotificationActions` composable (lifted from InboxTab).

**Tech Stack:** TypeScript (strict, ESM), `@notifications/core`/`server-fastify`, Fastify 5 (`reply.hijack` SSE), zod, Vue 3 + Pinia, Vitest, Playwright, Ollama (fake provider in tests).

## Global Constraints

- TS strict; `pnpm lint` + `pnpm typecheck` + `pnpm -r build` clean before a task is "done".
- New logic carries a Vitest test in the same task; failure paths tested, not just the happy path.
- **`packages/core` reads no `process.env` and references no identity table** — `packages/core/test/boundary.test.ts` stays green. The `sources` set reuses the existing `audienceWhere`-scoped grounding — **no new query**; audience scoping unchanged, still enforced in SQL.
- **Audience isolation:** a principal's `sources` frame must contain ONLY that principal's audience-scoped notifications (tested).
- PII: nothing logged server-side (question/history/context/output/sources).
- `actionSchema` already restricts action `url` to `http(s)` at intake — surfaced buttons carry only vetted URLs.
- The model's text only _selects_ trusted server-sent items via `[n#]`; it never fabricates an action.
- No AI-attribution commit trailers. Conventional Commits. `docs/api/notifications.md` updated.
- **Mentor sign-off (bundled with the parent AI Q/A gate) on the `AnswerChunk` shape + the `sources` SSE frame before merge.** Do not push/PR without it.

---

## File Structure

**`packages/core/`**

- `src/ai/retrieve.ts` (modify) — add `id` + `actions` to `ChatContextItem`.
- `src/ai/chat-prompt.ts` (modify) — `[n#]` tags + cite instruction; `buildChatMessages(context, sources, history, question)`.
- `src/ai/answer.ts` (modify) — `ChatSource`, `AnswerChunk`; `answer` yields `sources` then `delta`s.
- `src/service.ts` (modify) — `answer` return type → `AsyncIterable<AnswerChunk>`.
- `src/index.ts` (modify) — export `ChatSource`, `AnswerChunk`.
- `test/retrieve.test.ts`, `test/chat-prompt.test.ts`, `test/answer.test.ts` (modify).

**`packages/server-fastify/`**

- `src/routes/chat.ts` (modify) — emit `event: sources` for the `sources` chunk, `data:{delta}` for deltas.
- `test/chat.route.test.ts` (modify).

**`backend/` (reference)**

- `src/reference/ai/fake-provider.ts` (modify) — canned stream contains `[n1]`.
- `test/ai-provider.test.ts` (modify).

**`frontend/`**

- `src/composables/useNotificationActions.ts` (create) — shared `runAction`.
- `src/features/notifications/panel/InboxTab.vue` (modify) — use the composable.
- `src/stores/chat.ts` (modify) — parse `sources`; per-turn `sources` map.
- `src/features/notifications/panel/CitationChip.vue` (create).
- `src/features/notifications/panel/AssistantTab.vue` (modify) — render chips.
- `src/composables/useNotificationActions.spec.ts`, `stores/chat.spec.ts`, `panel/CitationChip.spec.ts`, `panel/AssistantTab.spec.ts`, `panel/InboxTab.spec.ts` (create/modify).
- `e2e/ai-chat.spec.ts` (modify).

**Docs:** `docs/api/notifications.md`.

---

## Unit A — Core contract

### Task 1: `ChatContextItem` carries `id` + `actions`

**Files:** Modify `packages/core/src/ai/retrieve.ts`; Test `packages/core/test/retrieve.test.ts`.

**Interfaces:**

- Produces: `ChatContextItem` gains `id: string` and `actions: NotificationAction[]` (from `@notifications/shared`). `retrieveForAnswer` return type is unchanged (`ChatContext = { items; stats }`).

- [ ] **Step 1: Add a failing assertion** to the existing test `"FTS hit + recency union, audience-scoped, with read flags"` in `packages/core/test/retrieve.test.ts` — after the existing shape asserts (around `expect(a!.description.length)...`), add:

```ts
expect(typeof a!.id).toBe("string");
expect(a!.id.length).toBeGreaterThan(0);
expect(Array.isArray(a!.actions)).toBe(true);
```

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/core test retrieve` — Expected: FAIL (`id`/`actions` not on the item type / undefined).

- [ ] **Step 3: Implement** in `packages/core/src/ai/retrieve.ts` — add the import and extend the interface + `toItem`:

```ts
import type { NotificationAction, NotificationPriority } from "@notifications/shared";
```

```ts
export interface ChatContextItem {
  id: string;
  title: string;
  description: string; // ≤280
  priority: NotificationPriority;
  module: string;
  category?: string;
  ageMinutes: number;
  read: boolean;
  hasActions: boolean;
  actions: NotificationAction[]; // the notification's real actions (validated at intake); may be []
}
```

In `toItem`, add `id` and `actions` (keep `hasActions`):

```ts
function toItem(r: Row, nowMs: number): ChatContextItem {
  // r.actions is opaque jsonb validated at intake against actionSchema — safe to treat as actions.
  const actions = (Array.isArray(r.actions) ? r.actions : []) as NotificationAction[];
  return {
    id: r.id,
    title: r.title,
    description: r.description.slice(0, 280),
    priority: r.priority,
    module: r.module,
    ...(r.category != null ? { category: r.category } : {}),
    ageMinutes: Math.max(0, Math.floor((nowMs - r.created_at.getTime()) / 60000)),
    read: r.read,
    hasActions: actions.length > 0,
    actions,
  };
}
```

(`NotificationPriority` is already imported; extend the existing import line to include `NotificationAction`, and drop the now-redundant `import { NOTIFICATION_PRIORITIES }` only if unused — it IS used by `retrieveStats`, so keep it.)

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(core): carry notification id + actions on ChatContextItem`

### Task 2: `[n#]` ref tags + cite instruction in the prompt

**Files:** Modify `packages/core/src/ai/chat-prompt.ts`; Test `packages/core/test/chat-prompt.test.ts`.

**Interfaces:**

- Consumes: `ChatContext`, `ChatContextItem` (`./retrieve`), `ChatSource` (`./answer` — defined in Task 3; to avoid a Task2↔Task3 import cycle, `buildChatMessages` takes a minimal `{ ref: string; id: string }[]` for tags, NOT the full `ChatSource`).
- Produces: `buildChatMessages(context: ChatContext, refs: { ref: string; id: string }[], history: ChatTurn[], question: string): AiMessage[]`.

- [ ] **Step 1: Update the failing test** `packages/core/test/chat-prompt.test.ts` — the first test now passes `refs`. Replace the `buildChatMessages(context, [...history], "...")` call in the `"system carries grounding..."` test so it passes refs aligned to the two items, and assert the tag + instruction:

```ts
const refs = [
  { ref: "n1", id: "a1" },
  { ref: "n2", id: "a2" },
];
const msgs = buildChatMessages(
  { ...context, items: context.items.map((it, i) => ({ ...it, id: refs[i]!.id })) },
  refs,
  [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ],
  "any unread DSARs?",
);
// ...existing assertions, plus:
expect(system).toContain("[n1]"); // the ref tag on the first item's line
expect(lower).toContain("include its exact tag"); // cite instruction
```

Update the other two tests (`"history is capped..."`, `"empty context..."`) to pass `[]` as the new second arg: `buildChatMessages(context, [], history, "now?")` and `buildChatMessages({ stats: stats(), items: [] }, [], [], "anything?")`. Also add `id` to the two items in the first test's `context.items` literals (e.g. `id: "a1"` / `id: "a2"`) since `ChatContextItem` now requires it.

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/core test chat-prompt` — Expected: FAIL (arity/tag).

- [ ] **Step 3: Implement** `packages/core/src/ai/chat-prompt.ts` — add a cite instruction, thread `refs`:

Add to the `INSTRUCTIONS` array (after the read/unread line, before "Be concise"):

```ts
  "Each notification below is prefixed with a tag like [n1]. When your answer refers to a specific notification, include its exact tag inline (for example: \"The Acme DSAR [n1] is overdue.\"). Only use tags that appear below.",
```

Change `line` to accept a ref and prefix it, and `buildChatMessages` to take + use `refs`:

```ts
function line(i: ChatContextItem, ref: string): string {
  const age =
    i.ageMinutes >= 1440
      ? `${Math.floor(i.ageMinutes / 1440)}d`
      : `${Math.floor(i.ageMinutes / 60)}h`;
  const cat = i.category ? `, ${i.category}` : "";
  return `- [${ref}] [${i.read ? "read" : "unread"}] [${i.priority}] (${i.module}${cat}, ${age} old${i.hasActions ? ", has actions" : ""}): ${i.title} — ${i.description}`;
}

export function buildChatMessages(
  context: ChatContext,
  refs: { ref: string; id: string }[],
  history: ChatTurn[],
  question: string,
): AiMessage[] {
  const { items, stats } = context;
  const refById = new Map(refs.map((r) => [r.id, r.ref]));
  const listing = items.length
    ? `Notifications you may reference (a sample — see the counts above for the full totals):\n${items
        .map((it) => line(it, refById.get(it.id) ?? "n?"))
        .join("\n")}`
    : "There are no notifications to reference.";
  const system = `${INSTRUCTIONS}\n\n${statsLine(stats)}\n\n${listing}`;
  return [
    { role: "system", content: system },
    ...history.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(core): tag grounding items with [n#] refs + cite instruction`

### Task 3: `answer` yields `AnswerChunk` (sources first, then deltas)

**Files:** Modify `packages/core/src/ai/answer.ts`, `packages/core/src/service.ts`, `packages/core/src/index.ts`; Test `packages/core/test/answer.test.ts`.

**Interfaces:**

- Consumes: `retrieveForAnswer`, `buildChatMessages`, `ChatContextItem`, the Ai error classes, `NotificationAction`/`NotificationPriority`.
- Produces:
  - `interface ChatSource { ref: string; id: string; title: string; priority: NotificationPriority; ageMinutes: number; actions: NotificationAction[] }`
  - `type AnswerChunk = { type: "sources"; sources: ChatSource[] } | { type: "delta"; text: string }`
  - `AnswerEngine.answer(...)` and `NotificationService.answer(...)` return `AsyncIterable<AnswerChunk>`.

- [ ] **Step 1: Update the failing test** `packages/core/test/answer.test.ts`:

Replace the `collect` helper and add a `sourcesOf` helper (chunks now, not strings):

```ts
import type { AnswerChunk } from "../src/ai/answer";

async function collect(it: AsyncIterable<AnswerChunk>): Promise<string> {
  let s = "";
  for await (const c of it) if (c.type === "delta") s += c.text;
  return s;
}

async function sourcesOf(
  it: AsyncIterable<AnswerChunk>,
): Promise<AnswerChunk & { type: "sources" }> {
  for await (const c of it) if (c.type === "sources") return c;
  throw new Error("no sources chunk");
}
```

Add a new test proving sources-first + shape + actions:

```ts
test("emits a sources chunk first, carrying refs/ids/actions", async () => {
  const userKey = `src-${stamp}`;
  await persistWithAction(userKey, `src-a-${stamp}`, "Acme DSAR");
  const engine = new AnswerEngine({ query, getSettings: async () => on, provider: helloProvider });
  const it = engine
    .answer({
      principal: { userKey, roles: [], teamKeys: [] },
      question: "acme",
      history: [],
    })
    [Symbol.asyncIterator]();
  const first = await it.next();
  expect(first.value.type).toBe("sources");
  const src = (first.value as AnswerChunk & { type: "sources" }).sources.find(
    (s) => s.title === "Acme DSAR",
  );
  expect(src).toBeDefined();
  expect(src!.ref).toMatch(/^n\d+$/);
  expect(src!.actions).toEqual([
    { label: "Open", kind: "link", method: "GET", url: "https://x/1" },
  ]);
});
```

Add the `persistWithAction` helper near `seed`:

```ts
async function persistWithAction(userScope: string, id: string, title: string): Promise<void> {
  const n: Notification = {
    id,
    module: "dsr",
    title,
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "user", id: userScope },
    actions: [{ label: "Open", kind: "link", method: "GET", url: "https://x/1" }],
  };
  await persist(query, n, false);
}
```

The existing audience-isolation test uses an echo provider yielding `messages[0]!.content`; `collect` now returns only delta text, so it still works. Add a direct assertion on the sources chunk there too:

```ts
const src = await sourcesOf(engine.answer({ principal: a, question: secretTitle, history: [] }));
expect(src.sources.some((s) => s.title === secretTitle)).toBe(false);
expect(src.sources.some((s) => s.title === "A visible note")).toBe(true);
```

(The gating/rate-limit tests keep using `collect`, which now drains chunks — no change needed to them.)

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/core test answer` — Expected: FAIL (`AnswerChunk` missing / `answer` yields strings).

- [ ] **Step 3: Implement** `packages/core/src/ai/answer.ts`:

```ts
import type { NotificationAction, NotificationPriority } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { AiProvider, Principal, Settings } from "../types";
import { AiDisabledError, AiNotConfiguredError, AiProviderError, AiRateLimitError } from "./errors";
import { buildChatMessages, type ChatTurn } from "./chat-prompt";
import { retrieveForAnswer } from "./retrieve";

export type { ChatTurn };

/** A notification the answer may cite, with a stable per-answer ref and its real actions. */
export interface ChatSource {
  ref: string; // "n1".."nK" within this answer
  id: string;
  title: string;
  priority: NotificationPriority;
  ageMinutes: number;
  actions: NotificationAction[];
}

/** The stream the chat endpoint turns into SSE: the trusted grounding set first, then token deltas. */
export type AnswerChunk =
  { type: "sources"; sources: ChatSource[] } | { type: "delta"; text: string };

const RATE_LIMIT = 10; // chat turns per recipient per minute

export class AnswerEngine {
  private readonly calls = new Map<string, number[]>();
  constructor(
    private readonly deps: {
      query: QueryFn;
      getSettings: () => Promise<Settings>;
      provider?: AiProvider;
    },
  ) {}

  async *answer(args: {
    principal: Principal;
    question: string;
    history: ChatTurn[];
  }): AsyncIterable<AnswerChunk> {
    if (!(await this.deps.getSettings()).chatbotEnabled) throw new AiDisabledError();
    const provider = this.deps.provider;
    if (!provider?.completeStream) throw new AiNotConfiguredError();
    this.checkRate(args.principal.userKey);

    const context = await retrieveForAnswer(this.deps.query, args.principal, args.question);
    const sources: ChatSource[] = context.items.map((it, i) => ({
      ref: `n${i + 1}`,
      id: it.id,
      title: it.title,
      priority: it.priority,
      ageMinutes: it.ageMinutes,
      actions: it.actions,
    }));
    yield { type: "sources", sources };

    const messages = buildChatMessages(
      context,
      sources.map((s) => ({ ref: s.ref, id: s.id })),
      args.history,
      args.question,
    );
    try {
      for await (const text of provider.completeStream(messages, {
        temperature: 0.2,
        maxTokens: 500,
      })) {
        yield { type: "delta", text };
      }
    } catch (err) {
      throw new AiProviderError(err instanceof Error ? err.message : String(err));
    }
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

In `packages/core/src/service.ts`, update the import + the interface return type + the wiring stays the same:

```ts
import { AnswerEngine, type AnswerChunk, type ChatTurn } from "./ai/answer";
```

Interface method (replace the return type + comment tail):

```ts
  /** Streaming Q/A grounded in the caller's audience-scoped notifications (read+unread). The async
   *  generator gates on its first `.next()`: throws AiDisabledError (chat off), AiNotConfiguredError
   *  (no streaming provider), AiRateLimitError; then yields a `sources` chunk followed by `delta`
   *  token chunks; AiProviderError mid-stream. */
  answer(args: {
    principal: Principal;
    question: string;
    history: ChatTurn[];
  }): AsyncIterable<AnswerChunk>;
```

(The returned object's `answer: (args) => answerEngine.answer(args)` is unchanged.)

In `packages/core/src/index.ts`, add to the type exports:

```ts
export type { ChatTurn, ChatSource, AnswerChunk } from "./ai/answer";
```

(Remove the old standalone `export type { ChatTurn } from "./ai/answer";` if present, folding it into the line above to avoid a duplicate export.)

- [ ] **Step 4: Run the test to verify it passes** — Run: `pnpm --filter @notifications/core test answer` — Expected: PASS.
- [ ] **Step 5: Full core gate + commit**

Run: `pnpm --filter @notifications/core test && pnpm --filter @notifications/core typecheck && pnpm --filter @notifications/core build`
Expected: green incl. `boundary.test.ts`. Commit — `feat(core): answer streams sources chunk + token deltas`

---

## Unit B — Plugin route

### Task 4: Emit the `event: sources` frame before deltas

**Files:** Modify `packages/server-fastify/src/routes/chat.ts`; Test `packages/server-fastify/test/chat.route.test.ts`.

**Interfaces:**

- Consumes: `service.answer` now yielding `AnswerChunk`.
- Produces: the SSE stream now has an `event: sources\ndata: <ChatSource[]>` frame before `data:{delta}` frames.

- [ ] **Step 1: Update the failing test** `packages/server-fastify/test/chat.route.test.ts`:

In the first test (`"200 streams SSE deltas..."`), seed a notification WITH an action and assert the sources frame precedes the deltas. Change the `seed` in that test to a new `seedWithAction` and add assertions:

```ts
async function seedWithAction(svc: NotificationService, userScope: string, id: string, title = id) {
  const n: Notification = {
    id,
    module: "dsr",
    title,
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "user", id: userScope },
    actions: [{ label: "Open", kind: "link", method: "GET", url: "https://x/1" }],
  };
  await svc.ingest(n);
}
```

In the test body, after reading `body`:

```ts
const sourcesIdx = body.indexOf("event: sources");
const firstDeltaIdx = body.indexOf('data: {"delta"');
expect(sourcesIdx).toBeGreaterThanOrEqual(0);
expect(firstDeltaIdx).toBeGreaterThan(sourcesIdx); // sources frame precedes deltas
const sourcesLine = body
  .slice(sourcesIdx)
  .split("\n")
  .find((l) => l.startsWith("data:"))!;
const sources = JSON.parse(sourcesLine.slice(5).trim()) as { title: string; actions: unknown[] }[];
expect(sources.some((s) => s.actions.length > 0)).toBe(true);
```

In the audience-isolation test, after reading `body`, also assert the sources frame excludes B:

```ts
expect(body).not.toContain(secret); // neither the deltas nor the sources frame carry B's title
```

(This already holds via the echo provider check on the delta stream; the added line asserts the whole body — including sources — is clean.)

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/server-fastify test chat.route` — Expected: FAIL (no `event: sources` frame yet).

- [ ] **Step 3: Implement** in `packages/server-fastify/src/routes/chat.ts` — the pre-hijack advance + error mapping is unchanged; the write loop now branches on chunk type. Replace the streaming `try` block:

```ts
try {
  while (!step.done) {
    const chunk = step.value;
    if (chunk.type === "sources") {
      write(`event: sources\ndata: ${JSON.stringify(chunk.sources)}\n\n`);
    } else {
      write(`data: ${JSON.stringify({ delta: chunk.text })}\n\n`);
    }
    step = await iter.next();
  }
  write(`data: ${JSON.stringify({ done: true })}\n\n`);
} catch {
  write(`event: error\ndata: ${JSON.stringify({ error: "stream failed" })}\n\n`);
} finally {
  res.end();
}
```

`step`'s type is now `IteratorResult<AnswerChunk>` — update the declaration `let step: IteratorResult<AnswerChunk>;` and the import to bring in the type:

```ts
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
  type AnswerChunk,
  type NotificationService,
} from "@notifications/core";
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Plugin gate + commit**

Run: `pnpm --filter @notifications/server-fastify test && pnpm --filter @notifications/server-fastify typecheck && pnpm --filter @notifications/server-fastify build`
Commit — `feat(server-fastify): emit sources SSE frame before chat deltas`

---

## Unit C — Reference provider

### Task 5: Fake provider cites `[n1]`

**Files:** Modify `backend/src/reference/ai/fake-provider.ts`; Test `backend/test/ai-provider.test.ts`.

**Interfaces:**

- Produces: `createFakeProvider().completeStream` yields a canned answer whose text contains `[n1]`.

- [ ] **Step 1: Update the failing test** — in `backend/test/ai-provider.test.ts`, tighten the fake streaming test:

```ts
it("streams a canned answer in chunks that cites [n1]", async () => {
  const out: string[] = [];
  for await (const d of createFakeProvider().completeStream!([])) out.push(d);
  expect(out.length).toBeGreaterThan(1);
  expect(out.join("")).toMatch(/notification/i);
  expect(out.join("")).toContain("[n1]"); // exercises the citation-chip path offline
});
```

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/backend test ai-provider` — Expected: FAIL (no `[n1]`).

- [ ] **Step 3: Implement** — update `createFakeProvider`'s `completeStream` chunks:

```ts
    completeStream: async function* () {
      for (const chunk of [
        "Based on your notifications, ",
        "the most urgent item is the DSR SLA breach [n1]. ",
        "Start there.",
      ]) {
        yield chunk;
      }
    },
```

- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Backend gate + commit**

Run: `pnpm --filter @notifications/backend test ai-provider && pnpm --filter @notifications/backend typecheck`
Commit — `feat(backend): fake provider cites [n1] to exercise the chip path`

---

## Unit D — Frontend

### Task 6: Shared `useNotificationActions` composable

**Files:** Create `frontend/src/composables/useNotificationActions.ts`, `frontend/src/composables/useNotificationActions.spec.ts`; Modify `frontend/src/features/notifications/panel/InboxTab.vue`; Test — the existing InboxTab action test must still pass.

**Interfaces:**

- Produces: `useNotificationActions()` → `{ runAction(action: NotificationAction, target: { id: string }): void }`.

- [ ] **Step 1: Write the failing test** `frontend/src/composables/useNotificationActions.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { NotificationAction } from "@notifications/shared";

const { markReadSpy } = vi.hoisted(() => ({ markReadSpy: vi.fn() }));
vi.mock("@/stores/feed", () => ({ useFeedStore: () => ({ markRead: markReadSpy }) }));

const { useNotificationActions } = await import("./useNotificationActions");

describe("useNotificationActions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    markReadSpy.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a link action opens the url and marks the notification read", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { runAction } = useNotificationActions();
    const action: NotificationAction = {
      label: "Open",
      kind: "link",
      method: "GET",
      url: "https://x/1",
    };
    runAction(action, { id: "abc" });
    expect(markReadSpy).toHaveBeenCalledWith("abc");
    expect(open).toHaveBeenCalledWith("https://x/1", "_blank", "noopener,noreferrer");
  });

  it("a dispatch action marks read but does not open a url (stub)", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { runAction } = useNotificationActions();
    runAction({ label: "Do", kind: "dispatch", method: "POST", url: "https://x/2" }, { id: "def" });
    expect(markReadSpy).toHaveBeenCalledWith("def");
    expect(open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/frontend test useNotificationActions` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `frontend/src/composables/useNotificationActions.ts`:

```ts
import type { NotificationAction } from "@notifications/shared";
import { useFeedStore } from "@/stores/feed";

/** The single action path shared by the notification card and the AI chat. A module action's `kind`
 *  (not its HTTP method) decides behavior: "link" opens the url in a new tab; "dispatch" runs a
 *  server-side action proxy (a later cycle) — stubbed now. Firing any action also marks it read. */
export function useNotificationActions(): {
  runAction: (action: NotificationAction, target: { id: string }) => void;
} {
  const feed = useFeedStore();
  function runAction(action: NotificationAction, target: { id: string }): void {
    feed.markRead(target.id);
    if (action.kind === "dispatch") {
      console.info(`[actions] "${action.label}" (dispatch) — coming soon`);
    } else {
      // "link" — or a legacy action persisted before `kind` existed (treated as link).
      window.open(action.url, "_blank", "noopener,noreferrer");
    }
  }
  return { runAction };
}
```

- [ ] **Step 4: Refactor `InboxTab.vue`** — replace the inline `onAction` (lines ~52–64) with the composable, preserving the template `@action="onAction"`:

```ts
import { useNotificationActions } from "@/composables/useNotificationActions";
// ...
const { runAction } = useNotificationActions();
function onAction(action: NotificationAction, notification: FeedNotification) {
  runAction(action, { id: notification.id });
}
```

(Keep `NotificationAction`/`FeedNotification` imports; the `feed.markRead` call now lives in the composable.)

- [ ] **Step 5: Run tests** — Run: `pnpm --filter @notifications/frontend test useNotificationActions InboxTab && pnpm --filter @notifications/frontend typecheck` — Expected: PASS (the existing InboxTab action test still green).
- [ ] **Step 6: Commit** — `refactor(frontend): shared useNotificationActions composable`

### Task 7: Chat store parses the `sources` frame

**Files:** Modify `frontend/src/stores/chat.ts`, `frontend/src/stores/chat.spec.ts`.

**Interfaces:**

- Consumes: `ChatSource` (`@notifications/core`).
- Produces: each AI `Turn` gains `sources: Record<string, ChatSource>` (ref→source); the parser handles `event: sources` frames.

- [ ] **Step 1: Write the failing test** — add to `frontend/src/stores/chat.spec.ts`:

```ts
it("parses a sources frame into the ai turn's sources map", async () => {
  const sources = [
    { ref: "n1", id: "a1", title: "Acme DSAR", priority: "critical", ageMinutes: 10, actions: [] },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      streamResponse([
        `event: sources\ndata: ${JSON.stringify(sources)}\n\n`,
        'data: {"delta":"See "}\n\n',
        'data: {"delta":"[n1]"}\n\n',
        'data: {"done":true}\n\n',
      ]),
    ),
  );
  const store = useChatStore();
  await store.send("hi");
  const ai = store.thread[1]!;
  expect(ai.text).toBe("See [n1]");
  expect(ai.sources.n1?.title).toBe("Acme DSAR");
});
```

- [ ] **Step 2: Run it to verify it fails** — Run: `pnpm --filter @notifications/frontend test chat` — Expected: FAIL (`sources` undefined).

- [ ] **Step 3: Implement** `frontend/src/stores/chat.ts` — import the type, extend `Turn`, populate the map. Replace the top + the frame loop:

```ts
import { reactive, ref } from "vue";
import { defineStore } from "pinia";
import type { ChatSource } from "@notifications/core";

type Turn = { from: "me" | "ai"; text: string; sources: Record<string, ChatSource> };
const MAX_HISTORY = 8;
```

Where the AI turn is created:

```ts
const ai = reactive<Turn>({ from: "ai", text: "", sources: {} });
```

The user turn also needs the field (keep types uniform):

```ts
thread.push({ from: "me", text: q, sources: {} });
```

Inside the frame loop, handle the `sources` event before the generic data-line handling:

```ts
for (const frame of frames) {
  if (frame.startsWith("event: error")) {
    errored = true;
    continue;
  }
  const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) continue;
  const payload = dataLine.slice(5).trim();
  if (frame.startsWith("event: sources")) {
    try {
      const list = JSON.parse(payload) as ChatSource[];
      for (const s of list) ai.sources[s.ref] = s;
    } catch {
      /* ignore */
    }
    continue;
  }
  try {
    const json = JSON.parse(payload) as { delta?: string; done?: boolean };
    if (typeof json.delta === "string") ai.text += json.delta;
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes** — Run: `pnpm --filter @notifications/frontend test chat && pnpm --filter @notifications/frontend typecheck` — Expected: PASS (existing chat tests still pass — they use `data:` delta frames unaffected by the new branch).
- [ ] **Step 5: Commit** — `feat(frontend): chat store parses the sources frame`

### Task 8: CitationChip + AssistantTab renders chips

**Files:** Create `frontend/src/features/notifications/panel/CitationChip.vue`, `frontend/src/features/notifications/panel/CitationChip.spec.ts`; Modify `frontend/src/features/notifications/panel/AssistantTab.vue`, `frontend/src/features/notifications/panel/AssistantTab.spec.ts`.

**Interfaces:**

- Consumes: `ChatSource` (`@notifications/core`), `useNotificationActions`.
- Produces: `<CitationChip :source="ChatSource" />`; `AssistantTab` splits AI text on `/(\[n\d+\])/` and renders chips for known refs.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/notifications/panel/CitationChip.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const { runActionSpy } = vi.hoisted(() => ({ runActionSpy: vi.fn() }));
vi.mock("@/composables/useNotificationActions", () => ({
  useNotificationActions: () => ({ runAction: runActionSpy }),
}));

const CitationChip = (await import("./CitationChip.vue")).default;

const source = {
  ref: "n1",
  id: "a1",
  title: "Acme DSAR",
  priority: "critical" as const,
  ageMinutes: 10,
  actions: [{ label: "Open", kind: "link" as const, method: "GET" as const, url: "https://x/1" }],
};

describe("CitationChip", () => {
  it("shows the title and expands to action buttons that call runAction", async () => {
    const wrapper = mount(CitationChip, { props: { source } });
    expect(wrapper.text()).toContain("Acme DSAR");
    // collapsed: no action button yet
    expect(wrapper.find('[data-test="chip-action"]').exists()).toBe(false);
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    const btn = wrapper.find('[data-test="chip-action"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(runActionSpy).toHaveBeenCalledWith(source.actions[0], { id: "a1" });
  });

  it("an action-less source expands but shows no buttons", async () => {
    const wrapper = mount(CitationChip, { props: { source: { ...source, actions: [] } } });
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    expect(wrapper.find('[data-test="chip-action"]').exists()).toBe(false);
  });
});
```

Add to `AssistantTab.spec.ts` (a chip-render test) — the mocked chat store's thread gains `sources`:

```ts
it("renders [n#] markers with a matching source as citation chips", () => {
  chatState.thread = [
    { from: "me", text: "hi", sources: {} },
    {
      from: "ai",
      text: "The Acme DSAR [n1] is overdue; [n9] is unknown.",
      sources: {
        n1: {
          ref: "n1",
          id: "a1",
          title: "Acme DSAR",
          priority: "critical",
          ageMinutes: 5,
          actions: [],
        },
      },
    },
  ];
  const wrapper = mount(AssistantTab);
  // known ref → a chip labelled with the title
  expect(wrapper.find('[data-test="chip-toggle"]').text()).toContain("Acme DSAR");
  // unknown ref → left as plain text
  expect(wrapper.text()).toContain("[n9]");
});
```

(Update the other AssistantTab tests' `chatState.thread` items to include `sources: {}`, and the hoisted `chatState.thread` initial type to `{ from: "me" | "ai"; text: string; sources: Record<string, unknown> }[]`.)

- [ ] **Step 2: Run to verify they fail** — Run: `pnpm --filter @notifications/frontend test CitationChip AssistantTab` — Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/features/notifications/panel/CitationChip.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";
import type { ChatSource } from "@notifications/core";
import { actionIcon } from "@/design/icons";
import Icon from "@/components/ui/Icon.vue";
import { useNotificationActions } from "@/composables/useNotificationActions";

const props = defineProps<{ source: ChatSource }>();
const open = ref(false);
const { runAction } = useNotificationActions();

// Priority → dot color, mirroring the notification card's convention.
const dotClass: Record<ChatSource["priority"], string> = {
  critical: "bg-danger",
  high: "bg-warning",
  normal: "bg-muted",
  low: "ring-1 ring-line-strong",
};

function age(minutes: number): string {
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)}d` : `${Math.floor(minutes / 60)}h`;
}
</script>

<template>
  <span class="inline-flex flex-col align-baseline">
    <button
      type="button"
      data-test="chip-toggle"
      class="ai-bubble-border inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-text hover:bg-sunken"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="size-1.5 rounded-full" :class="dotClass[props.source.priority]" />
      {{ props.source.title }}
    </button>

    <span
      v-if="open"
      class="mt-1 flex flex-col gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2 text-[12px]"
    >
      <span class="text-muted"
        >{{ props.source.priority }} · {{ age(props.source.ageMinutes) }} old</span
      >
      <span v-if="props.source.actions.length" class="flex flex-wrap gap-2">
        <button
          v-for="action in props.source.actions"
          :key="action.label + action.url"
          type="button"
          data-test="chip-action"
          class="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 font-medium text-text hover:bg-sunken"
          @click="runAction(action, { id: props.source.id })"
        >
          <Icon v-if="actionIcon(action.icon)" :icon="actionIcon(action.icon)!" :size="13" />
          {{ action.label }}
        </button>
      </span>
    </span>
  </span>
</template>
```

Modify `AssistantTab.vue` — add a `segments(text)` helper and render segments; import `CitationChip`:

In `<script setup>`:

```ts
import CitationChip from "./CitationChip.vue";
// ...
// Split an answer into literal text and [n#] citation tokens; a token maps to a chip only when the
// turn actually carries that source (unknown refs stay as plain text).
function segments(text: string): { kind: "text" | "ref"; value: string }[] {
  return text
    .split(/(\[n\d+\])/)
    .filter((s) => s !== "")
    .map((s) =>
      /^\[n\d+\]$/.test(s)
        ? { kind: "ref" as const, value: s.slice(1, -1) }
        : { kind: "text" as const, value: s },
    );
}
```

Replace the AI bubble's text interpolation (`{{ m.text }}` plus the streaming ellipsis) so it renders segments. In the `<p …>` for AI bubbles, replace the text node with:

```vue
<template v-for="(seg, si) in segments(m.text)" :key="si">
  <CitationChip v-if="seg.kind === 'ref' && m.sources[seg.value]" :source="m.sources[seg.value]!" />
  <template v-else-if="seg.kind === 'ref'">[{{ seg.value }}]</template>
  <template v-else>{{ seg.value }}</template>
</template>
```

(Keep the leading `<Icon v-if="m.from === 'ai'" …>` and the streaming `…` span. `m.sources` is on the store's `Turn`; for `me` turns it's `{}`, and `segments` on a user message with no `[n#]` just yields one text segment.)

- [ ] **Step 4: Run the tests + typecheck** — Run: `pnpm --filter @notifications/frontend test CitationChip AssistantTab chat && pnpm --filter @notifications/frontend typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(frontend): inline citation chips with action buttons in chat`

---

## Unit E — e2e + docs

### Task 9: e2e — chip appears, expands, shows an action button

**Files:** Modify `frontend/e2e/ai-chat.spec.ts`.

- [ ] **Step 1: Update the test** — seed the notification WITH a link action, and after the answer resolves, assert a citation chip appears, expand it, and assert an action button. Change the publish payload to include actions and add the chip assertions after the existing answer-visible assertion:

```ts
      data: {
        id: `ai-chat-${Date.now()}`,
        module: "dsr",
        title: `Chat seed ${Date.now()}`,
        description: "seed for the AI chat e2e",
        priority: "critical",
        snoozable: true,
        actions: [{ label: "Open", kind: "link", method: "GET", url: "https://example.com/x" }],
        audience: { scope: "global" },
      },
```

After the answer assertion:

```ts
// The fake provider cites [n1] → a citation chip renders; expanding it shows the action button.
const chip = page.locator('[data-test="chip-toggle"]');
await expect(chip.first()).toBeVisible({ timeout: 20_000 });
await chip.first().click();
await expect(page.locator('[data-test="chip-action"]').first()).toBeVisible();
```

- [ ] **Step 2: Run it** — Run: `pnpm test:e2e ai-chat` — Expected: PASS (webServer sets `AI_PROVIDER=fake`; the fake answer cites `[n1]`, and `n1` is the seeded notification with the action).
- [ ] **Step 3: Commit** — `test(e2e): AI chat citation chip exposes a real action button`

### Task 10: Docs + final verification

**Files:** Update `docs/api/notifications.md` (via **docs-writer**).

- [ ] **Step 1: Dispatch docs-writer** to update the `POST /notifications/chat` section: the streaming response now begins with an `event: sources\ndata: [ChatSource...]` frame (each `ChatSource = { ref, id, title, priority, ageMinutes, actions }`, drawn from the same audience-scoped grounding set, actions being the notification's real actions) before the `data:{delta}` frames; the model cites items inline as `[n#]`; the client renders cited refs as action-bearing chips. Note that `sources` is audience-scoped (no cross-audience leak) and not logged.
- [ ] **Step 2: Whole-repo verification**

Run: `pnpm -r test && pnpm typecheck && pnpm lint && pnpm -r build` — Expected: green (incl. `boundary.test.ts`). Then `pnpm test:e2e` (single clean run).

- [ ] **Step 3: Manual model check** — restart `pnpm dev` (real Ollama, so the new core is loaded), open Ask AI, ask "what are my most urgent notifications?" with at least one actionable notification seeded → confirm a streamed answer, and if the model cites an item, a chip with its action button. Confirm via `browser-tester`. (The real model may not always cite — the deterministic proof is the fake-provider e2e.)
- [ ] **Step 4: Commit** — `docs: document the chat sources frame + citations`

---

## Verification (whole-branch, before finishing)

1. `pnpm -r test` — core / server-fastify / backend / frontend green, incl. the new sources/chip tests and the unchanged boundary test.
2. `pnpm typecheck && pnpm lint && pnpm -r build` — clean.
3. `pnpm test:e2e` — the chip spec passes; existing specs still pass.
4. Manual: `pnpm dev` + Ollama → a streamed answer; a cited notification renders a chip with a working action button (`browser-tester`).
5. Reviews: `code-reviewer` (whole diff since the parent AI Q/A merge-base is still unmerged — review the new commits), then `security-reviewer` (the `sources` frame audience-scoping + that model text can't fabricate actions). Then mentor sign-off on the `AnswerChunk` shape + `sources` frame (bundled with the parent gate) → `/open-pr`.

## Out of scope (deliberate)

Making `dispatch` actions actually execute (server-side action proxy — its own later cycle); semantic retrieval; server-persisted history; the model performing actions itself.

## Self-Review

- **Spec coverage:** `actions` on the item → Task 1; `[n#]` tags + cite instruction → Task 2; `ChatSource`/`AnswerChunk` + sources-first `answer` → Task 3; `event: sources` frame → Task 4; fake provider cites `[n1]` → Task 5; shared `useNotificationActions` → Task 6; store parses sources → Task 7; `CitationChip` + AssistantTab chips → Task 8; e2e → Task 9; docs + verification → Task 10. Audience isolation on `sources` tested in Tasks 3 + 4. Dispatch-same-as-card honored by the composable (Task 6). No new query, no core env/identity. No gaps.
- **Placeholder scan:** every code step carries real code; the docs step delegates to docs-writer with the exact contract.
- **Type consistency:** `ChatSource { ref; id; title; priority; ageMinutes; actions }`, `AnswerChunk` union, `buildChatMessages(context, refs, history, question)` (refs = `{ ref; id }[]`), `useNotificationActions().runAction(action, { id })`, and the `Turn.sources: Record<string, ChatSource>` map are named identically across defining and consuming tasks. The route advances the async iterator once pre-hijack (unchanged) — the first chunk is now `sources`, and gate/rate-limit still throw before it.
