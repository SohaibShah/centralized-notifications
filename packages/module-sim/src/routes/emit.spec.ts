import { describe, expect, it, vi } from "vitest";
import type { Notification } from "@notifications/shared";
import { buildApp } from "../app";
import { lookupModule } from "../modules/registry";
import { PRESET_IDS } from "../generate";

const cfg = {
  hubUrl: "http://hub.internal:3000",
  intakeToken: "intake-token-abcdefgh",
  dispatchToken: "d",
  port: 4000,
};

function fakeFetch(status = 200): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ accepted: 0, duplicate: 0, invalid: 0, results: [] }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function expectDispatchActionsMatchCatalog(notification: Notification): void {
  const mod = lookupModule(notification.module);
  expect(mod).toBeDefined();
  const dispatchActions = (notification.actions ?? []).filter((a) => a.kind === "dispatch");
  expect(dispatchActions.length).toBeGreaterThan(0);
  for (const action of dispatchActions) {
    if (action.kind !== "dispatch") continue;
    const entry = mod?.catalog.find((c) => {
      const made = c.makeAction();
      return made.kind === "dispatch" && made.path === action.path;
    });
    expect(entry).toBeDefined();
    expect(entry?.method).toBe(action.method);
  }
}

describe("POST /emit", () => {
  it("burst: publishes `count` actionable notifications to the hub exactly once, with the intake token", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const app = buildApp(cfg, { fetchImpl });

    const res = await app.inject({
      method: "POST",
      url: "/emit",
      headers: { "content-type": "application/json" },
      payload: { mode: "burst", count: 3 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ published: 3 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${cfg.hubUrl}/internal/publish`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-internal-token"]).toBe(cfg.intakeToken);

    const body = JSON.parse(calls[0]!.init.body as string) as Notification[];
    expect(body).toHaveLength(3);
    for (const n of body) expectDispatchActionsMatchCatalog(n);
  });

  it("burst: count over MAX_BURST -> 400, and the hub is never called", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const app = buildApp(cfg, { fetchImpl });

    const res = await app.inject({
      method: "POST",
      url: "/emit",
      headers: { "content-type": "application/json" },
      payload: { mode: "burst", count: 10_000 },
    });

    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("preset: publishes a valid actionable batch", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const app = buildApp(cfg, { fetchImpl });

    const res = await app.inject({
      method: "POST",
      url: "/emit",
      headers: { "content-type": "application/json" },
      payload: { mode: "preset", preset: PRESET_IDS[0] },
    });

    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]!.init.body as string) as Notification[];
    expect(body.length).toBeGreaterThan(0);
    for (const n of body) expectDispatchActionsMatchCatalog(n);
    expect(res.json()).toEqual({ published: body.length });
  });

  it("custom: publishes one actionable notification built from provided fields + action names", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const app = buildApp(cfg, { fetchImpl });

    const res = await app.inject({
      method: "POST",
      url: "/emit",
      headers: { "content-type": "application/json" },
      payload: {
        mode: "custom",
        module: "dsr",
        title: "Custom alert",
        description: "Hand-built for QA",
        priority: "high",
        actions: ["approve"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ published: 1 });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]!.init.body as string) as Notification[];
    expect(body).toHaveLength(1);
    expect(body[0]!.title).toBe("Custom alert");
    expectDispatchActionsMatchCatalog(body[0]!);
  });

  it("custom: unknown action name for the module -> 400, hub never called", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const app = buildApp(cfg, { fetchImpl });

    const res = await app.inject({
      method: "POST",
      url: "/emit",
      headers: { "content-type": "application/json" },
      payload: {
        mode: "custom",
        module: "dsr",
        title: "Bad",
        description: "Bad",
        priority: "low",
        actions: ["not-a-real-action"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("malformed body -> 400, hub never called", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const app = buildApp(cfg, { fetchImpl });

    const res = await app.inject({
      method: "POST",
      url: "/emit",
      headers: { "content-type": "application/json" },
      payload: { mode: "nonsense" },
    });

    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("hub rejecting the publish surfaces as a 502, not a silent 200", async () => {
    const { fetchImpl } = fakeFetch(500);
    const app = buildApp(cfg, { fetchImpl });

    const res = await app.inject({
      method: "POST",
      url: "/emit",
      headers: { "content-type": "application/json" },
      payload: { mode: "burst", count: 1 },
    });

    expect(res.statusCode).toBe(502);
  });
});
