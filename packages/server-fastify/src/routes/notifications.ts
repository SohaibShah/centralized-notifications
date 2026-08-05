import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { FEED_SORTS, FEED_VIEWS, NOTIFICATION_PRIORITIES } from "@notifications/shared";
import {
  ActionsDisabledError,
  InvalidCursorError,
  ModuleUnavailableError,
  NotFoundError,
  type NotificationService,
} from "@notifications/core";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

// A CSV query param (e.g. ?priority=critical,high) → trimmed, non-empty parts, or undefined when absent.
const csvToList = (v: string | undefined): string[] | undefined =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: z.enum(FEED_SORTS).default("newest"),
  view: z.enum(FEED_VIEWS).default("active"),
  group: z.string().min(1).max(300).optional(),
  // Structured filters for the grouped stacks (composed with grouping): only these priorities/modules
  // count toward a group; a group with no matching members drops out. Each priority is validated.
  priority: z
    .string()
    .max(200)
    .optional()
    .transform(csvToList)
    .pipe(z.array(z.enum(NOTIFICATION_PRIORITIES)).max(4).optional()),
  module: z
    .string()
    .max(300)
    .optional()
    .transform(csvToList)
    .pipe(z.array(z.string().max(100)).max(20).optional()),
  // Read-state filter for a group drill-in (peek / "See all") — undefined = both. Kept undefined when
  // absent (false is a real value: "only read"), so parse explicitly rather than defaulting.
  read: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // Query strings are text; z.coerce.boolean() would treat "false" as true, so parse explicitly.
  grouped: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const readParamsSchema = z.object({ id: z.string().min(1).max(200) });
// Bulk mark-read is either a list of ids ("Mark all read" over the loaded feed) or a whole group
// ("Mark all read" on a stack) — never both. `.strict()` on each arm enforces exactly-one: a body
// carrying both keys matches neither arm and is rejected.
const bulkReadSchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(500) }).strict(),
  z.object({ group: z.string().min(1).max(300) }).strict(),
]);

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
    // `grouped` lists stacks; `group` drills into one — they can't be combined.
    if (parsed.data.grouped && parsed.data.group !== undefined)
      return reply.code(400).send({ error: "grouped and group are mutually exclusive" });
    try {
      if (parsed.data.grouped) {
        const page = await service.listGrouped({
          principal,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
          sort: parsed.data.sort,
          priorities: parsed.data.priority,
          modules: parsed.data.module,
        });
        return reply.code(200).send(page);
      }
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
    if ("group" in parsed.data)
      await service.markReadGroup({ principal, group: parsed.data.group });
    else await service.markReadBulk({ principal, ids: parsed.data.ids });
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
