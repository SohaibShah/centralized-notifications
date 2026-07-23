import { expect, test } from "vitest";
import type { AiProvider, NotificationServiceConfig } from "../src/index";

test("NotificationServiceConfig accepts an ai provider", () => {
  const provider: AiProvider = { complete: async () => "ok" };
  const config: NotificationServiceConfig = { modules: [], ai: { provider } };
  expect(config.ai?.provider).toBe(provider);
});

test("a provider MAY implement completeStream (optional capability)", async () => {
  const streaming: AiProvider = {
    complete: async () => "x",
    completeStream: async function* () {
      yield "a";
      yield "b";
    },
  };
  const out: string[] = [];
  for await (const d of streaming.completeStream!([])) out.push(d);
  expect(out).toEqual(["a", "b"]);
  // A summary-only provider (no completeStream) still satisfies AiProvider.
  const summaryOnly: AiProvider = { complete: async () => "x" };
  expect(summaryOnly.completeStream).toBeUndefined();
});
