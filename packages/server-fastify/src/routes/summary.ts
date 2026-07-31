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

  // An opted-out user's summary is suppressed everywhere: the panel shows an "off" state instead of
  // the digest + reload button. Reported as `optedOut` alongside the (empty) stored shape.
  const EMPTY = { summary: null, basedOn: 0, generatedAt: null };

  app.get("/notifications/summary", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    if ((await service.getPreferences({ principal })).summaryOptOut) {
      return reply.code(200).send({ optedOut: true, ...EMPTY });
    }
    // A plain read of the persisted summary — it never calls the AI provider, so there is no
    // provider/disabled error to map here. Feature gating (aiSummaryEnabled) is the consumer's
    // concern (the panel hides the whole section); the stored read stays contract-simple.
    const stored = await service.getStoredSummary({ principal });
    return reply.code(200).send({ optedOut: false, ...(stored ?? EMPTY) });
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
      if ((await service.getPreferences({ principal })).summaryOptOut) {
        return reply.code(200).send({ optedOut: true, ...EMPTY });
      }
      try {
        return reply
          .code(200)
          .send({ optedOut: false, ...(await service.refreshSummary({ principal })) });
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
