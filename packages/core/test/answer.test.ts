import { afterAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
} from "../src/ai/errors";
import { AnswerEngine, type AnswerChunk } from "../src/ai/answer";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import type { AiMessage, AiProvider, Principal, Settings } from "../src/types";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

const on: Settings = {
  aiSummaryEnabled: true,
  chatbotEnabled: true,
  groupingEnabled: true,
  actionsEnabled: true,
  retentionDays: 30,
};

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function seed(userScope: string, id: string, title = id): Promise<void> {
  const n: Notification = {
    id,
    module: "dsr",
    title,
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "user", id: userScope },
  };
  await persist(query, n, false);
}

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

const helloProvider: AiProvider = {
  complete: async () => "x",
  completeStream: async function* () {
    yield "Hel";
    yield "lo";
  },
};

test("chatbotEnabled false → AiDisabledError, provider not called", async () => {
  let called = false;
  const provider: AiProvider = {
    complete: async () => "x",
    completeStream: async function* () {
      called = true;
      yield "x";
    },
  };
  const engine = new AnswerEngine({
    query,
    getSettings: async () => ({ ...on, chatbotEnabled: false }),
    provider,
  });
  await expect(
    collect(
      engine.answer({
        principal: { userKey: `d-${stamp}`, roles: [], teamKeys: [] },
        question: "q",
        history: [],
      }),
    ),
  ).rejects.toBeInstanceOf(AiDisabledError);
  expect(called).toBe(false);
});

test("no provider → AiNotConfiguredError", async () => {
  const engine = new AnswerEngine({ query, getSettings: async () => on });
  await expect(
    collect(
      engine.answer({
        principal: { userKey: `nc-${stamp}`, roles: [], teamKeys: [] },
        question: "q",
        history: [],
      }),
    ),
  ).rejects.toBeInstanceOf(AiNotConfiguredError);
});

test("a provider WITHOUT completeStream → AiNotConfiguredError", async () => {
  const engine = new AnswerEngine({
    query,
    getSettings: async () => on,
    provider: { complete: async () => "x" },
  });
  await expect(
    collect(
      engine.answer({
        principal: { userKey: `ns-${stamp}`, roles: [], teamKeys: [] },
        question: "q",
        history: [],
      }),
    ),
  ).rejects.toBeInstanceOf(AiNotConfiguredError);
});

test("happy path streams the concatenated answer", async () => {
  const userKey = `ok-${stamp}`;
  await seed(userKey, `ok-a-${stamp}`);
  const engine = new AnswerEngine({ query, getSettings: async () => on, provider: helloProvider });
  const out = await collect(
    engine.answer({
      principal: { userKey, roles: [], teamKeys: [] },
      question: "what's up?",
      history: [],
    }),
  );
  expect(out).toBe("Hello");
});

test("audience isolation — one user's grounding never includes another's notification", async () => {
  const a: Principal = { userKey: `iso-a-${stamp}`, roles: [], teamKeys: [] };
  const secretTitle = `SECRET-${stamp}`;
  await seed(a.userKey, `iso-a-note-${stamp}`, "A visible note");
  await seed(`iso-b-${stamp}`, `iso-b-note-${stamp}`, secretTitle);

  // Echo provider: streams back the system prompt it received (which embeds the retrieved context).
  const echo: AiProvider = {
    complete: async () => "x",
    completeStream: async function* (messages: AiMessage[]) {
      yield messages[0]!.content;
    },
  };
  const engine = new AnswerEngine({ query, getSettings: async () => on, provider: echo });
  const echoed = await collect(engine.answer({ principal: a, question: secretTitle, history: [] }));
  expect(echoed).not.toContain(secretTitle);
  expect(echoed).toContain("A visible note");

  // The sources chunk itself must also be scoped to A — B's title never appears in it.
  const src = await sourcesOf(engine.answer({ principal: a, question: secretTitle, history: [] }));
  expect(src.sources.some((s) => s.title === secretTitle)).toBe(false);
  expect(src.sources.some((s) => s.title === "A visible note")).toBe(true);
});

test("emits a sources chunk first, carrying refs/ids/actions", async () => {
  const userKey = `src-${stamp}`;
  await persistWithAction(userKey, `src-a-${stamp}`, "Acme DSAR");
  const engine = new AnswerEngine({ query, getSettings: async () => on, provider: helloProvider });
  const it = engine
    .answer({ principal: { userKey, roles: [], teamKeys: [] }, question: "acme", history: [] })
    [Symbol.asyncIterator]();
  const first = await it.next();
  expect(first.done).toBe(false);
  const chunk = first.value as AnswerChunk;
  expect(chunk.type).toBe("sources");
  const src = (chunk as AnswerChunk & { type: "sources" }).sources.find(
    (s) => s.title === "Acme DSAR",
  );
  expect(src).toBeDefined();
  expect(src!.ref).toMatch(/^n\d+$/);
  expect(src!.actions).toEqual([
    { label: "Open", kind: "link", method: "GET", url: "https://x/1" },
  ]);
});

test("a completeStream that throws → AiProviderError", async () => {
  const userKey = `throw-${stamp}`;
  await seed(userKey, `throw-a-${stamp}`);
  const provider: AiProvider = {
    complete: async () => "x",
    completeStream: async function* () {
      yield "partial";
      throw new Error("model died");
    },
  };
  const engine = new AnswerEngine({ query, getSettings: async () => on, provider });
  await expect(
    collect(
      engine.answer({
        principal: { userKey, roles: [], teamKeys: [] },
        question: "q",
        history: [],
      }),
    ),
  ).rejects.toBeInstanceOf(AiProviderError);
});

test("over the rate limit → AiRateLimitError", async () => {
  const userKey = `rl-${stamp}`;
  await seed(userKey, `rl-a-${stamp}`);
  const engine = new AnswerEngine({ query, getSettings: async () => on, provider: helloProvider });
  const principal: Principal = { userKey, roles: [], teamKeys: [] };
  let limited = false;
  for (let i = 0; i < 12; i++) {
    try {
      await collect(engine.answer({ principal, question: "q", history: [] }));
    } catch (err) {
      if (err instanceof AiRateLimitError) {
        limited = true;
        break;
      }
      throw err;
    }
  }
  expect(limited).toBe(true);
});
