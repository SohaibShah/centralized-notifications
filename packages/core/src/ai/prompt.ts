import type { AiMessage } from "../types";
import type { SummaryContext } from "./summarize";

const SYSTEM = [
  "You are a triage assistant for a security & privacy operations notification inbox.",
  "Summarize the user's UNREAD notifications in 2-4 sentences of plain prose (no markdown headers, no lists).",
  "Weigh three things: clusters of related items (same module or category), staleness (older high-priority items still unactioned), and finish with a concrete 'start here' recommendation of what to tackle first and why.",
  "Reference actual items by their titles. Never invent details that are not in the list. Be concise and specific.",
].join(" ");

/** Build the chat messages for a summary. Core owns this prompt so every host gets the same tuned
 *  triage behavior and only injects a model transport. */
export function buildSummaryMessages(ctx: SummaryContext): AiMessage[] {
  const lines = ctx.items.map((i) => {
    const age =
      i.ageMinutes >= 1440
        ? `${Math.floor(i.ageMinutes / 1440)}d`
        : `${Math.floor(i.ageMinutes / 60)}h`;
    const cat = i.category ? `, ${i.category}` : "";
    return `- [${i.priority}] (${i.module}${cat}, ${age} old${i.hasActions ? ", has actions" : ""}): ${i.title} — ${i.description}`;
  });
  const user = [
    `Unread: ${ctx.totalUnread} total (showing ${ctx.items.length}). Reference time: ${ctx.now}.`,
    "",
    ...lines,
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}
