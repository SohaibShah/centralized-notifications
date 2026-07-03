import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const base = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
  SESSION_SECRET: "a".repeat(64),
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
});
