import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
  type NotificationService,
} from "@notifications/core";

/** The AI triage summary of the caller's audience-scoped unread set. Gated by `requirePrincipal`;
 *  the core service enforces the aiSummaryEnabled flag + provider availability. */
export function notificationSummaryRoute(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;
  app.get("/notifications/summary", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    try {
      return reply.code(200).send(await service.summarize({ principal }));
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
  });
}
