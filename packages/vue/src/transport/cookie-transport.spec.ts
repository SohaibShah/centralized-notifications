import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createCookieTransport } from "./cookie-transport";

describe("cookie transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefixes baseUrl, sends credentials, parses JSON", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ n: 1 }) }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const t = createCookieTransport("https://api.example");
    expect(await t.get("/notifications/counts")).toEqual({ n: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.example/notifications/counts");
    expect(init.credentials).toBe("include");
  });

  it("sends a JSON content-type + body on post", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await createCookieTransport("").post("/x", { a: 1 });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("throws ApiError carrying status + server error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "nope" }),
      })) as unknown as typeof fetch,
    );
    const t = createCookieTransport("");
    await expect(t.get("/x")).rejects.toBeInstanceOf(ApiError);
    await expect(t.get("/x")).rejects.toMatchObject({ status: 404, message: "nope" });
  });

  it("returns undefined for 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => ({}),
      })) as unknown as typeof fetch,
    );
    expect(await createCookieTransport("").del("/x")).toBeUndefined();
  });
});
