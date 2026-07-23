import type { AiProvider } from "@notifications/core";

/** Deterministic offline provider for the test lane (AI_PROVIDER=fake). NOT a product path — the
 *  running app always uses the real Ollama provider. */
export function createFakeProvider(): AiProvider {
  return {
    complete: async () =>
      "A few notifications need attention. Start with the highest-priority unactioned item.",
    completeStream: async function* () {
      for (const chunk of [
        "Based on your notifications, ",
        "the most urgent item is the DSR SLA breach [n1]. ",
        "Start there.",
      ]) {
        yield chunk;
      }
    },
  };
}
