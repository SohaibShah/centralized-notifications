import { expect, test } from "vitest";
import { buildChatMessages } from "../src/ai/chat-prompt";

test("system carries grounding + read/unread tagging; context, history, and question are included", () => {
  const msgs = buildChatMessages(
    [
      {
        title: "Acme DSAR",
        description: "overdue",
        priority: "critical",
        module: "dsr",
        ageMinutes: 4000,
        read: false,
        hasActions: true,
      },
      {
        title: "Old finding",
        description: "done",
        priority: "low",
        module: "assessments",
        ageMinutes: 9000,
        read: true,
        hasActions: false,
      },
    ],
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
    "any unread DSARs?",
  );
  const system = msgs[0]!.content.toLowerCase();
  expect(msgs[0]!.role).toBe("system");
  expect(system).toContain("only"); // answer ONLY from provided notifications
  expect(system).toContain("unread");
  expect(msgs[0]!.content).toContain("[unread]");
  expect(msgs[0]!.content).toContain("Acme DSAR");
  expect(msgs[0]!.content).toContain("[read]");
  // history + question appended in order, last message is the question
  expect(msgs.some((m) => m.role === "assistant" && m.content === "hello")).toBe(true);
  expect(msgs.at(-1)).toEqual({ role: "user", content: "any unread DSARs?" });
});

test("empty context still produces a well-formed system message", () => {
  const msgs = buildChatMessages([], [], "anything?");
  expect(msgs[0]!.role).toBe("system");
  expect(msgs[0]!.content.toLowerCase()).toContain("no notifications");
  expect(msgs.at(-1)).toEqual({ role: "user", content: "anything?" });
});
