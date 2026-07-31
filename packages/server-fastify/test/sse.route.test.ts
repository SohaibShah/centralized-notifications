import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import {
  createNotificationService,
  type NotificationService,
  type Principal,
} from "@notifications/core";
import { notificationFastifyPlugin } from "../src/index";
import { testPool } from "./harness";

function fakeAuth(req: FastifyRequest): Principal | null {
  const userKey = req.headers["x-test-user"];
  if (typeof userKey !== "string" || userKey === "") return null;
  return { userKey, roles: [], teamKeys: [] };
}

const pool = testPool();
let app: FastifyInstance;
let svc: NotificationService;
let baseUrl: string;

beforeAll(async () => {
  svc = createNotificationService({ pool, config: { modules: [{ id: "dsr", label: "DSR" }] } });
  await svc.ready();
  app = Fastify({ maxParamLength: 256 });
  await app.register(notificationFastifyPlugin, {
    service: svc,
    auth: fakeAuth,
    intakeAuth: () => true,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

/** Read the SSE stream until `predicate(accumulated)` is true or the timeout elapses. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (buf: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (predicate(buf)) return buf;
  }
  return buf;
}

test("a subscribed principal receives a matching global notification as an SSE frame", async () => {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/sse`, {
    headers: { "x-test-user": "priya" },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();

  // Wait for the stream to be open before publishing (the hub is live-only).
  await readUntil(reader, (b) => b.includes(": connected"));

  const id = `sse-${Date.now()}`;
  const notif: Notification = {
    id,
    module: "dsr",
    title: id,
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "global" },
  };
  await svc.ingest(notif);

  const stream = await readUntil(
    reader,
    (b) => b.includes("event: notifications") && b.includes(id),
  );
  expect(stream).toContain("event: notifications");
  expect(stream).toContain(id);

  controller.abort();
});

test("a muted target's notifications are not streamed, regardless of priority/snoozable", async () => {
  // Mute the 'noisy' CATEGORY for this user BEFORE connecting, so the rule is loaded at connect time.
  // (A category mute lets us prove suppression + liveness with the single test module.)
  const principal = { userKey: "mutestreamer", roles: [], teamKeys: [] } as const;
  await svc.putMuteRule({ principal, targetKind: "category", target: "noisy", until: null });

  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/sse`, {
    headers: { "x-test-user": principal.userKey },
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  await readUntil(reader, (b) => b.includes(": connected"));

  const suffix = Date.now();
  const mutedCritId = `sse-muted-crit-${suffix}`; // muted category + critical + non-snoozable
  const passId = `sse-pass-${suffix}`; // different category → streams (proves the stream is live)
  const base = {
    module: "dsr",
    title: "t",
    description: "",
    audience: { scope: "global" },
  } as const;
  await svc.ingest({
    ...base,
    id: mutedCritId,
    priority: "critical",
    snoozable: false,
    category: "noisy",
  });
  await svc.ingest({ ...base, id: passId, priority: "high", snoozable: true, category: "other" });

  // The unmuted-category one arrives; by then the muted (even though critical + non-snoozable) one
  // has already been filtered out of the stream.
  const stream = await readUntil(reader, (b) => b.includes(passId));
  expect(stream).toContain(passId);
  expect(stream).not.toContain(mutedCritId);

  controller.abort();
});

test("GET /sse without auth → 401", async () => {
  const res = await fetch(`${baseUrl}/sse`);
  expect(res.status).toBe(401);
});
