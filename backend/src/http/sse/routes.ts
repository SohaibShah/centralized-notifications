import type { FastifyInstance } from "fastify";
import type { Notification } from "@notifications/shared";
import { requireUser } from "../../auth/guards";
import { deliveryHub } from "../../delivery/hub";
import { CoalescingBuffer } from "./coalescing-buffer";

// Bursts within this window are delivered to a client as one batched SSE frame.
const COALESCE_WINDOW_MS = 100;
// Keeps intermediaries (and the browser) from treating an idle stream as dead.
const HEARTBEAT_MS = 25_000;
// If a client stops reading and Node's outgoing buffer grows past this, treat the
// connection as gone and drop it rather than accumulating notifications in memory.
const MAX_BUFFERED_BYTES = 1024 * 1024;

/**
 * Real-time delivery (FR-5): `GET /sse` streams notifications to the authenticated
 * user over Server-Sent Events. Each connection subscribes to the in-process delivery
 * hub and coalesces bursts into batched `event: notifications` frames. Auth is the
 * session cookie (EventSource sends it same-origin), so it reuses `requireUser`.
 *
 * Week-1 limitation: the hub broadcasts every accepted notification to all connected
 * users (no audience filtering yet) — Week-4 audience resolution scopes this per user.
 */
export async function sseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sse", { preHandler: requireUser }, async (req, reply) => {
    // requireUser (preHandler) already 401s and short-circuits without a user; this is
    // defensive belt-and-suspenders that also narrows the type for `user.id` below.
    const user = req.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });

    // Take over the socket: Fastify won't send its own response from here on.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // don't let a reverse proxy buffer the stream
    });

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(heartbeat);
      unsubscribe();
      buffer.close();
    };

    // A single guarded write path: never throw out of a timer/interval (a dead socket
    // otherwise surfaces as an uncaught exception that would take the whole process —
    // and every other SSE client — down), and stop touching a socket that's gone.
    const safeWrite = (chunk: string): void => {
      if (cleanedUp || res.writableEnded || res.destroyed) return;
      try {
        res.write(chunk);
      } catch {
        cleanup(); // client vanished between the check and the write
      }
    };

    const buffer = new CoalescingBuffer<Notification>(COALESCE_WINDOW_MS, (batch) => {
      // A client this far behind is effectively gone; drop it instead of buffering.
      if (res.writableLength > MAX_BUFFERED_BYTES) {
        res.destroy();
        return;
      }
      safeWrite(`event: notifications\ndata: ${JSON.stringify(batch)}\n\n`);
    });

    const unsubscribe = deliveryHub.subscribe({
      userId: user.id,
      deliver: (notification) => buffer.push(notification),
    });

    const heartbeat = setInterval(() => safeWrite(": heartbeat\n\n"), HEARTBEAT_MS);
    heartbeat.unref(); // don't keep the process alive for a heartbeat alone

    // All state is initialized above, so it's now safe for a failed write to run cleanup.
    safeWrite("retry: 3000\n\n"); // advise the client's reconnect backoff
    safeWrite(": connected\n\n"); // comment frame: stream is open

    // Normal disconnect fires "close"; an abrupt reset fires "error" (which must have a
    // listener, or Node throws it as unhandled). Both run the same idempotent cleanup.
    req.raw.on("close", cleanup);
    res.on("error", cleanup);
  });
}
