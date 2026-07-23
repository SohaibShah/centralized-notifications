import { describe, it, expect } from "vitest";
import {
  actionSchema,
  audienceSchema,
  FEED_SORTS,
  formatRelativeAge,
  notificationSchema,
} from "../src/notification";

// A minimal valid notification reused across cases.
const validGlobal = {
  id: "scan-run-556-sensitive-found",
  module: "data-mapping",
  title: "Sensitive data found in 2 new data stores",
  description: "The nightly scan classified SSN and credit-card data in newly connected stores.",
  priority: "normal",
  snoozable: true,
  audience: { scope: "global" },
};

describe("notificationSchema — happy paths", () => {
  it("parses a valid global notification", () => {
    const parsed = notificationSchema.parse(validGlobal);
    expect(parsed.id).toBe(validGlobal.id);
    expect(parsed.audience.scope).toBe("global");
  });

  it("accepts non-global scopes when an id is present", () => {
    expect(() =>
      notificationSchema.parse({ ...validGlobal, audience: { scope: "team", id: "privacy-ops" } }),
    ).not.toThrow();
  });

  it("accepts actions with and without an icon, and an empty actions array", () => {
    const parsed = notificationSchema.parse({
      ...validGlobal,
      actions: [
        { label: "Approve", method: "POST", url: "https://app/api/8842/approve", icon: "check" },
        { label: "Review", method: "GET", url: "https://app/access/8842" },
      ],
    });
    expect(parsed.actions).toHaveLength(2);
    expect(notificationSchema.safeParse({ ...validGlobal, actions: [] }).success).toBe(true);
  });

  it("accepts a UTC and an offset ISO-8601 timestamp", () => {
    expect(
      notificationSchema.safeParse({ ...validGlobal, timestamp: "2026-07-03T12:00:00Z" }).success,
    ).toBe(true);
    expect(
      notificationSchema.safeParse({ ...validGlobal, timestamp: "2026-07-03T12:00:00+05:30" })
        .success,
    ).toBe(true);
  });

  it("passes metadata through opaquely, preserving nested structure", () => {
    const metadata = {
      dsrId: "1234",
      classifications: ["ssn", "credit-card"],
      nested: { a: [1, 2] },
    };
    const parsed = notificationSchema.parse({ ...validGlobal, metadata });
    expect(parsed.metadata).toEqual(metadata);
  });

  it("strips unknown top-level fields (forwards-compatible)", () => {
    const parsed = notificationSchema.parse({ ...validGlobal, somethingNew: 123 });
    expect(parsed).not.toHaveProperty("somethingNew");
  });
});

describe("notificationSchema — required fields (locked decisions)", () => {
  it.each(["id", "module", "title", "priority", "snoozable", "audience"])(
    "rejects a notification missing required field %s",
    (field) => {
      const { [field]: _omit, ...rest } = validGlobal as Record<string, unknown>;
      expect(notificationSchema.safeParse(rest).success).toBe(false);
    },
  );

  it("requires snoozable to be an explicit boolean (not defaulted)", () => {
    const { snoozable: _omit, ...rest } = validGlobal;
    expect(notificationSchema.safeParse(rest).success).toBe(false);
  });
});

describe("notificationSchema — failure paths", () => {
  it("rejects a non-global audience without an id", () => {
    expect(
      notificationSchema.safeParse({ ...validGlobal, audience: { scope: "team" } }).success,
    ).toBe(false);
  });

  it("rejects an unknown priority", () => {
    expect(notificationSchema.safeParse({ ...validGlobal, priority: "urgent" }).success).toBe(
      false,
    );
  });

  it("requires a non-empty, non-blank id (the dedupe / idempotency key)", () => {
    expect(notificationSchema.safeParse({ ...validGlobal, id: "" }).success).toBe(false);
    expect(notificationSchema.safeParse({ ...validGlobal, id: "   " }).success).toBe(false);
  });

  it("rejects over-long free-text fields", () => {
    expect(notificationSchema.safeParse({ ...validGlobal, id: "x".repeat(201) }).success).toBe(
      false,
    );
    expect(notificationSchema.safeParse({ ...validGlobal, title: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(
      notificationSchema.safeParse({ ...validGlobal, description: "x".repeat(5001) }).success,
    ).toBe(false);
  });

  it("rejects more than 10 actions", () => {
    const action = { label: "Go", method: "GET", url: "https://app/x" };
    expect(
      notificationSchema.safeParse({ ...validGlobal, actions: Array(11).fill(action) }).success,
    ).toBe(false);
  });

  it("rejects a malformed timestamp (date-only or non-date)", () => {
    expect(notificationSchema.safeParse({ ...validGlobal, timestamp: "2026-07-03" }).success).toBe(
      false,
    );
    expect(notificationSchema.safeParse({ ...validGlobal, timestamp: "not-a-date" }).success).toBe(
      false,
    );
  });
});

describe("actionSchema", () => {
  it("rejects an unsupported method", () => {
    expect(
      actionSchema.safeParse({ label: "X", method: "FETCH", url: "https://app/x" }).success,
    ).toBe(false);
  });

  it("rejects a malformed url", () => {
    expect(actionSchema.safeParse({ label: "X", method: "GET", url: "not-a-url" }).success).toBe(
      false,
    );
  });

  it("rejects dangerous non-http(s) url schemes (XSS/SSRF boundary)", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "ftp://host/x",
    ]) {
      expect(actionSchema.safeParse({ label: "X", method: "GET", url }).success).toBe(false);
    }
  });

  it("accepts http and https urls", () => {
    expect(actionSchema.safeParse({ label: "X", method: "GET", url: "http://app/x" }).success).toBe(
      true,
    );
    expect(
      actionSchema.safeParse({ label: "X", method: "GET", url: "https://app/x" }).success,
    ).toBe(true);
  });

  it("rejects an empty label", () => {
    expect(actionSchema.safeParse({ label: "", method: "GET", url: "https://app/x" }).success).toBe(
      false,
    );
  });
});

describe("audienceSchema", () => {
  it("allows global without an id", () => {
    expect(audienceSchema.parse({ scope: "global" }).scope).toBe("global");
  });

  it("requires an id for user / role / team scopes", () => {
    expect(audienceSchema.safeParse({ scope: "user" }).success).toBe(false);
    expect(audienceSchema.safeParse({ scope: "role" }).success).toBe(false);
    expect(audienceSchema.safeParse({ scope: "team" }).success).toBe(false);
  });

  it("rejects an unknown scope", () => {
    expect(audienceSchema.safeParse({ scope: "everyone" }).success).toBe(false);
  });
});

describe("feed sorts", () => {
  it("exposes the four sort values with newest first", () => {
    expect(FEED_SORTS).toEqual(["newest", "oldest", "priority-high", "priority-low"]);
  });
});

describe("action kind", () => {
  it("defaults kind to 'link' when omitted", () => {
    const parsed = actionSchema.parse({ label: "Open", method: "GET", url: "https://app/x" });
    expect(parsed.kind).toBe("link");
  });

  it("accepts an explicit dispatch kind", () => {
    const parsed = actionSchema.parse({
      label: "Approve",
      method: "POST",
      url: "https://app/a",
      kind: "dispatch",
    });
    expect(parsed.kind).toBe("dispatch");
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      actionSchema.parse({ label: "X", method: "GET", url: "https://app/x", kind: "explode" }),
    ).toThrow();
  });
});

describe("formatRelativeAge", () => {
  it("uses minute resolution under an hour, then hours, then days", () => {
    expect(formatRelativeAge(0)).toBe("0m");
    expect(formatRelativeAge(34)).toBe("34m");
    expect(formatRelativeAge(59)).toBe("59m");
    expect(formatRelativeAge(60)).toBe("1h");
    expect(formatRelativeAge(190)).toBe("3h");
    expect(formatRelativeAge(1500)).toBe("1d");
  });
});
