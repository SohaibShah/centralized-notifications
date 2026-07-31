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
  // Shared secret producers present as the `x-internal-token` header on
  // POST /internal/publish (service-to-service intake boundary). Generate with
  // `openssl rand -hex 24`; validated at startup like every other secret.
  INTERNAL_INTAKE_TOKEN: z.string().min(16, "INTERNAL_INTAKE_TOKEN must be at least 16 characters"),
  // Shared secret this backend presents as `x-module-dispatch-token` when it calls out to a
  // module's `dispatch` action endpoint (service-to-service, like INTERNAL_INTAKE_TOKEN but
  // outbound instead of inbound). Generate with `openssl rand -hex 24`.
  MODULE_DISPATCH_TOKEN: z.string().min(16, "MODULE_DISPATCH_TOKEN must be at least 16 characters"),
  PORT: z.coerce.number().int().positive().default(3000),
  // AI summarizer provider. Real Ollama by default; `fake` selects the deterministic test-lane
  // provider. No secret is required for local Ollama; AI_API_KEY is only for a cloud/scaled
  // endpoint and is never logged or returned to the browser.
  AI_PROVIDER: z.enum(["real", "fake"]).default("real"),
  AI_BASE_URL: z.string().url().default("http://localhost:11434/v1"),
  AI_MODEL: z.string().min(1).default("qwen2.5:7b"),
  AI_API_KEY: z.string().min(1).optional(),
  // Master switch for the in-process daily-summary scheduler. Defaults on; set "false" to disable
  // (e.g. a deploy that runs the scheduler elsewhere). Never runs under NODE_ENV=test regardless.
  SUMMARY_SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
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
