import {
  createNotificationService,
  type AiProvider,
  type NotificationService,
} from "@notifications/core";
import { type Env, getEnv } from "../config/env";
import { getPool } from "../db/pool";
import { REFERENCE_CATALOG } from "./catalog";
import { createFakeProvider } from "./ai/fake-provider";
import { createOpenAiProvider } from "./ai/openai-provider";

/** Real Ollama provider by default; the fake only when AI_PROVIDER=fake (test lane). So `pnpm dev`
 *  always gives a live model; the automated suites opt into the deterministic fake. */
export function buildAiProvider(env: Env = getEnv()): AiProvider {
  if (env.AI_PROVIDER === "fake") return createFakeProvider();
  return createOpenAiProvider({
    baseUrl: env.AI_BASE_URL,
    model: env.AI_MODEL,
    apiKey: env.AI_API_KEY,
  });
}

/**
 * Build the notification service the way any host would: inject our pg pool + our module catalog +
 * an AI provider. The caller must `await service.ready()` once before serving.
 */
export function createReferenceService(): NotificationService {
  return createNotificationService({
    pool: getPool(),
    config: { modules: REFERENCE_CATALOG, adminRole: "admin", ai: { provider: buildAiProvider() } },
  });
}
