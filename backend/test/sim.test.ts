import { describe, expect, it } from "vitest";
import { notificationSchema } from "@notifications/shared";
import { simulate } from "../src/sim/simulator";

describe("simulate", () => {
  it("produces the requested count of contract-valid notifications", () => {
    const batch = simulate({ count: 20, seed: 1 });
    expect(batch).toHaveLength(20);
    for (const notification of batch) {
      expect(notificationSchema.safeParse(notification).success).toBe(true);
    }
  });

  it("covers all four audience scopes", () => {
    const scopes = new Set(simulate({ count: 20, seed: 1 }).map((n) => n.audience.scope));
    expect(scopes).toEqual(new Set(["global", "team", "role", "user"]));
  });

  it("varies module and priority across a burst", () => {
    const batch = simulate({ count: 20, seed: 7 });
    expect(new Set(batch.map((n) => n.module)).size).toBeGreaterThan(1);
    expect(new Set(batch.map((n) => n.priority)).size).toBeGreaterThan(1);
  });

  it("is deterministic for a fixed seed", () => {
    expect(simulate({ count: 10, seed: 42 })).toEqual(simulate({ count: 10, seed: 42 }));
  });

  it("produces unique ids within a burst (usable as dedupe keys)", () => {
    const ids = simulate({ count: 50, seed: 3 }).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("restricts output to the requested modules", () => {
    const batch = simulate({ count: 10, seed: 5, modules: ["dsr"] });
    expect(new Set(batch.map((n) => n.module))).toEqual(new Set(["dsr"]));
  });

  it("falls back to a generic template for an unknown module (still valid)", () => {
    const batch = simulate({ count: 5, seed: 1, modules: ["custom-thing"] });
    expect(new Set(batch.map((n) => n.module))).toEqual(new Set(["custom-thing"]));
    for (const notification of batch) {
      expect(notificationSchema.safeParse(notification).success).toBe(true);
    }
  });

  it("covers all four scopes at exactly count=4, a subset below, and nothing at 0", () => {
    expect(new Set(simulate({ count: 4, seed: 9 }).map((n) => n.audience.scope))).toEqual(
      new Set(["global", "team", "role", "user"]),
    );
    expect(simulate({ count: 2, seed: 9 })).toHaveLength(2);
    expect(simulate({ count: 0, seed: 9 })).toEqual([]);
  });

  it("coalesces an empty modules array to the built-in defaults", () => {
    const batch = simulate({ count: 8, seed: 2, modules: [] });
    expect(batch).toHaveLength(8);
    for (const notification of batch) {
      expect(notificationSchema.safeParse(notification).success).toBe(true);
    }
  });
});
