import type { AiMessage } from "../types";
import type { ChatContextItem } from "./retrieve";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const INSTRUCTIONS = [
  "You are an assistant that answers a user's questions about THEIR notifications.",
  "Answer ONLY from the notifications provided below — if the answer isn't in them, say you don't have that information. Never invent notifications.",
  "Each notification is tagged [read] or [unread]. Scope your answer to the question: if the user asks about unread items use only [unread]; if about read items use only [read]; otherwise consider both.",
  "Be concise and reference items by their titles.",
].join(" ");

function line(i: ChatContextItem): string {
  const age =
    i.ageMinutes >= 1440
      ? `${Math.floor(i.ageMinutes / 1440)}d`
      : `${Math.floor(i.ageMinutes / 60)}h`;
  const cat = i.category ? `, ${i.category}` : "";
  return `- [${i.read ? "read" : "unread"}] [${i.priority}] (${i.module}${cat}, ${age} old${i.hasActions ? ", has actions" : ""}): ${i.title} — ${i.description}`;
}

/** Build chat messages: one system message (instructions + the retrieved notifications), then the
 *  bounded prior turns, then the new question. Core owns this prompt. */
export function buildChatMessages(
  context: ChatContextItem[],
  history: ChatTurn[],
  question: string,
): AiMessage[] {
  const contextBlock = context.length
    ? `Notifications you may reference:\n${context.map(line).join("\n")}`
    : "The user currently has no notifications you can reference.";
  return [
    { role: "system", content: `${INSTRUCTIONS}\n\n${contextBlock}` },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
}
