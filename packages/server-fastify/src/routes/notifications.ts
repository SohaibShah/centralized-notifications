import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { FEED_SORTS } from "@notifications/shared";
import {
  ActionsDisabledError,
  InvalidCursorError,
  ModuleUnavailableError,
  NotFoundError,
  type NotificationService,
} from "@notifications/core";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: z.enum(FEED_SORTS).default("newest"),
});

const readParamsSchema = z.object({ id: z.string().min(1).max(200) });
const bulkReadSchema = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(500) });

const dispatchParamsSchema = z.object({
  id: z.string().min(1).max(200),
  ref: z.string().regex(/^\d+$/),
});
const dispatchBodySchema = z.object({ idempotencyKey: z.string().min(1).max(200) });

/** The audience-scoped read + read-state routes, gated by `requirePrincipal`. */
export function notificationReadRoutes(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;

  app.get("/notifications", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid query parameters" });
    try {
      const page = await service.list({ principal, ...parsed.data });
      return reply.code(200).send(page);
    } catch (err) {
      if (err instanceof InvalidCursorError)
        return reply.code(400).send({ error: "invalid cursor" });
      throw err;
    }
  });

  app.get("/notifications/counts", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    return reply.code(200).send(await service.counts({ principal }));
  });

  app.post("/notifications/:id/read", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const parsed = readParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid notification id" });
    try {
      await service.markRead({ principal, id: parsed.data.id });
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ error: "notification not found" });
      throw err;
    }
  });

  app.delete("/notifications/:id/read", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const parsed = readParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid notification id" });
    await service.markUnread({ principal, id: parsed.data.id });
    return reply.code(204).send();
  });

  app.post("/notifications/read", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const parsed = bulkReadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
    await service.markReadBulk({ principal, ids: parsed.data.ids });
    return reply.code(204).send();
  });

  app.post(
    "/notifications/:id/actions/:ref/dispatch",
    {
      preHandler: requirePrincipal,
      // Per-principal (falls back to per-IP pre-auth/for anonymous-key hosts) limit so a scripted
      // client can't flood a module or pile up `action_dispatches` rows. No-op unless the host has
      // registered @fastify/rate-limit (see backend/src/server.ts, `global: false` — only routes
      // that opt in are limited); mirrors the shape of `/auth/login`'s limit in backend/src/auth/routes.ts.
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.principal?.userKey ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal;
      if (!principal) return reply.code(401).send({ error: "authentication required" });
      const p = dispatchParamsSchema.safeParse(req.params);
      const b = dispatchBodySchema.safeParse(req.body);
      if (!p.success || !b.success) return reply.code(400).send({ error: "invalid request" });
      try {
        const result = await service.dispatchAction({
          principal,
          notificationId: p.data.id,
          actionRef: p.data.ref,
          idempotencyKey: b.data.idempotencyKey,
        });
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof ActionsDisabledError)
          return reply.code(403).send({ error: "actions disabled" });
        if (err instanceof ModuleUnavailableError)
          return reply.code(409).send({ error: "module unavailable" });
        if (err instanceof NotFoundError)
          return reply.code(404).send({ error: "notification or action not found" });
        throw err;
      }
    },
  );
}
