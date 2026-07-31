import { describe, expect, it } from "vitest";
import type { MuteRule } from "@notifications/shared";
import { isSuppressed, muteWhere } from "./mute";

const now = new Date("2026-07-31T12:00:00.000Z");
const future = "2026-07-31T18:00:00.000Z";
const past = "2026-07-31T06:00:00.000Z";

const snoozableDsr = { snoozable: true, module: "dsr", category: "audit" as string | null };

describe("isSuppressed", () => {
  it("never suppresses a non-snoozable notification, whatever its priority", () => {
    const rules: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: null }];
    // snoozable:false is the only thing that matters here — priority is irrelevant.
    expect(isSuppressed(rules, { snoozable: false, module: "dsr" }, now)).toBe(false);
  });

  it("suppresses a snoozable notification from a muted module — any priority, incl. critical", () => {
    const rules: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: null }];
    expect(isSuppressed(rules, snoozableDsr, now)).toBe(true);
    // A snoozable critical is muteable too (priority is not a gate).
    expect(isSuppressed(rules, { snoozable: true, module: "dsr" }, now)).toBe(true);
  });

  it("suppresses a snoozed module while active, not after it expires", () => {
    const active: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: future }];
    const expired: MuteRule[] = [{ targetKind: "module", target: "dsr", mutedUntil: past }];
    expect(isSuppressed(active, snoozableDsr, now)).toBe(true);
    expect(isSuppressed(expired, snoozableDsr, now)).toBe(false);
  });

  it("matches a category rule across any module", () => {
    const rules: MuteRule[] = [{ targetKind: "category", target: "audit", mutedUntil: null }];
    expect(isSuppressed(rules, { snoozable: true, module: "other", category: "audit" }, now)).toBe(
      true,
    );
  });

  it("does not suppress a notification with no category under a category rule", () => {
    const rules: MuteRule[] = [{ targetKind: "category", target: "audit", mutedUntil: null }];
    expect(isSuppressed(rules, { snoozable: true, module: "dsr", category: null }, now)).toBe(
      false,
    );
  });

  it("does not suppress when there are no rules", () => {
    expect(isSuppressed([], snoozableDsr, now)).toBe(false);
  });
});

describe("muteWhere", () => {
  it("pushes the user key and gates on snoozable + an active rule", () => {
    const params: unknown[] = ["existing"];
    const sql = muteWhere("user-1", params);
    expect(params).toEqual(["existing", "user-1"]);
    expect(sql).toContain("$2::text");
    expect(sql).toContain("n.snoozable = false"); // non-snoozable always passes
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("now()");
    expect(sql).not.toContain("priority"); // priority is not a gate
  });
});
