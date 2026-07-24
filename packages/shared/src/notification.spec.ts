import { describe, expect, it } from "vitest";
import { actionSchema, moduleActionResponseSchema } from "./notification";

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
