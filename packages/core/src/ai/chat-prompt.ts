import { NOTIFICATION_PRIORITIES } from "@notifications/shared";
import type { AiMessage } from "../types";
import type { ChatContext, ChatContextItem, ChatContextStats } from "./retrieve";

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Most recent prior turns kept in the prompt. The HTTP boundary also caps this (zod, ≤8), but core
 *  enforces it too so a direct library caller can't blow up the context window or widen the
 *  prompt-injection surface with an unbounded history. */
const MAX_HISTORY_TURNS = 8;

const INSTRUCTIONS = [
  "You are an assistant that helps a user with THEIR notifications, and nothing else.",
  "Answer ONLY from the notifications provided below — if the answer isn't in them, say you don't have that information. Never invent notifications.",
  "You do not write code, answer general-knowledge questions, do unrelated math, translate text, or roleplay. If asked to do anything that isn't about the user's notifications, briefly decline and offer to help with their notifications instead.",
  "The counts line gives the true totals across ALL the user's notifications; the list below it is a relevant sample and may not contain every item — use the counts for questions about totals or priority mix.",
  "Each notification is tagged [read] or [unread]. Scope your answer to the question: if the user asks about unread items use only [unread]; if about read items use only [read]; otherwise consider both.",
  'Each notification below is prefixed with a tag like [n1]. When your answer refers to a specific notification, include its exact tag inline (for example: "The Acme DSAR [n1] is overdue."). Only use tags that appear below.',
  "Be concise and reference items by their titles.",
].join(" ");

function statsLine(stats: ChatContextStats): string {
  const buckets = NOTIFICATION_PRIORITIES.filter((p) => stats.byPriority[p] > 0)
    .map((p) => `${stats.byPriority[p]} ${p}`)
    .join(", ");
  if (stats.total === 0) return "The user currently has no notifications.";
  return `The user has ${stats.total} notification(s) in total (${buckets}); ${stats.unread} unread.`;
}

function line(i: ChatContextItem, ref: string): string {
  const age =
    i.ageMinutes >= 1440
      ? `${Math.floor(i.ageMinutes / 1440)}d`
      : `${Math.floor(i.ageMinutes / 60)}h`;
  const cat = i.category ? `, ${i.category}` : "";
  return `- [${ref}] [${i.read ? "read" : "unread"}] [${i.priority}] (${i.module}${cat}, ${age} old${i.hasActions ? ", has actions" : ""}): ${i.title} — ${i.description}`;
}

/** Build chat messages: one system message (instructions + true distribution + a sampled list of the
 *  retrieved notifications, each prefixed with its [n#] ref), then the most recent prior turns (capped
 *  at MAX_HISTORY_TURNS), then the new question. `refs` maps a notification id → its per-answer ref;
 *  core owns this prompt. */
export function buildChatMessages(
  context: ChatContext,
  refs: { ref: string; id: string }[],
  history: ChatTurn[],
  question: string,
): AiMessage[] {
  const { items, stats } = context;
  const refById = new Map(refs.map((r) => [r.id, r.ref]));
  const listing = items.length
    ? `Notifications you may reference (a sample — see the counts above for the full totals):\n${items
        .map((it) => line(it, refById.get(it.id) ?? "n?"))
        .join("\n")}`
    : "There are no notifications to reference.";
  const system = `${INSTRUCTIONS}\n\n${statsLine(stats)}\n\n${listing}`;
  return [
    { role: "system", content: system },
    ...history.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
}
