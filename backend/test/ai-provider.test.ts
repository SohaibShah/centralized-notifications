import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeProvider } from "../src/reference/ai/fake-provider";
import { createOpenAiProvider } from "../src/reference/ai/openai-provider";

const messages = [
  { role: "system" as const, content: "s" },
  { role: "user" as const, content: "u" },
];

describe("createFakeProvider", () => {
  it("resolves a non-empty deterministic string", async () => {
    const out = await createFakeProvider().complete(messages);
    expect(out.length).toBeGreaterThan(0);
  });

  it("streams a canned answer in chunks", async () => {
    const out: string[] = [];
    for await (const d of createFakeProvider().completeStream!([])) out.push(d);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join("")).toMatch(/notification/i);
  });
});

describe("createOpenAiProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /chat/completions with the model and returns the content", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiProvider({ baseUrl: "http://x/v1", model: "qwen2.5:7b" });
    expect(await provider.complete(messages)).toBe("hi");

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toMatch(/\/chat\/completions$/);
    expect(String((init as RequestInit).body)).toContain("qwen2.5:7b");
  });

  it("rejects on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => ({}),
      })) as unknown as typeof fetch,
    );
    const provider = createOpenAiProvider({ baseUrl: "http://x/v1", model: "m" });
    await expect(provider.complete(messages)).rejects.toThrow(/502/);
  });

  it("completeStream parses SSE delta chunks", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      "data: [DONE]\n\n";
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body })) as unknown as typeof fetch);
    const provider = createOpenAiProvider({ baseUrl: "http://x/v1", model: "m" });
    const out: string[] = [];
    for await (const d of provider.completeStream!([])) out.push(d);
    expect(out.join("")).toBe("Hello");
  });
});
