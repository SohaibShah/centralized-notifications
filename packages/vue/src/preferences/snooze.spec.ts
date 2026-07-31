import { describe, expect, it } from "vitest";
import type { MuteRule } from "@notifications/shared";
import { muteStatusLabel, resolveSnoozeUntil } from "./snooze";

const now = new Date("2026-07-31T12:00:00.000Z");

/** Format an ISO instant as wall-clock date + time in a zone, for assertions. */
function wall(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

describe("resolveSnoozeUntil", () => {
  it("adds relative durations", () => {
    expect(resolveSnoozeUntil("1h", now, "UTC")).toBe("2026-07-31T13:00:00.000Z");
    expect(resolveSnoozeUntil("4h", now, "UTC")).toBe("2026-07-31T16:00:00.000Z");
    expect(resolveSnoozeUntil("1w", now, "UTC")).toBe("2026-08-07T12:00:00.000Z");
  });

  it("resolves tomorrow-morning to 08:00 next local day in a half-hour zone", () => {
    // now = 12:00Z = 17:30 IST on 2026-07-31 → tomorrow local is 2026-08-01, 08:00 IST.
    const iso = resolveSnoozeUntil("tomorrow-morning", now, "Asia/Kolkata");
    expect(wall(iso, "Asia/Kolkata")).toBe("2026-08-01, 08:00");
    // 08:00 IST = 02:30 UTC.
    expect(iso).toBe("2026-08-01T02:30:00.000Z");
  });

  it("resolves tomorrow-morning for a three-quarter-hour zone (+05:45)", () => {
    const iso = resolveSnoozeUntil("tomorrow-morning", now, "Asia/Kathmandu");
    expect(wall(iso, "Asia/Kathmandu")).toBe("2026-08-01, 08:00");
  });

  it("rolls over month/year boundaries", () => {
    const dec31 = new Date("2026-12-31T20:00:00.000Z"); // still 2026-12-31 in UTC
    const iso = resolveSnoozeUntil("tomorrow-morning", dec31, "UTC");
    expect(wall(iso, "UTC")).toBe("2027-01-01, 08:00");
  });
});

describe("muteStatusLabel", () => {
  const mod = (mutedUntil: string | null): MuteRule => ({
    targetKind: "module",
    target: "dsr",
    mutedUntil,
  });

  it("labels no rule as Active", () => {
    expect(muteStatusLabel(undefined, now)).toBe("Active");
  });

  it("labels an indefinite rule as Muted", () => {
    expect(muteStatusLabel(mod(null), now)).toBe("Muted");
  });

  it("labels an active snooze with the time remaining", () => {
    expect(muteStatusLabel(mod("2026-07-31T15:00:00.000Z"), now)).toBe("Snoozed · 3h left");
    expect(muteStatusLabel(mod("2026-07-31T12:30:00.000Z"), now)).toBe("Snoozed · 30m left");
    expect(muteStatusLabel(mod("2026-08-02T12:00:00.000Z"), now)).toBe("Snoozed · 2d left");
  });

  it("labels an expired snooze as Active", () => {
    expect(muteStatusLabel(mod("2026-07-31T06:00:00.000Z"), now)).toBe("Active");
  });
});
