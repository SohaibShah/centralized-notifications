import { describe, expect, it } from "vitest";
import { actionSchema, moduleActionResponseSchema, notificationSchema } from "./notification";

describe("actionSchema (union)", () => {
  it("parses a link action and defaults a bare legacy action (no kind) to link", () => {
    expect(
      actionSchema.parse({ label: "View", kind: "link", method: "GET", url: "https://x.test/a" })
        .kind,
    ).toBe("link");
    // legacy persisted action: no `kind` -> link
    const legacy = actionSchema.parse({ label: "Open", method: "GET", url: "https://x.test/a" });
    expect(legacy.kind).toBe("link");
  });

  it("parses a dispatch action with a relative path + metadata", () => {
    const a = actionSchema.parse({
      label: "Approve",
      kind: "dispatch",
      method: "POST",
      path: "/actions/approve",
      metadata: { requestId: "r1" },
    });
    expect(a).toMatchObject({ kind: "dispatch", path: "/actions/approve" });
  });

  it("rejects a dispatch action whose path is absolute, protocol-relative, or has ..", () => {
    for (const path of ["http://evil/x", "//evil/x", "/a/../b", "actions/approve"]) {
      expect(
        actionSchema.safeParse({ label: "X", kind: "dispatch", method: "POST", path }).success,
      ).toBe(false);
    }
  });

  it("rejects a dispatch action with oversized metadata (>4KB)", () => {
    const metadata = { blob: "x".repeat(4097) };
    expect(
      actionSchema.safeParse({ label: "X", kind: "dispatch", method: "POST", path: "/a", metadata })
        .success,
    ).toBe(false);
  });

  it("rejects a dispatch method other than GET/POST", () => {
    expect(
      actionSchema.safeParse({ label: "X", kind: "dispatch", method: "DELETE", path: "/a" })
        .success,
    ).toBe(false);
  });

  it("returns a validation failure (never throws) when metadata is not JSON-serializable", () => {
    // JSON.stringify throws on these; zod does NOT catch predicate exceptions, so the size
    // check must be throw-safe or these would blow up the intake boundary instead of failing.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const metadata of [{ big: 10n } as unknown, circular]) {
      // The assertion is twofold: it must not throw, and it must report failure.
      const result = actionSchema.safeParse({
        label: "X",
        kind: "dispatch",
        method: "POST",
        path: "/a",
        metadata,
      });
      expect(result.success).toBe(false);
    }
  });

  it("counts UTF-8 bytes, not UTF-16 code units, for the metadata size bound", () => {
    // Each 😀 is 2 UTF-16 code units but 4 UTF-8 bytes. 1100 of them = 2200 code units
    // (well under 4096 by `.length`) but 4400 bytes (> 4096) — must be rejected.
    const metadata = { blob: "😀".repeat(1100) };
    expect(metadata.blob.length).toBeLessThanOrEqual(4096);
    expect(
      actionSchema.safeParse({ label: "X", kind: "dispatch", method: "POST", path: "/a", metadata })
        .success,
    ).toBe(false);
  });

  it("does not throw when a throwing-metadata dispatch action routes through notificationSchema", () => {
    // notificationSchema.safeParse is the untrusted intake boundary (packages/core validate.ts,
    // documented to never throw). A hostile action.metadata must surface as success:false, not
    // an uncaught exception out of safeParse.
    const result = notificationSchema.safeParse({
      id: "n-throwing-metadata",
      module: "m",
      title: "t",
      description: "",
      priority: "normal",
      snoozable: false,
      audience: { scope: "global" },
      actions: [
        { label: "X", kind: "dispatch", method: "POST", path: "/a", metadata: { big: 10n } },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("moduleActionResponseSchema", () => {
  it("parses a full response and rejects a too-long message / too-many actions", () => {
    expect(
      moduleActionResponseSchema.parse({ ok: true, message: "Done", resolve: true, actions: [] }),
    ).toMatchObject({ ok: true });
    expect(
      moduleActionResponseSchema.safeParse({ ok: true, message: "x".repeat(501) }).success,
    ).toBe(false);
    const actions = Array.from({ length: 11 }, () => ({
      label: "L",
      kind: "link",
      method: "GET",
      url: "https://x.test/a",
    }));
    expect(moduleActionResponseSchema.safeParse({ ok: true, actions }).success).toBe(false);
  });
});
