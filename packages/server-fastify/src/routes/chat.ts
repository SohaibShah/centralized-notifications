import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiProviderError,
  AiRateLimitError,
  type NotificationService,
} from "@notifications/core";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .max(8)
    .default([]),
});

/**
 * Streaming Q/A: `POST /notifications/chat` answers a question grounded in the caller's
 * audience-scoped notifications. Gated by `requirePrincipal`; the core service enforces the
 * chatbotEnabled flag + a streaming provider. The answer is an async generator whose first `.next()`
 * runs the gate/rate-limit/retrieval — so we advance it once BEFORE hijacking, mapping a pre-stream
 * throw to a normal JSON status; only after the first token do we commit to an SSE stream.
 */
export function notificationChatRoute(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;

  app.post("/notifications/chat", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });

    const iter = service
      .answer({ principal, question: parsed.data.question, history: parsed.data.history })
      [Symbol.asyncIterator]();

    let step: IteratorResult<string>;
    try {
      step = await iter.next();
    } catch (err) {
      if (err instanceof AiDisabledError) return reply.code(404).send({ error: "chat disabled" });
      if (err instanceof AiNotConfiguredError)
        return reply.code(501).send({ error: "ai not configured" });
      if (err instanceof AiRateLimitError) return reply.code(429).send({ error: "rate limited" });
      if (err instanceof AiProviderError)
        return reply.code(502).send({ error: "chat unavailable" });
      throw err;
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (s: string) => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(s);
        } catch {
          /* client vanished */
        }
      }
    };
    try {
      while (!step.done) {
        write(`data: ${JSON.stringify({ delta: step.value })}\n\n`);
        step = await iter.next();
      }
      write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch {
      write(`event: error\ndata: ${JSON.stringify({ error: "stream failed" })}\n\n`);
    } finally {
      res.end();
    }
  });
}
