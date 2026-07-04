import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type { Notification } from "@notifications/shared";
import { hashPassword } from "../src/auth/password";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { DeliveryHub, deliveryHub } from "../src/delivery/hub";
import { CoalescingBuffer } from "../src/http/sse/coalescing-buffer";
import { ingest } from "../src/pipeline/ingest";
import { buildServer } from "../src/server";

function makeNotification(id: string): Notification {
  return {
    id,
    module: "test-module",
    title: "SSE test",
    description: "delivered live",
    priority: "normal",
    snoozable: true,
    audience: { scope: "global" },
  };
}

describe("DeliveryHub", () => {
  it("broadcast reaches every subscriber", () => {
    const hub = new DeliveryHub();
    const a: Notification[] = [];
    const b: Notification[] = [];
    hub.subscribe({ userId: "u1", deliver: (n) => a.push(n) });
    hub.subscribe({ userId: "u2", deliver: (n) => b.push(n) });
    hub.broadcast(makeNotification("n1"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("publishToRecipients delivers only to matching userIds", () => {
    const hub = new DeliveryHub();
    const a: Notification[] = [];
    const b: Notification[] = [];
    hub.subscribe({ userId: "alice", deliver: (n) => a.push(n) });
    hub.subscribe({ userId: "bob", deliver: (n) => b.push(n) });
    hub.publishToRecipients(["alice"], makeNotification("n1"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("unsubscribe stops further delivery", () => {
    const hub = new DeliveryHub();
    const received: Notification[] = [];
    const unsubscribe = hub.subscribe({ userId: "u1", deliver: (n) => received.push(n) });
    unsubscribe();
    hub.broadcast(makeNotification("n1"));
    expect(received).toHaveLength(0);
    expect(hub.subscriberCount).toBe(0);
  });

  it("a throwing subscriber does not break the publish or other subscribers", () => {
    const hub = new DeliveryHub();
    const received: Notification[] = [];
    hub.subscribe({
      userId: "bad",
      deliver: () => {
        throw new Error("boom");
      },
    });
    hub.subscribe({ userId: "good", deliver: (n) => received.push(n) });
    expect(() => hub.broadcast(makeNotification("n1"))).not.toThrow();
    expect(received).toHaveLength(1);
  });
});

describe("CoalescingBuffer", () => {
  afterEach(() => vi.useRealTimers());

  it("flushes items pushed within the window as one batch", () => {
    vi.useFakeTimers();
    const flushes: number[][] = [];
    const buffer = new CoalescingBuffer<number>(100, (batch) => flushes.push(batch));
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(flushes).toHaveLength(0); // nothing before the window elapses
    vi.advanceTimersByTime(100);
    expect(flushes).toEqual([[1, 2, 3]]);
  });

  it("starts a fresh window after each flush", () => {
    vi.useFakeTimers();
    const flushes: number[][] = [];
    const buffer = new CoalescingBuffer<number>(100, (batch) => flushes.push(batch));
    buffer.push(1);
    vi.advanceTimersByTime(100);
    buffer.push(2);
    vi.advanceTimersByTime(100);
    expect(flushes).toEqual([[1], [2]]);
  });

  it("close() cancels a pending flush and drops buffered items", () => {
    vi.useFakeTimers();
    const flushes: number[][] = [];
    const buffer = new CoalescingBuffer<number>(100, (batch) => flushes.push(batch));
    buffer.push(1);
    buffer.close();
    vi.advanceTimersByTime(1000);
    expect(flushes).toHaveLength(0);
  });
});

describe("GET /sse", () => {
  const PW = "test-sse-pass";
  const ID_PREFIX = "test-sse-";
  let app: FastifyInstance;
  let port: number;
  let sessionCookie: string;
  const openRequests: http.ClientRequest[] = [];

  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM users WHERE username = 't_sse'");
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${ID_PREFIX}%`]);
    await query(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('t_sse', 'SSE User', $1)",
      [await hashPassword(PW)],
    );
    app = await buildServer();
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as AddressInfo).port;

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "t_sse", password: PW },
    });
    // Forward the exact on-the-wire "session=<value>" pair (not the URL-decoded
    // .value), since the server URL-decodes the incoming Cookie header.
    const rawSetCookie = login.headers["set-cookie"];
    const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie[0] : rawSetCookie;
    sessionCookie = (setCookie ?? "").split(";")[0] ?? "";
    expect(sessionCookie).toMatch(/^session=.+/);
  });

  afterAll(async () => {
    for (const req of openRequests) req.destroy();
    app.server.closeAllConnections(); // don't let a live SSE socket hang app.close()
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${ID_PREFIX}%`]);
    await query("DELETE FROM users WHERE username = 't_sse'");
    await app.close();
    await closePool();
  });

  // Close each test's connection so it doesn't stay subscribed to the shared hub
  // singleton and receive the next test's broadcasts (keeps tests order-independent).
  afterEach(async () => {
    for (const req of openRequests) req.destroy();
    openRequests.length = 0;
    // Let the server observe the socket close and run its unsubscribe cleanup.
    await new Promise((r) => setTimeout(r, 50));
  });

  /** Open an SSE connection; returns a reader that accumulates the stream. */
  function openSse(cookie: string | null): Promise<{
    statusCode: number;
    waitFor: (predicate: (buf: string) => boolean, ms: number) => Promise<string>;
    buffer: () => string;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/sse",
          headers: cookie ? { Cookie: cookie } : {},
        },
        (res) => {
          let buf = "";
          let listeners: Array<() => void> = [];
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            buf += chunk;
            for (const fn of listeners) fn();
          });
          resolve({
            statusCode: res.statusCode ?? 0,
            buffer: () => buf,
            waitFor: (predicate, ms) =>
              new Promise((res2, rej2) => {
                const check = () => {
                  if (predicate(buf)) {
                    finish();
                    res2(buf);
                  }
                };
                const timer = setTimeout(() => {
                  finish();
                  rej2(new Error(`SSE wait timeout; buffer so far: ${buf}`));
                }, ms);
                const finish = () => {
                  clearTimeout(timer);
                  listeners = listeners.filter((l) => l !== check);
                };
                listeners.push(check);
                check();
              }),
          });
        },
      );
      req.on("error", reject);
      openRequests.push(req);
    });
  }

  function parseNotificationFrames(buf: string): Notification[][] {
    const frames: Notification[][] = [];
    const re = /event: notifications\ndata: (.+)\n\n/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(buf)) !== null) {
      frames.push(JSON.parse(match[1] as string) as Notification[]);
    }
    return frames;
  }

  it("rejects a connection with no session cookie (401)", async () => {
    const sse = await openSse(null);
    expect(sse.statusCode).toBe(401);
  });

  it("streams a newly ingested notification to a connected client", async () => {
    const sse = await openSse(sessionCookie);
    expect(sse.statusCode).toBe(200);
    await sse.waitFor((b) => b.includes(": connected"), 2000);

    await ingest(makeNotification(`${ID_PREFIX}live-1`));

    const buf = await sse.waitFor((b) => b.includes("event: notifications"), 2000);
    const frames = parseNotificationFrames(buf);
    expect(frames.flat().map((n) => n.id)).toContain(`${ID_PREFIX}live-1`);
  });

  it("coalesces a burst into a single batched frame", async () => {
    const sse = await openSse(sessionCookie);
    await sse.waitFor((b) => b.includes(": connected"), 2000);

    // Two synchronous broadcasts land in the same coalescing window on this connection.
    deliveryHub.broadcast(makeNotification(`${ID_PREFIX}burst-a`));
    deliveryHub.broadcast(makeNotification(`${ID_PREFIX}burst-b`));

    const buf = await sse.waitFor((b) => b.includes("event: notifications"), 2000);
    const frames = parseNotificationFrames(buf);
    expect(frames[0]).toHaveLength(2);
    expect(frames[0]?.map((n) => n.id)).toEqual([`${ID_PREFIX}burst-a`, `${ID_PREFIX}burst-b`]);
  });
});
