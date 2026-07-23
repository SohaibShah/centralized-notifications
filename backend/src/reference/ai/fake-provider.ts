import type { AiProvider } from "@notifications/core";

/** Deterministic offline provider for the test lane (AI_PROVIDER=fake). NOT a product path — the
 *  running app always uses the real Ollama provider. */
export function createFakeProvider(): AiProvider {
  return {
    complete: async () =>
      "A few notifications need attention. Start with the highest-priority unactioned item.",
  };
}
