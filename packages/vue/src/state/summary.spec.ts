import { describe, expect, it, vi } from "vitest";
import { createSummaryState } from "./summary";
import { ApiError } from "../transport/cookie-transport";
import type { Transport } from "../transport/types";

const fakeTransport = (over: Partial<Record<keyof Transport, unknown>> = {}): Transport =>
  ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over }) as Transport;

describe("summary state", () => {
  it("fetches once and becomes ready", async () => {
    const get = vi.fn(async () => ({ summary: "S", basedOn: 2 }));
    const s = createSummaryState({ transport: fakeTransport({ get }) });
    await s.fetchSummary();
    expect(get).toHaveBeenCalledWith("/notifications/summary");
    expect(s.status).toBe("ready");
    expect(s.text).toBe("S");
  });

  it("does not refetch when already ready, unless forced", async () => {
    const get = vi.fn(async () => ({ summary: "S", basedOn: 1 }));
    const s = createSummaryState({ transport: fakeTransport({ get }) });
    await s.fetchSummary();
    await s.fetchSummary(); // not forced → no-op
    expect(get).toHaveBeenCalledTimes(1);
    await s.fetchSummary(true); // forced
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("surfaces an ApiError message on failure", async () => {
    const get = vi.fn(async () => {
      throw new ApiError(502, "summary unavailable");
    });
    const s = createSummaryState({ transport: fakeTransport({ get }) });
    await s.fetchSummary();
    expect(s.status).toBe("error");
    expect(s.error).toBe("summary unavailable");
  });
});
