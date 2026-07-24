import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { moduleActionResponseSchema, type ModuleActionResponse } from "@notifications/shared";
import type { AppConfig } from "../app";
import { lookupModule } from "../modules/registry";

interface ActionParams {
  module: string;
  name: string;
}

// The hub POSTs `{ notificationId, actionRef, metadata, actor }`; module handlers only need
// `notificationId`/`metadata`, so extra fields (actionRef, actor) pass through untouched rather
// than being rejected. A GET dispatch (see catalog entries with method "GET", e.g. assessments'
// snooze) has no body, so the same fields are also accepted as query-string params — merged
// below with the JSON body taking precedence when both are present.
const bodySchema = z
  .object({
    notificationId: z.string().min(1),
    metadata: z.unknown().optional(),
  })
  .passthrough();

/**
 * Constant-time comparison of the dispatch token (length mismatch short-circuits first, so
 * `timingSafeEqual` — which throws on unequal-length buffers — is never called with mismatched
 * inputs). Mirrors backend/src/server.ts's `intakeTokenMatches`.
 */
function dispatchTokenMatches(req: FastifyRequest, expected: string): boolean {
  const header = req.headers["x-module-dispatch-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Registers `POST|GET /:module/actions/:name` — the endpoint the hub calls when a user clicks a
 * dispatch action (the `path` on a `kind: "dispatch"` NotificationAction, resolved against the
 * module's registered `base_url`). Token-gated (401), 404s an unknown module or action name, and
 * never lets a malformed body or a throwing handler crash the process — both degrade to a 400
 * `{ ok: false }` response instead.
 */
export function registerActionRoutes(app: FastifyInstance, config: AppConfig): void {
  const handler = async (
    req: FastifyRequest<{ Params: ActionParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    if (!dispatchTokenMatches(req, config.dispatchToken)) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }

    const mod = lookupModule(req.params.module);
    if (!mod) {
      reply.code(404).send({ error: "unknown module" });
      return;
    }

    const entry = mod.catalog.find((candidate) => candidate.name === req.params.name);
    if (!entry) {
      reply.code(404).send({ error: "unknown action" });
      return;
    }

    const merged = {
      ...(isRecord(req.query) ? req.query : {}),
      ...(isRecord(req.body) ? req.body : {}),
    };
    const parsedBody = bodySchema.safeParse(merged);
    if (!parsedBody.success) {
      const invalid: ModuleActionResponse = { ok: false, message: "invalid request body" };
      reply.code(400).send(invalid);
      return;
    }

    let result: ModuleActionResponse;
    try {
      result = mod.handle(req.params.name, parsedBody.data);
    } catch {
      const failed: ModuleActionResponse = { ok: false, message: "Action failed" };
      reply.code(400).send(failed);
      return;
    }

    const validated = moduleActionResponseSchema.safeParse(result);
    if (!validated.success) {
      const failed: ModuleActionResponse = { ok: false, message: "Action failed" };
      reply.code(400).send(failed);
      return;
    }

    reply.code(200).send(validated.data);
  };

  app.post("/:module/actions/:name", handler);
  app.get("/:module/actions/:name", handler);
}
