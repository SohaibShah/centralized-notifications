import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Notification } from "@notifications/shared";
import { CoalescingBuffer, type NotificationService } from "@notifications/core";

// Bursts within this window are delivered to a client as one batched SSE frame.
const COALESCE_WINDOW_MS = 100;
// Keeps intermediaries (and the browser) from treating an idle stream as dead.
const HEARTBEAT_MS = 25_000;
// If a client stops reading and Node's outgoing buffer grows past this, drop the connection rather
// than accumulating notifications in memory.
const MAX_BUFFERED_BYTES = 1024 * 1024;

/**
 * Real-time delivery: `GET /sse` streams notifications to the authenticated principal over SSE. Each
 * connection subscribes to the service's delivery hub with its Principal (captured at connect time);
 * the hub matches each published notification's audience against it. Bursts coalesce into batched
 * `event: notifications` frames.
 */
export function notificationSseRoute(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;

  app.get("/sse", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });

    // Take over the socket: Fastify won't send its own response from here on.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(heartbeat);
      unsubscribe();
      buffer.close();
    };

    // A single guarded write path: never throw out of a timer (a dead socket would otherwise surface
    // as an uncaught exception taking the whole process down), and stop touching a gone socket.
    const safeWrite = (chunk: string): void => {
      if (cleanedUp || res.writableEnded || res.destroyed) return;
      try {
        res.write(chunk);
      } catch {
        cleanup();
      }
    };

    const buffer = new CoalescingBuffer<Notification>(COALESCE_WINDOW_MS, (batch) => {
      if (res.writableLength > MAX_BUFFERED_BYTES) {
        res.destroy();
        return;
      }
      safeWrite(`event: notifications\ndata: ${JSON.stringify(batch)}\n\n`);
    });

    const unsubscribe = service.delivery.subscribe({
      principal,
      deliver: (notification) => buffer.push(notification),
    });

    const heartbeat = setInterval(() => safeWrite(": heartbeat\n\n"), HEARTBEAT_MS);
    heartbeat.unref();

    safeWrite("retry: 3000\n\n"); // advise the client's reconnect backoff
    safeWrite(": connected\n\n"); // comment frame: stream is open

    req.raw.on("close", cleanup);
    res.on("error", cleanup);
  });
}
