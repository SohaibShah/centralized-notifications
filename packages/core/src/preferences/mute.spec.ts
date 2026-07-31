import { describe, expect, it } from "vitest";
import type { MuteRule } from "@notifications/shared";
import { isSuppressed, muteWhere } from "./mute";

const now = new Date("2026-07-31T12:00:00.000Z");
const future = "2026-07-31T18:00:00.000Z";
const past = "2026-07-31T06:00:00.000Z";

const dsr = { module: "dsr", category: "audit" as string | null };

describe("isSuppressed", () => {
  it("suppresses any notification from a muted module (mutedUntil null), regardless of priority/snoozable", () => {
    const rules: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: null }];
    expect(isSuppressed(rules, dsr, now)).toBe(true);
  });

  it("suppresses a snoozed module while active, not after it expires", () => {
    const active: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: future }];
    const expired: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: past }];
    expect(isSuppressed(active, dsr, now)).toBe(true);
    expect(isSuppressed(expired, dsr, now)).toBe(false);
  });

  it("matches a category rule across any module", () => {
    const rules: MuteRule[] = [{ targetKind: "category", target: "audit", mutedUntil: null }];
    expect(isSuppressed(rules, { module: "other", category: "audit" }, now)).toBe(true);
  });

  it("does not suppress a notification with no category under a category rule", () => {
    const rules: MuteRule[] = [{ targetKind: "category", target: "audit", mutedUntil: null }];
    expect(isSuppressed(rules, { module: "dsr", category: null }, now)).toBe(false);
  });

  it("does not suppress an unrelated module/category", () => {
    const rules: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: null }];
    expect(isSuppressed(rules, { module: "other", category: "x" }, now)).toBe(false);
  });

  it("does not suppress when there are no rules", () => {
    expect(isSuppressed([], dsr, now)).toBe(false);
  });
});

describe("muteWhere", () => {
  it("pushes the user key and references it in the fragment", () => {
    const params: unknown[] = ["existing"];
    const sql = muteWhere("user-1", params);
    expect(params).toEqual(["existing", "user-1"]);
    expect(sql).toContain("$2::text");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("now()");
    // No priority/snoozable gating — the rule applies to everything from the target.
    expect(sql).not.toContain("snoozable");
    expect(sql).not.toContain("priority");
  });
});
