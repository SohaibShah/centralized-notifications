import { describe, expect, it } from "vitest";
import { computeDueSummaries, type DueUser } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("computeDueSummaries", () => {
  // 2026-07-31T02:45:00Z → Kolkata (+5:30) local 08:15, Kathmandu (+5:45) 08:30, London (BST) 03:45.
  const now = at("2026-07-31T02:45:00.000Z");
  const time = "08:00";

  it("due at/after local target when never generated", () => {
    const users: DueUser[] = [
      { userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null }, // 08:15 ≥ 08:00 → due
      { userKey: "ktm", timezone: "Asia/Kathmandu", lastGeneratedAt: null }, // 08:30 ≥ 08:00 → due
      { userKey: "lon", timezone: "Europe/London", lastGeneratedAt: null }, // 03:45 < 08:00 → not due
    ];
    expect(computeDueSummaries({ users, now, summaryTime: time }).map((u) => u.userKey)).toEqual([
      "kol",
      "ktm",
    ]);
  });

  it("not due again if already generated today in the user's own tz", () => {
    const users: DueUser[] = [
      { userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: "2026-07-31T02:40:00.000Z" }, // local 08:10 today
    ];
    expect(computeDueSummaries({ users, now, summaryTime: time })).toEqual([]);
  });

  it("due again when the last generation was a previous local day (catch-up)", () => {
    const users: DueUser[] = [
      { userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: "2026-07-30T02:40:00.000Z" }, // yesterday local
    ];
    expect(computeDueSummaries({ users, now, summaryTime: time }).map((u) => u.userKey)).toEqual([
      "kol",
    ]);
  });
});
