import { describe, expect, it } from "vitest";
import type { Notification } from "@notifications/shared";
import { createTextGroupingStrategy } from "./text-strategy";

const s = createTextGroupingStrategy();
const n = (over: Partial<Notification> & { title: string }): Notification => ({
  id: "x",
  module: "dsr",
  description: "",
  priority: "normal",
  snoozable: true,
  audience: { scope: "global" },
  ...over,
});

describe("TextGroupingStrategy", () => {
  it("prefers an explicit metadata.groupKey", () => {
    expect(s.keyFor(n({ title: "anything", metadata: { groupKey: "req-9" } }))).toEqual({
      key: "dsr:req-9",
      label: "anything",
    });
  });
  it("ignores a blank/non-string metadata.groupKey and falls through", () => {
    expect(s.keyFor(n({ title: "Backup failed", metadata: { groupKey: "  " } }))?.key).toBe(
      "dsr:_:backup failed",
    );
  });
  it("extracts a #id entity → instance key, label trimmed to the entity clause", () => {
    expect(s.keyFor(n({ title: "DSAR #1042 overdue" }))).toEqual({
      key: "dsr:#1042",
      label: "DSAR #1042",
    });
  });
  it("extracts a PREFIX-123 entity → instance key", () => {
    expect(s.keyFor(n({ title: "DSAR-1042 identity verified" }))).toEqual({
      key: "dsr:dsar-1042",
      label: "DSAR-1042",
    });
  });
  it("picks the earliest entity when several appear", () => {
    expect(s.keyFor(n({ title: "Ticket #7 relates to #9" }))?.key).toBe("dsr:#7");
  });
  it("falls back to a kind template (ids/dates stripped) when no entity", () => {
    const a = s.keyFor(n({ title: "Backup job failed on host-07", category: "ops" }));
    const b = s.keyFor(n({ title: "Backup job failed on host-19", category: "ops" }));
    expect(a?.key).toBe("dsr:ops:backup job failed on host");
    expect(a?.key).toBe(b?.key); // same kind ⇒ same stack
    expect(a?.label).toBe("Backup job failed on host");
  });
  it("uses '_' for the category slot when category is absent", () => {
    expect(s.keyFor(n({ title: "Weekly report ready" }))?.key).toBe("dsr:_:weekly report ready");
  });
  it("returns null when the template normalizes to empty", () => {
    expect(s.keyFor(n({ title: "#1 2 3 —", metadata: {} }))).not.toBeNull(); // '#1' is an entity
    expect(s.keyFor(n({ title: "2026-01-01 12:00" }))).toBeNull(); // all volatile ⇒ empty
  });
  it("returns promptly on a max-length adversarial title (no ReDoS)", () => {
    const t0 = Date.now();
    s.keyFor(n({ title: "a".repeat(500) }));
    expect(Date.now() - t0).toBeLessThan(100);
  });
  it("bounds the key length so it stays drill-in-able and index-safe", () => {
    // A very long title (kind template) must not produce an unbounded group_key.
    const key = s.keyFor(n({ title: "word ".repeat(120).trim() }))?.key ?? "";
    expect(key.length).toBeLessThanOrEqual(200);
    // A long module-provided key is capped too.
    const metaKey = s.keyFor(n({ title: "x", metadata: { groupKey: "g".repeat(400) } }))?.key ?? "";
    expect(metaKey.length).toBeLessThanOrEqual(200);
  });
});
