import { expect, test } from "vitest";
import { buildChatMessages } from "../src/ai/chat-prompt";
import type { ChatContext, ChatContextItem } from "../src/ai/retrieve";

const stats = (over: Partial<ChatContext["stats"]> = {}): ChatContext["stats"] => ({
  total: 0,
  unread: 0,
  byPriority: { critical: 0, high: 0, normal: 0, low: 0 },
  ...over,
});

test("system carries grounding + read/unread tagging + a scope guardrail + [n#] tags + cite instruction", () => {
  const items: ChatContextItem[] = [
    {
      id: "a1",
      title: "Acme DSAR",
      description: "overdue",
      priority: "critical",
      module: "dsr",
      ageMinutes: 4000,
      read: false,
      hasActions: true,
      actions: [],
    },
    {
      id: "a2",
      title: "Old finding",
      description: "done",
      priority: "low",
      module: "assessments",
      ageMinutes: 9000,
      read: true,
      hasActions: false,
      actions: [],
    },
  ];
  const context: ChatContext = {
    stats: stats({ total: 2, unread: 1, byPriority: { critical: 1, high: 0, normal: 0, low: 1 } }),
    items,
  };
  const refs = [
    { ref: "n1", id: "a1" },
    { ref: "n2", id: "a2" },
  ];
  const msgs = buildChatMessages(
    context,
    refs,
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
    "any unread DSARs?",
  );
  const system = msgs[0]!.content;
  const lower = system.toLowerCase();
  expect(msgs[0]!.role).toBe("system");
  expect(lower).toContain("only"); // answer ONLY from provided notifications
  expect(lower).toContain("unread");
  expect(lower).toContain("do not write code"); // scope guardrail
  expect(lower).toContain("in english"); // language constraint
  expect(lower).toContain("natural prose"); // answer in prose, don't copy the raw lines
  expect(system).toContain("[n#] tag"); // cite instruction
  expect(system).toContain("[n1]"); // the ref tag on the first item's line
  expect(system).toContain("Acme DSAR");
  // Square brackets are ONLY citation tags now — read-state/priority are plain words, so the model
  // can't confuse which bracket to cite (which produced wrong-notification chips + regurgitation).
  expect(system).not.toContain("[unread]");
  expect(system).not.toContain("[critical]");
  expect(system).toContain("(unread,"); // Acme is unread → plain-word metadata
  expect(system).toContain("(read,"); // "Old finding" is read
  // true distribution line
  expect(system).toContain("2 notification(s) in total");
  expect(system).toContain("1 critical");
  // history + question appended in order, last message is the question
  expect(msgs.some((m) => m.role === "assistant" && m.content === "hello")).toBe(true);
  expect(msgs.at(-1)).toEqual({ role: "user", content: "any unread DSARs?" });
});

test("states the single most-recently-received item explicitly (not left to age comparison)", () => {
  const items: ChatContextItem[] = [
    // Listed priority-first: an old critical appears BEFORE the newest item.
    {
      id: "old",
      title: "Old critical",
      description: "",
      priority: "critical",
      module: "dsr",
      ageMinutes: 60,
      read: false,
      hasActions: false,
      actions: [],
    },
    {
      id: "new",
      title: "Brand new",
      description: "",
      priority: "normal",
      module: "dsr",
      ageMinutes: 1,
      read: false,
      hasActions: false,
      actions: [],
    },
  ];
  const context: ChatContext = {
    stats: stats({ total: 2, byPriority: { critical: 1, high: 0, normal: 1, low: 0 } }),
    items,
  };
  const system = buildChatMessages(
    context,
    [
      { ref: "n1", id: "old" },
      { ref: "n2", id: "new" },
    ],
    [],
    "what's the latest?",
  )[0]!.content;
  // The server computes the newest and names it — the model shouldn't have to compare ages.
  expect(system).toContain('Most recently received: [n2] "Brand new"');
});

test("recent items get minute-resolution age so recency is distinguishable", () => {
  const items: ChatContextItem[] = [
    {
      id: "r1",
      title: "Just now",
      description: "",
      priority: "critical",
      module: "dsr",
      ageMinutes: 3,
      read: false,
      hasActions: false,
      actions: [],
    },
    {
      id: "r2",
      title: "Bit older",
      description: "",
      priority: "critical",
      module: "dsr",
      ageMinutes: 40,
      read: false,
      hasActions: false,
      actions: [],
    },
  ];
  const context: ChatContext = {
    stats: stats({ total: 2, byPriority: { critical: 2, high: 0, normal: 0, low: 0 } }),
    items,
  };
  const system = buildChatMessages(
    context,
    [
      { ref: "n1", id: "r1" },
      { ref: "n2", id: "r2" },
    ],
    [],
    "newest?",
  )[0]!.content;
  expect(system).toContain("3m old");
  expect(system).toContain("40m old");
  expect(system).not.toContain("0h old"); // the old bucketing collapsed both to "0h"
});

test("history is capped to the most recent 8 turns", () => {
  const context: ChatContext = { stats: stats(), items: [] };
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `turn-${i}`,
  }));
  const msgs = buildChatMessages(context, [], history, "now?");
  const historyMsgs = msgs.filter((m) => m.role !== "system" && m.content !== "now?");
  expect(historyMsgs).toHaveLength(8);
  // kept the MOST RECENT turns (turn-12 .. turn-19), dropped the oldest
  expect(historyMsgs[0]!.content).toBe("turn-12");
  expect(historyMsgs.at(-1)!.content).toBe("turn-19");
});

test("empty context still produces a well-formed system message", () => {
  const msgs = buildChatMessages({ stats: stats(), items: [] }, [], [], "anything?");
  expect(msgs[0]!.role).toBe("system");
  expect(msgs[0]!.content.toLowerCase()).toContain("no notifications");
  expect(msgs.at(-1)).toEqual({ role: "user", content: "anything?" });
});
