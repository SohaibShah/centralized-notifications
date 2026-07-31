import { describe, expect, it } from "vitest";
import {
  preferencesPatchSchema,
  putMuteBodySchema,
  userPreferencesSchema,
  muteRuleSchema,
} from "./preferences";

describe("userPreferencesSchema", () => {
  it("accepts valid preferences", () => {
    const r = userPreferencesSchema.safeParse({
      groupingEnabled: true,
      summaryOptOut: false,
      toastMinPriority: "critical",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown toast priority", () => {
    const r = userPreferencesSchema.safeParse({
      groupingEnabled: true,
      summaryOptOut: false,
      toastMinPriority: "urgent",
    });
    expect(r.success).toBe(false);
  });
});

describe("preferencesPatchSchema", () => {
  it("accepts a partial update", () => {
    expect(preferencesPatchSchema.safeParse({ summaryOptOut: true }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({}).success).toBe(true);
  });
});

describe("putMuteBodySchema", () => {
  it("accepts null (mute) and a valid ISO datetime (snooze)", () => {
    expect(putMuteBodySchema.safeParse({ until: null }).success).toBe(true);
    expect(putMuteBodySchema.safeParse({ until: "2026-08-01T08:00:00.000Z" }).success).toBe(true);
  });

  it("rejects a non-datetime until", () => {
    expect(putMuteBodySchema.safeParse({ until: "nope" }).success).toBe(false);
  });
});

describe("muteRuleSchema", () => {
  it("accepts a module rule with null mutedUntil and a category rule with a timestamp", () => {
    expect(
      muteRuleSchema.safeParse({ targetKind: "module", target: "dsr", mutedUntil: null }).success,
    ).toBe(true);
    expect(
      muteRuleSchema.safeParse({
        targetKind: "category",
        target: "marketing",
        mutedUntil: "2026-08-01T08:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown target kind", () => {
    expect(
      muteRuleSchema.safeParse({ targetKind: "team", target: "x", mutedUntil: null }).success,
    ).toBe(false);
  });
});
