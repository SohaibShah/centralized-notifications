import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";
import { buildAiProvider } from "../src/reference/service";

const base = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
  SESSION_SECRET: "a".repeat(64),
  INTERNAL_INTAKE_TOKEN: "x".repeat(32),
} satisfies NodeJS.ProcessEnv;

describe("buildAiProvider", () => {
  it("returns the deterministic fake when AI_PROVIDER=fake", async () => {
    const provider = buildAiProvider(loadEnv({ ...base, AI_PROVIDER: "fake" }));
    const out = await provider.complete([{ role: "user", content: "hi" }]);
    expect(out).toContain("Start with");
  });

  it("returns a provider (the real OpenAI adapter) by default — a complete() fn, no network call", () => {
    const provider = buildAiProvider(loadEnv({ ...base }));
    expect(typeof provider.complete).toBe("function");
  });
});
