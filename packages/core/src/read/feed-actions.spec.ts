import { describe, expect, it } from "vitest";
import { parseActions } from "./feed";

describe("parseActions", () => {
  it("keeps valid actions and drops invalid ones without throwing", () => {
    const raw = [
      { label: "View", kind: "link", method: "GET", url: "https://x.test/a" },
      { label: "Broken", kind: "dispatch", method: "POST" }, // missing path -> dropped
      { label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" },
    ];
    const parsed = parseActions(raw);
    expect(parsed.map((a) => a.label)).toEqual(["View", "Approve"]);
  });
});
