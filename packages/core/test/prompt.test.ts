import { expect, test } from "vitest";
import { buildSummaryMessages } from "../src/ai/prompt";

test("system prompt names the factors; user message carries the items + total", () => {
  const msgs = buildSummaryMessages({
    now: new Date().toISOString(),
    totalUnread: 3,
    items: [
      {
        title: "Acme DSAR overdue",
        description: "d",
        priority: "critical",
        module: "dsr",
        ageMinutes: 4000,
        hasActions: true,
      },
      {
        title: "New tracker finding",
        description: "d",
        priority: "high",
        module: "data-mapping",
        ageMinutes: 30,
        hasActions: false,
      },
    ],
  });
  const system = msgs.find((m) => m.role === "system")!.content.toLowerCase();
  expect(system).toContain("cluster");
  expect(system).toContain("start"); // "start here" ordering
  const user = msgs.find((m) => m.role === "user")!.content;
  expect(user).toContain("Acme DSAR overdue");
  expect(user).toContain("3"); // total unread
});
