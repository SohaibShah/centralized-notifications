import type { QueryFn } from "../db";
import type { AiProvider, Principal, Settings } from "../types";
import { AiDisabledError, AiNotConfiguredError, AiProviderError, AiRateLimitError } from "./errors";
import { buildChatMessages, type ChatTurn } from "./chat-prompt";
import { retrieveForAnswer } from "./retrieve";

export type { ChatTurn };

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
  }): AsyncIterable<string> {
    if (!(await this.deps.getSettings()).chatbotEnabled) throw new AiDisabledError();
    const provider = this.deps.provider;
    if (!provider?.completeStream) throw new AiNotConfiguredError();
    this.checkRate(args.principal.userKey);

    const context = await retrieveForAnswer(this.deps.query, args.principal, args.question);
    const messages = buildChatMessages(context, args.history, args.question);
    try {
      yield* provider.completeStream(messages, { temperature: 0.2, maxTokens: 500 });
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
