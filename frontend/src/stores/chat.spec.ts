import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "./chat";

/** A streaming Response whose body emits the given SSE text (optionally split across reads). */
function streamResponse(frames: string[], init: { ok?: boolean; status?: number } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(f));
      c.close();
    },
  });
  return { ok: init.ok ?? true, status: init.status ?? 200, body } as unknown as Response;
}

describe("chat store", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.unstubAllGlobals());

  it("streams deltas into an ai turn and settles idle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          'data: {"delta":"Hel"}\n\n',
          'data: {"delta":"lo"}\n\n',
          'data: {"done":true}\n\n',
        ]),
      ),
    );
    const store = useChatStore();
    await store.send("hi");
    expect(store.thread).toHaveLength(2);
    expect(store.thread[0]).toEqual({ from: "me", text: "hi", sources: {} });
    expect(store.thread[1]!.from).toBe("ai");
    expect(store.thread[1]!.text).toBe("Hello");
    expect(store.status).toBe("idle");
  });

  it("shows the off message and errors on a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, body: null }) as unknown as Response),
    );
    const store = useChatStore();
    await store.send("hi");
    expect(store.thread[1]!.text).toBe("AI chat is turned off.");
    expect(store.status).toBe("error");
  });

  it("marks the turn errored on a mid-stream error frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse(['event: error\ndata: {"error":"stream failed"}\n\n'])),
    );
    const store = useChatStore();
    await store.send("hi");
    expect(store.status).toBe("error");
    expect(store.thread[1]!.text).toBe("The answer stream failed.");
  });

  it("parses a sources frame into the ai turn's sources map", async () => {
    const sources = [
      {
        ref: "n1",
        id: "a1",
        title: "Acme DSAR",
        priority: "critical",
        ageMinutes: 10,
        actions: [],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          `event: sources\ndata: ${JSON.stringify(sources)}\n\n`,
          'data: {"delta":"See "}\n\n',
          'data: {"delta":"[n1]"}\n\n',
          'data: {"done":true}\n\n',
        ]),
      ),
    );
    const store = useChatStore();
    await store.send("hi");
    const ai = store.thread[1]!;
    expect(ai.text).toBe("See [n1]");
    expect(ai.sources.n1?.title).toBe("Acme DSAR");
  });

  it("bounds the history sent with each question to 8 turns", async () => {
    const fetchSpy = vi.fn(async () =>
      streamResponse(['data: {"delta":"ok"}\n\n', 'data: {"done":true}\n\n']),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const store = useChatStore();
    // Pre-fill the thread with 20 turns.
    for (let i = 0; i < 10; i++) {
      await store.send(`q${i}`);
    }
    const lastCall = fetchSpy.mock.calls.at(-1) as unknown as [string, RequestInit];
    const body = JSON.parse(lastCall[1].body as string) as { history: unknown[] };
    expect(body.history.length).toBeLessThanOrEqual(8);
  });
});
