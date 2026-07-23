import { expect, test } from "vitest";
import type { AiProvider, NotificationServiceConfig } from "../src/index";

test("NotificationServiceConfig accepts an ai provider", () => {
  const provider: AiProvider = { complete: async () => "ok" };
  const config: NotificationServiceConfig = { modules: [], ai: { provider } };
  expect(config.ai?.provider).toBe(provider);
});
