import { describe, expect, it } from "vitest";
import type { MuteRule } from "@notifications/shared";
import { isSuppressed, muteWhere } from "./mute";

const now = new Date("2026-07-31T12:00:00.000Z");
const future = "2026-07-31T18:00:00.000Z";
const past = "2026-07-31T06:00:00.000Z";

const snoozableDsr = {
  snoozable: true,
  priority: "normal",
  module: "dsr",
  category: "audit" as string | null,
};

describe("isSuppressed", () => {
  it("never suppresses a non-snoozable notification", () => {
    const rules: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: null }];
    expect(isSuppressed(rules, { snoozable: false, priority: "normal", module: "dsr" }, now)).toBe(
      false,
    );
  });

  it("never suppresses a critical notification, even a snoozable one under an active rule", () => {
    const rules: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: null }];
    expect(isSuppressed(rules, { snoozable: true, priority: "critical", module: "dsr" }, now)).toBe(
      false,
    );
  });

  it("suppresses a muted module (mutedUntil null)", () => {
    const rules: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: null }];
    expect(isSuppressed(rules, snoozableDsr, now)).toBe(true);
  });

  it("suppresses a snoozed module while active, not after it expires", () => {
    const active: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: future }];
    const expired: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: past }];
    expect(isSuppressed(active, snoozableDsr, now)).toBe(true);
    expect(isSuppressed(expired, snoozableDsr, now)).toBe(false);
  });

  it("matches a category rule across any module", () => {
    const rules: MuteRule[] = [{ targetKind: "category", target: "audit", mutedUntil: null }];
    expect(
      isSuppressed(
        rules,
        { snoozable: true, priority: "normal", module: "other", category: "audit" },
        now,
      ),
    ).toBe(true);
  });

  it("does not suppress a notification with no category under a category rule", () => {
    const rules: MuteRule[] = [{ targetKind: "category", target: "audit", mutedUntil: null }];
    expect(
      isSuppressed(
        rules,
        { snoozable: true, priority: "normal", module: "dsr", category: null },
        now,
      ),
    ).toBe(false);
  });

  it("does not suppress when there are no rules", () => {
    expect(isSuppressed([], snoozableDsr, now)).toBe(false);
  });
});

describe("muteWhere", () => {
  it("pushes the user key and references it in the fragment", () => {
    const params: unknown[] = ["existing"];
    const sql = muteWhere("user-1", params);
    expect(params).toEqual(["existing", "user-1"]);
    expect(sql).toContain("$2::text");
    expect(sql).toContain("n.snoozable = false");
    expect(sql).toContain("n.priority = 'critical'");
    expect(sql).toContain("now()");
  });
});
