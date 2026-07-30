import { expect, test, vi } from "vitest";
import { runSummaryTick } from "../src/summary/scheduler";
import type { ScheduleRow } from "../src/summary/schedule-repo";

const rows: ScheduleRow[] = [
  { id: "1", userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null }, // 08:15 local → due
  { id: "2", userKey: "lon", timezone: "Europe/London", lastGeneratedAt: null }, // 03:45 local → not due
];
const now = () => new Date("2026-07-31T02:45:00.000Z");

test("generates only for due users when enabled", async () => {
  const generate = vi.fn(async () => {});
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => rows,
    generate,
    now,
  });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]![0].userKey).toBe("kol");
});

test("does nothing when aiSummaryEnabled is false", async () => {
  const generate = vi.fn(async () => {});
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: false, summaryTime: "08:00" }),
    listRows: async () => rows,
    generate,
    now,
  });
  expect(generate).not.toHaveBeenCalled();
});

test("one user's failure does not abort the batch", async () => {
  const three: ScheduleRow[] = [
    { id: "1", userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null },
    { id: "2", userKey: "ktm", timezone: "Asia/Kathmandu", lastGeneratedAt: null },
  ];
  const generate = vi.fn(async (r: ScheduleRow) => {
    if (r.userKey === "kol") throw new Error("boom");
  });
  const onError = vi.fn();
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => three,
    generate,
    now,
    onError,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
});
