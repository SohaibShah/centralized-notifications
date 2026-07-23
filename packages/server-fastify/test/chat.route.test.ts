import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import {
  createNotificationService,
  type AiMessage,
  type AiProvider,
  type NotificationService,
  type Principal,
} from "@notifications/core";
import { notificationFastifyPlugin } from "../src/index";
import { testPool } from "./harness";

function fakeAuth(req: FastifyRequest): Principal | null {
  const userKey = req.headers["x-test-user"];
  return typeof userKey === "string" && userKey !== ""
    ? { userKey, roles: [], teamKeys: [] }
    : null;
}

const pool = testPool();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const helloProvider: AiProvider = {
  complete: async () => "x",
  completeStream: async function* () {
    yield "Hel";
    yield "lo";
  },
};

async function buildServer(
  provider?: AiProvider,
): Promise<{ app: FastifyInstance; svc: NotificationService; baseUrl: string }> {
  const svc = createNotificationService({
    pool,
    config: { modules: [{ id: "dsr", label: "DSR" }], ...(provider ? { ai: { provider } } : {}) },
  });
  await svc.ready();
  const app = Fastify({ maxParamLength: 256 });
  await app.register(notificationFastifyPlugin, {
    service: svc,
    auth: fakeAuth,
    intakeAuth: () => true,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  return { app, svc, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function seed(svc: NotificationService, userScope: string, id: string, title = id) {
  const n: Notification = {
    id,
    module: "dsr",
    title,
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "user", id: userScope },
  };
  await svc.ingest(n);
}

/** Read the whole SSE body of a chat response. */
async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  return buf;
}

let ok: { app: FastifyInstance; svc: NotificationService; baseUrl: string };
beforeAll(async () => {
  ok = await buildServer(helloProvider);
});
afterAll(async () => {
  await ok.svc.updateSettings({ chatbotEnabled: true }); // restore shared singleton
  await ok.app.close();
  await pool.end();
});

test("200 streams SSE deltas assembling the answer + a done frame", async () => {
  await seed(ok.svc, `croute-${stamp}`, `croute-a-${stamp}`);
  const res = await fetch(`${ok.baseUrl}/notifications/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": `croute-${stamp}` },
    body: JSON.stringify({ question: "what's urgent?" }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await readAll(res);
  const deltas = [...body.matchAll(/data: (\{.*\})/g)]
    .map((m) => JSON.parse(m[1]!) as { delta?: string; done?: boolean })
    .filter((f) => typeof f.delta === "string")
    .map((f) => f.delta)
    .join("");
  expect(deltas).toBe("Hello");
  expect(body).toContain('"done":true');
});

test("401 without auth", async () => {
  const res = await fetch(`${ok.baseUrl}/notifications/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "hi" }),
  });
  expect(res.status).toBe(401);
});

test("400 on an empty question", async () => {
  const res = await fetch(`${ok.baseUrl}/notifications/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": `croute-${stamp}` },
    body: JSON.stringify({ question: "" }),
  });
  expect(res.status).toBe(400);
});

test("404 when chatbotEnabled is false", async () => {
  await ok.svc.updateSettings({ chatbotEnabled: false });
  try {
    const res = await fetch(`${ok.baseUrl}/notifications/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": `croute-${stamp}` },
      body: JSON.stringify({ question: "hi" }),
    });
    expect(res.status).toBe(404);
  } finally {
    await ok.svc.updateSettings({ chatbotEnabled: true });
  }
});

test("501 when the provider has no completeStream", async () => {
  const { app, baseUrl } = await buildServer({ complete: async () => "x" });
  try {
    const res = await fetch(`${baseUrl}/notifications/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": `noprov-${stamp}` },
      body: JSON.stringify({ question: "hi" }),
    });
    expect(res.status).toBe(501);
  } finally {
    await app.close();
  }
});

test("audience isolation — another user's notification never enters the grounding", async () => {
  const secret = `SECRET-${stamp}`;
  const echo: AiProvider = {
    complete: async () => "x",
    completeStream: async function* (messages: AiMessage[]) {
      yield messages[0]!.content;
    },
  };
  const { app, svc, baseUrl } = await buildServer(echo);
  try {
    await seed(svc, `iso-a-${stamp}`, `iso-a-note-${stamp}`, "A visible note");
    await seed(svc, `iso-b-${stamp}`, `iso-b-note-${stamp}`, secret);
    const res = await fetch(`${baseUrl}/notifications/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": `iso-a-${stamp}` },
      body: JSON.stringify({ question: secret }),
    });
    expect(res.status).toBe(200);
    const body = await readAll(res);
    expect(body).not.toContain(secret);
    expect(body).toContain("A visible note");
  } finally {
    await app.close();
  }
});
