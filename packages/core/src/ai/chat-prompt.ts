import { NOTIFICATION_PRIORITIES, formatRelativeAge } from "@notifications/shared";
import type { AiMessage } from "../types";
import type { ChatContext, ChatContextItem, ChatContextStats } from "./retrieve";

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Most recent prior turns kept in the prompt. The HTTP boundary also caps this (zod, ≤8), but core
 *  enforces it too so a direct library caller can't blow up the context window or widen the
 *  prompt-injection surface with an unbounded history. */
const MAX_HISTORY_TURNS = 8;

const INSTRUCTIONS = [
  "You are an assistant that helps a user with THEIR notifications, and nothing else.",
  "Always respond in English.",
  "Answer ONLY from the notifications provided below — if the answer isn't in them, say you don't have that information. Never invent notifications.",
  "You do not write code, answer general-knowledge questions, do unrelated math, translate text, or roleplay. If asked to do anything that isn't about the user's notifications, briefly decline and offer to help with their notifications instead.",
  "The counts line gives the true totals across ALL the user's notifications; the list below it is a relevant sample and may not contain every item — use the counts for questions about totals or priority mix.",
  "Each notification is marked read or unread. Scope your answer to the question: use only unread items, only read items, or both, depending on what was asked.",
  "Write your answer as natural prose in full sentences. Do NOT reproduce the raw notification lines, their trailing parenthetical metadata (read/unread, priority, module, age), or a dash-separated description — refer to each notification by its title.",
  'The ONLY bracketed token on each notification line is its citation tag, like [n1] (read-state and priority are plain words, not brackets). When your answer mentions a specific notification, place that notification\'s exact [n#] tag immediately after its title, and make sure the tag matches the notification you are describing — never cite a different one. List several as separate tags like "[n1] [n2]". Only use tags that appear below.',
  'For "what is the newest / latest / most recent notification?", answer with the item named on the "Most recently received" line — do not infer recency yourself from the ages.',
  "Be concise.",
].join(" ");

function statsLine(stats: ChatContextStats): string {
  const buckets = NOTIFICATION_PRIORITIES.filter((p) => stats.byPriority[p] > 0)
    .map((p) => `${stats.byPriority[p]} ${p}`)
    .join(", ");
  if (stats.total === 0) return "The user currently has no notifications.";
  return `The user has ${stats.total} notification(s) in total (${buckets}); ${stats.unread} unread.`;
}

function line(i: ChatContextItem, ref: string): string {
  // [n#] is the ONLY bracketed token — read-state and priority are plain words in the parenthetical,
  // so the model doesn't confuse them with the citation tag (which caused wrong-notification chips).
  const cat = i.category ? `, ${i.category}` : "";
  const meta = `${i.read ? "read" : "unread"}, ${i.priority} priority, ${i.module}${cat}, ${formatRelativeAge(i.ageMinutes)} old${i.hasActions ? ", has actions" : ""}`;
  return `- [${ref}] ${i.title} — ${i.description} (${meta})`;
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

  // The list is ordered by relevance/priority, not recency, so state the newest explicitly rather
  // than making the model compare ages (which it does unreliably). Smallest age = most recent; the
  // recency retrieval arm guarantees the true newest is in this sample.
  const newest = items.length
    ? items.reduce((a, b) => (b.ageMinutes < a.ageMinutes ? b : a))
    : undefined;
  const recentLine = newest
    ? `Most recently received: [${refById.get(newest.id) ?? "n?"}] "${newest.title}" (${formatRelativeAge(newest.ageMinutes)} old).\n\n`
    : "";

  const system = `${INSTRUCTIONS}\n\n${statsLine(stats)}\n\n${recentLine}${listing}`;
  return [
    { role: "system", content: system },
    ...history.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
}
