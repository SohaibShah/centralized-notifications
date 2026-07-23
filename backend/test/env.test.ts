import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const base = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
  SESSION_SECRET: "a".repeat(64),
  INTERNAL_INTAKE_TOKEN: "x".repeat(32),
} satisfies NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("parses a valid environment with defaults", () => {
    const env = loadEnv({ ...base });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
  });

  it("coerces PORT from a string", () => {
    expect(loadEnv({ ...base, PORT: "8080" }).PORT).toBe(8080);
  });

  it("throws when SESSION_SECRET is missing", () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/SESSION_SECRET/);
  });

  it("throws when SESSION_SECRET is not 64 hex characters", () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: "too-short" })).toThrow();
  });

  it("defaults the AI provider config and accepts AI_PROVIDER=fake", () => {
    const env = loadEnv({ ...base });
    expect(env.AI_PROVIDER).toBe("real");
    expect(env.AI_BASE_URL).toBe("http://localhost:11434/v1");
    expect(env.AI_MODEL).toBe("qwen2.5:7b");
    expect(loadEnv({ ...base, AI_PROVIDER: "fake" }).AI_PROVIDER).toBe("fake");
  });

  it("throws when INTERNAL_INTAKE_TOKEN is missing or too short", () => {
    const { INTERNAL_INTAKE_TOKEN: _omit, ...withoutToken } = base;
    expect(() => loadEnv(withoutToken)).toThrow(/INTERNAL_INTAKE_TOKEN/);
    expect(() => loadEnv({ ...base, INTERNAL_INTAKE_TOKEN: "short" })).toThrow(
      /INTERNAL_INTAKE_TOKEN/,
    );
  });
});
