/** AI/summarize error types, in their own module so both the engine and the public index can import
 *  them without a cycle through service.ts. The Fastify adapter maps each to an HTTP status. */

/** `aiSummaryEnabled` is false — the feature is turned off (→ 404). */
export class AiDisabledError extends Error {
  constructor() {
    super("ai summary disabled");
    this.name = "AiDisabledError";
  }
}

/** No `config.ai` provider was injected — the host hasn't wired a model (→ 501). */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("ai not configured");
    this.name = "AiNotConfiguredError";
  }
}

/** Per-recipient summary rate limit exceeded (→ 429). */
export class AiRateLimitError extends Error {
  constructor() {
    super("ai rate limit");
    this.name = "AiRateLimitError";
  }
}

/** The injected provider failed (timeout, non-2xx, no content) (→ 502). */
export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}
