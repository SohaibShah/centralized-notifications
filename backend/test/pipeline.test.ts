import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Notification } from "@notifications/shared";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { ingest } from "../src/pipeline/ingest";
import * as persistModule from "../src/pipeline/persist";
import { buildServer } from "../src/server";
import { registerModule } from "./support";

const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN as string;
const PREFIX = "test-pipe-";
let app: FastifyInstance;

function makeNotification(id: string, overrides: Partial<Notification> = {}): Notification {
  return {
    id: `${PREFIX}${id}`,
    module: "test-module",
    title: "Test notification",
    description: "A test notification body about access approvals.",
    priority: "normal",
    snoozable: true,
    audience: { scope: "global" },
    ...overrides,
  };
}

async function countRows(id: string): Promise<number> {
  const res = await query<{ c: number }>(
    "SELECT count(*)::int AS c FROM notifications WHERE id = $1",
    [`${PREFIX}${id}`],
  );
  return res.rows[0]?.c ?? 0;
}

// `null` token means "send no token header" (a defaulted param can't express that,
// since passing `undefined` would fall back to the default). Always sends JSON so a
// primitive body still reaches the route as parsed JSON, not text/plain (415).
function publish(payload: unknown, token: string | null = intakeTokenValue) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-internal-token"] = token;
  return app.inject({
    method: "POST",
    url: "/internal/publish",
    headers,
    payload: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  await migrate();
  await registerModule("test-module");
  await query("DELETE FROM notifications WHERE id LIKE $1", [`${PREFIX}%`]);
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await query("DELETE FROM notifications WHERE id LIKE $1", [`${PREFIX}%`]);
  await app.close();
  await closePool();
});

describe("ingest pipeline", () => {
  it("rejects a malformed payload as invalid without throwing or persisting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await ingest({ title: "missing everything else" });
    expect(result.status).toBe("invalid");
    expect(result.id).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects a notification from an unknown module without persisting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const before = await countRows("unknown-1");
    const result = await ingest(makeNotification("unknown-1", { module: "no-such-module" }));
    expect(result.status).toBe("invalid");
    expect(warn).toHaveBeenCalled();
    expect(await countRows("unknown-1")).toBe(before); // nothing persisted
    warn.mockRestore();
  });

  it("propagates infrastructure errors instead of swallowing them as invalid", async () => {
    // Only *validation* failures become `invalid`; a real DB/infra error must
    // propagate so the transport can 5xx / leave a stream message pending for retry.
    const spy = vi
      .spyOn(persistModule, "persist")
      .mockRejectedValueOnce(new Error("db unavailable"));
    await expect(ingest(makeNotification("infra-1"))).rejects.toThrow("db unavailable");
    spy.mockRestore();
  });

  it("accepts and persists a valid new notification (row committed before return)", async () => {
    const result = await ingest(makeNotification("accept-1"));
    expect(result).toEqual({ status: "accepted", id: `${PREFIX}accept-1` });
    expect(await countRows("accept-1")).toBe(1);
  });

  it("dedupes on id: the same id twice is accepted then duplicate, inserted once", async () => {
    const n = makeNotification("dup-1", { title: "First write wins" });
    const first = await ingest(n);
    const second = await ingest({ ...n, title: "Second write is ignored" });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    expect(await countRows("dup-1")).toBe(1);
    // The conflicting write must not have overwritten the original row.
    const row = await query<{ title: string }>("SELECT title FROM notifications WHERE id = $1", [
      `${PREFIX}dup-1`,
    ]);
    expect(row.rows[0]?.title).toBe("First write wins");
  });

  it("persists the full contract including audience split and opaque jsonb", async () => {
    await ingest(
      makeNotification("shape-1", {
        priority: "high",
        category: "approvals",
        audience: { scope: "team", id: "privacy-ops" },
        actions: [{ label: "Open", method: "GET", url: "https://app/x" }],
        metadata: { requestId: "abc", riskScore: 42 },
      }),
    );
    const row = await query<{
      audience_scope: string;
      audience_id: string;
      actions: unknown;
      metadata: { riskScore: number };
    }>("SELECT audience_scope, audience_id, actions, metadata FROM notifications WHERE id = $1", [
      `${PREFIX}shape-1`,
    ]);
    expect(row.rows[0]?.audience_scope).toBe("team");
    expect(row.rows[0]?.audience_id).toBe("privacy-ops");
    expect(row.rows[0]?.metadata.riskScore).toBe(42);
    expect(Array.isArray(row.rows[0]?.actions)).toBe(true);
  });
});

describe("POST /internal/publish", () => {
  it("rejects a request with no internal token (401)", async () => {
    const res = await publish(makeNotification("auth-1"), null);
    expect(res.statusCode).toBe(401);
    expect(await countRows("auth-1")).toBe(0);
  });

  it("rejects a request with the wrong internal token (401)", async () => {
    const res = await publish(makeNotification("auth-2"), "definitely-the-wrong-token");
    expect(res.statusCode).toBe(401);
    expect(await countRows("auth-2")).toBe(0);
  });

  it("accepts a single valid notification with a valid token (200) and persists it", async () => {
    const res = await publish(makeNotification("http-1"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 1, duplicate: 0, invalid: 0 });
    expect(await countRows("http-1")).toBe(1);
  });

  it("handles a mixed batch per-item: [valid, duplicate, malformed] without failing the batch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const valid = makeNotification("batch-1");
    const res = await publish([valid, { ...valid }, { title: "no id" }]);
    warn.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 1, duplicate: 1, invalid: 1 });
    expect(res.json().results).toHaveLength(3);
    expect(await countRows("batch-1")).toBe(1);
  });

  it("rejects a non-object / non-array body with 400", async () => {
    const res = await publish("not a notification");
    expect(res.statusCode).toBe(400);
  });

  it("rejects an empty batch with 400", async () => {
    const res = await publish([]);
    expect(res.statusCode).toBe(400);
  });

  it("rejects an oversized batch with 400", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => makeNotification(`over-${i}`));
    const res = await publish(tooMany);
    expect(res.statusCode).toBe(400);
    // Nothing from the rejected batch should have been persisted.
    expect(await countRows("over-0")).toBe(0);
  });
});
