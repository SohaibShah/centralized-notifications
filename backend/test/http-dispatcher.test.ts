import { describe, expect, it, vi } from "vitest";
import { createHttpActionDispatcher } from "../src/reference/http-dispatcher";

describe("createHttpActionDispatcher", () => {
  it("POSTs the composed url with the dispatch token header and parses JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const d = createHttpActionDispatcher({ token: "secret", fetchImpl });
    const out = await d.dispatch({
      url: "http://localhost:4000/dsr/actions/approve",
      method: "POST",
      body: { a: 1 },
    });
    expect(out).toEqual({ status: 200, body: { ok: true } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:4000/dsr/actions/approve");
    expect(init.headers["x-module-dispatch-token"]).toBe("secret");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("returns a non-2xx status without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const out = await createHttpActionDispatcher({ token: "s", fetchImpl }).dispatch({
      url: "http://x/y",
      method: "POST",
      body: {},
    });
    expect(out.status).toBe(500);
    expect(out.body).toBeNull();
  });

  it("returns null body for a non-JSON / empty response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const out = await createHttpActionDispatcher({ token: "s", fetchImpl }).dispatch({
      url: "http://x/y",
      method: "GET",
      body: undefined,
    });
    expect(out).toEqual({ status: 200, body: null });
  });

  it("returns null body for a non-JSON response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const out = await createHttpActionDispatcher({ token: "s", fetchImpl }).dispatch({
      url: "http://x/y",
      method: "GET",
      body: undefined,
    });
    expect(out).toEqual({ status: 200, body: null });
  });

  it("does not send a body for GET requests", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await createHttpActionDispatcher({ token: "s", fetchImpl }).dispatch({
      url: "http://x/y",
      method: "GET",
      body: { ignored: true },
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.body).toBeUndefined();
  });
});
