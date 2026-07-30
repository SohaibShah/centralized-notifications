import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
  type NotificationService,
} from "@notifications/core";

/** Summary read (persisted) + manual refresh (regenerate + persist). Gated by `requirePrincipal`;
 *  the core service enforces the aiSummaryEnabled flag + provider availability + per-recipient rate. */
export function notificationSummaryRoute(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;

  app.get("/notifications/summary", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    try {
      const stored = await service.getStoredSummary({ principal });
      if (!stored) return reply.code(200).send({ summary: null, basedOn: 0, generatedAt: null });
      return reply.code(200).send(stored);
    } catch (err) {
      if (err instanceof AiDisabledError)
        return reply.code(404).send({ error: "ai summary disabled" });
      throw err;
    }
  });

  app.post(
    "/notifications/summary/refresh",
    {
      preHandler: requirePrincipal,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.principal?.userKey ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal;
      if (!principal) return reply.code(401).send({ error: "authentication required" });
      try {
        return reply.code(200).send(await service.refreshSummary({ principal }));
      } catch (err) {
        if (err instanceof AiDisabledError)
          return reply.code(404).send({ error: "ai summary disabled" });
        if (err instanceof AiNotConfiguredError)
          return reply.code(501).send({ error: "ai not configured" });
        if (err instanceof AiRateLimitError) return reply.code(429).send({ error: "rate limited" });
        if (err instanceof AiProviderError)
          return reply.code(502).send({ error: "summary unavailable" });
        throw err;
      }
    },
  );
}
