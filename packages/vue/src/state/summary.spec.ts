import { describe, expect, it, vi } from "vitest";
import { createSummaryState } from "./summary";
import { ApiError } from "../transport/cookie-transport";
import type { Transport } from "../transport/types";

const fakeTransport = (over: Partial<Record<keyof Transport, unknown>> = {}): Transport =>
  ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over }) as Transport;

describe("summary state", () => {
  it("fetchStored → empty when the server has no summary yet", async () => {
    const get = vi.fn(async () => ({ summary: null, basedOn: 0, generatedAt: null }));
    const s = createSummaryState({ transport: fakeTransport({ get }) });
    await s.fetchStored();
    expect(get).toHaveBeenCalledWith("/notifications/summary");
    expect(s.status).toBe("empty");
  });

  it("fetchStored → ready with summary + timestamp", async () => {
    const get = vi.fn(async () => ({
      summary: "digest",
      basedOn: 3,
      generatedAt: "2026-07-31T08:00:00.000Z",
    }));
    const s = createSummaryState({ transport: fakeTransport({ get }) });
    await s.fetchStored();
    expect(s.status).toBe("ready");
    expect(s.summary).toBe("digest");
    expect(s.basedOn).toBe(3);
    expect(s.generatedAt).toBe("2026-07-31T08:00:00.000Z");
  });

  it("refresh POSTs and updates the summary + timestamp", async () => {
    const post = vi.fn(async () => ({
      summary: "fresh",
      basedOn: 5,
      generatedAt: "2026-07-31T09:00:00.000Z",
    }));
    const s = createSummaryState({ transport: fakeTransport({ post }) });
    await s.refresh();
    expect(post).toHaveBeenCalledWith("/notifications/summary/refresh", {});
    expect(s.status).toBe("ready");
    expect(s.summary).toBe("fresh");
    expect(s.generatedAt).toBe("2026-07-31T09:00:00.000Z");
    expect(s.refreshing).toBe(false);
  });

  it("surfaces an ApiError message on a failed fetch", async () => {
    const get = vi.fn(async () => {
      throw new ApiError(502, "summary unavailable");
    });
    const s = createSummaryState({ transport: fakeTransport({ get }) });
    await s.fetchStored();
    expect(s.status).toBe("error");
    expect(s.error).toBe("summary unavailable");
  });
});
