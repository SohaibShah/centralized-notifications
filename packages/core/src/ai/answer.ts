import type { ChatSource } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { AiProvider, Principal, Settings } from "../types";
import { AiDisabledError, AiNotConfiguredError, AiProviderError, AiRateLimitError } from "./errors";
import { buildChatMessages, type ChatTurn } from "./chat-prompt";
import { retrieveForAnswer } from "./retrieve";

export type { ChatTurn };

/** The stream the chat endpoint turns into SSE: the trusted grounding set first, then token deltas.
 *  `ChatSource` (the wire contract) lives in `@notifications/shared` so the browser client can name
 *  it without depending on this server library. */
export type AnswerChunk =
  { type: "sources"; sources: ChatSource[] } | { type: "delta"; text: string };

const RATE_LIMIT = 10; // chat turns per recipient per minute

/**
 * Streaming Q/A over a principal's audience-scoped notifications. Owns gating, the per-recipient rate
 * limit, retrieval, the prompt, and the provider stream. Never logs the context, question, history, or
 * output (PII). Single-instance rate limiter, like the summarizer.
 */
export class AnswerEngine {
  private readonly calls = new Map<string, number[]>();
  constructor(
    private readonly deps: {
      query: QueryFn;
      getSettings: () => Promise<Settings>;
      provider?: AiProvider;
    },
  ) {}

  async *answer(args: {
    principal: Principal;
    question: string;
    history: ChatTurn[];
  }): AsyncIterable<AnswerChunk> {
    if (!(await this.deps.getSettings()).chatbotEnabled) throw new AiDisabledError();
    const provider = this.deps.provider;
    if (!provider?.completeStream) throw new AiNotConfiguredError();
    this.checkRate(args.principal.userKey);

    const context = await retrieveForAnswer(this.deps.query, args.principal, args.question);
    const sources: ChatSource[] = context.items.map((it, i) => ({
      ref: `n${i + 1}`,
      id: it.id,
      title: it.title,
      priority: it.priority,
      ageMinutes: it.ageMinutes,
      actions: it.actions,
    }));
    yield { type: "sources", sources };

    const messages = buildChatMessages(
      context,
      sources.map((s) => ({ ref: s.ref, id: s.id })),
      args.history,
      args.question,
    );
    try {
      for await (const text of provider.completeStream(messages, {
        temperature: 0.2,
        maxTokens: 500,
      })) {
        yield { type: "delta", text };
      }
    } catch (err) {
      throw new AiProviderError(err instanceof Error ? err.message : String(err));
    }
  }

  private checkRate(userKey: string): void {
    const now = Date.now();
    const recent = (this.calls.get(userKey) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= RATE_LIMIT) throw new AiRateLimitError();
    recent.push(now);
    this.calls.set(userKey, recent);
  }
}
