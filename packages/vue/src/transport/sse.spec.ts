import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSse } from "./sse";

class ESStub {
  static last: ESStub | undefined;
  static readonly CLOSED = 2;
  url: string;
  readyState = 0;
  CLOSED = 2;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    ESStub.last = this;
  }
  addEventListener(t: string, cb: (e: MessageEvent) => void) {
    (this.listeners[t] ??= []).push(cb);
  }
  emit(t: string, data: string) {
    for (const cb of this.listeners[t] ?? []) cb(new MessageEvent(t, { data }));
  }
  close() {}
}

describe("connectSse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens baseUrl+/sse and delivers a validated batch", () => {
    vi.stubGlobal("EventSource", ESStub as unknown as typeof EventSource);
    const batches: unknown[] = [];
    connectSse("https://api.example", { onBatch: (b) => batches.push(b) });
    expect(ESStub.last!.url).toBe("https://api.example/sse");
    const n = {
      id: "a",
      module: "dsr",
      title: "t",
      description: "",
      priority: "high",
      snoozable: false,
      audience: { scope: "global" },
    };
    ESStub.last!.emit("notifications", JSON.stringify([n]));
    expect(batches[0]).toHaveLength(1);
  });

  it("drops a malformed frame without throwing", () => {
    vi.stubGlobal("EventSource", ESStub as unknown as typeof EventSource);
    const batches: unknown[] = [];
    connectSse("", { onBatch: (b) => batches.push(b) });
    ESStub.last!.emit("notifications", "not json");
    ESStub.last!.emit("notifications", JSON.stringify([{ bogus: true }]));
    expect(batches).toHaveLength(0);
  });
});
