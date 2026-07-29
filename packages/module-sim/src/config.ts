import { z } from "zod";

/**
 * Runtime configuration for module-sim, validated once at process startup
 * (fail-fast), mirroring backend/src/config/env.ts. `loadConfig` is the only
 * thing that reads `process.env` — importing this module is side-effect free.
 */
const configSchema = z.object({
  MODULE_SIM_PORT: z.coerce.number().int().positive().default(4000),
  HUB_URL: z.string().min(1).default("http://localhost:3000"),
  // Shared secret this service presents as `x-internal-token` when it publishes
  // simulated notifications to the hub's POST /internal/publish. Same secret as
  // backend's INTERNAL_INTAKE_TOKEN — generate with `openssl rand -hex 24`.
  INTERNAL_INTAKE_TOKEN: z.string().min(16, "INTERNAL_INTAKE_TOKEN must be at least 16 characters"),
  // Shared secret the hub presents as `x-module-dispatch-token` when it calls this
  // service's dispatch action endpoint. Same secret as backend's MODULE_DISPATCH_TOKEN.
  MODULE_DISPATCH_TOKEN: z.string().min(16, "MODULE_DISPATCH_TOKEN must be at least 16 characters"),
});

export interface Config {
  port: number;
  hubUrl: string;
  intakeToken: string;
  dispatchToken: string;
}

/** Validates `source` and maps it onto the `Config` shape used by `buildApp`. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const {
    MODULE_SIM_PORT: port,
    HUB_URL: hubUrl,
    INTERNAL_INTAKE_TOKEN: intakeToken,
    MODULE_DISPATCH_TOKEN: dispatchToken,
  } = result.data;
  return { port, hubUrl, intakeToken, dispatchToken };
}
