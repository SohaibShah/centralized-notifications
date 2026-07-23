import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ApiError } from "@/api/client";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return { ...actual, api: { ...actual.api, get: getMock } };
});
const { useSummaryStore } = await import("./summary");

describe("summary store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
  });

  it("fetches once and becomes ready", async () => {
    getMock.mockResolvedValueOnce({ summary: "S", basedOn: 2 });
    const s = useSummaryStore();
    await s.fetchSummary();
    expect(getMock).toHaveBeenCalledWith("/notifications/summary");
    expect(s.status).toBe("ready");
    expect(s.text).toBe("S");
  });

  it("does not refetch when already ready, unless forced", async () => {
    getMock.mockResolvedValue({ summary: "S", basedOn: 1 });
    const s = useSummaryStore();
    await s.fetchSummary();
    await s.fetchSummary(); // not forced → no-op
    expect(getMock).toHaveBeenCalledTimes(1);
    await s.fetchSummary(true); // forced
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces an ApiError message on failure", async () => {
    getMock.mockRejectedValueOnce(new ApiError(502, "summary unavailable"));
    const s = useSummaryStore();
    await s.fetchSummary();
    expect(s.status).toBe("error");
    expect(s.error).toBe("summary unavailable");
  });
});
