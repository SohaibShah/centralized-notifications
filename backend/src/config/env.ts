import { z } from "zod";

/**
 * Runtime configuration, validated once at process startup (fail-fast). Nothing
 * else in the backend should read `process.env` directly — go through `getEnv()`
 * so a missing/invalid var surfaces immediately with a readable error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  // 32-byte key (hex) for @fastify/secure-session; generate with `openssl rand -hex 32`.
  SESSION_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "SESSION_SECRET must be 64 hex characters (32 bytes)"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

/** Pure parse — used by tests and by getEnv(). Throws a readable error if invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily validate process.env on first use, so importing this module is side-effect free. */
export function getEnv(): Env {
  return (cached ??= loadEnv());
}
