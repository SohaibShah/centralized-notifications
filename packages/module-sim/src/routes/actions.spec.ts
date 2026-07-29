import { describe, expect, it } from "vitest";
import { buildApp } from "../app";

const cfg = {
  hubUrl: "http://localhost:3000",
  intakeToken: "intake-token-abcdefgh",
  dispatchToken: "d",
  port: 4000,
};

describe("POST|GET /:module/actions/:name", () => {
  it("rejects a dispatch without the correct token (401)", async () => {
    const app = buildApp(cfg);

    const missing = await app.inject({
      method: "POST",
      url: "/dsr/actions/approve",
      payload: { notificationId: "n1" },
    });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "POST",
      url: "/dsr/actions/approve",
      headers: { "x-module-dispatch-token": "wrong", "content-type": "application/json" },
      payload: { notificationId: "n1" },
    });
    expect(wrong.statusCode).toBe(401);

    const correct = await app.inject({
      method: "POST",
      url: "/dsr/actions/approve",
      headers: { "x-module-dispatch-token": "d", "content-type": "application/json" },
      payload: { notificationId: "n-token-check" },
    });
    expect(correct.statusCode).not.toBe(401);
  });

  it("dsr approve resolves the first time, errors the second", async () => {
    const app = buildApp({ ...cfg, dispatchToken: "d" });
    const headers = { "x-module-dispatch-token": "d", "content-type": "application/json" };

    const first = await app.inject({
      method: "POST",
      url: "/dsr/actions/approve",
      headers,
      payload: { notificationId: "n1", metadata: { requestId: "r1" } },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, resolve: true });

    const second = await app.inject({
      method: "POST",
      url: "/dsr/actions/approve",
      headers,
      payload: { notificationId: "n1", metadata: { requestId: "r1" } },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: false });
  });

  it("unknown module -> 404", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({
      method: "POST",
      url: "/nope/actions/x",
      headers: { "x-module-dispatch-token": "d", "content-type": "application/json" },
      payload: { notificationId: "n1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("unknown action -> 404", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({
      method: "POST",
      url: "/dsr/actions/nope",
      headers: { "x-module-dispatch-token": "d", "content-type": "application/json" },
      payload: { notificationId: "n1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a malformed body does not crash the process", async () => {
    const app = buildApp(cfg);
    const headers = { "x-module-dispatch-token": "d", "content-type": "application/json" };

    const malformed = await app.inject({
      method: "POST",
      url: "/dsr/actions/approve",
      headers,
      payload: { notificationId: 12345 },
    });
    expect(malformed.json()).toMatchObject({ ok: false });

    // The app must still answer a subsequent, well-formed request.
    const follow = await app.inject({
      method: "POST",
      url: "/dsr/actions/approve",
      headers,
      payload: { notificationId: "n-after-malformed" },
    });
    expect(follow.statusCode).toBe(200);
    expect(follow.json()).toMatchObject({ ok: true });
  });

  it("access-governance revoke, data-mapping rescan, assessments snooze respond ok", async () => {
    const app = buildApp(cfg);
    const headers = { "x-module-dispatch-token": "d", "content-type": "application/json" };

    const revoke = await app.inject({
      method: "POST",
      url: "/access-governance/actions/revoke",
      headers,
      payload: { notificationId: "n1" },
    });
    expect(revoke.json()).toMatchObject({ ok: true, resolve: true });

    const rescan = await app.inject({
      method: "POST",
      url: "/data-mapping/actions/rescan",
      headers,
      payload: { notificationId: "n1" },
    });
    expect(rescan.json()).toMatchObject({ ok: true });
    expect(rescan.json().resolve).toBeUndefined();

    const snooze = await app.inject({
      method: "POST",
      url: "/assessments/actions/snooze",
      headers,
      payload: { notificationId: "n1" },
    });
    expect(snooze.json()).toMatchObject({ ok: true });
    expect(snooze.json().resolve).toBeUndefined();
  });
});
