import type { FastifyInstance } from "fastify";
import { CONTROL_CENTER_HTML } from "../page";

/**
 * Registers `GET /` — the self-contained control-center dev tool (Custom / Preset / Burst
 * panels) that replaces the old admin generator (removed separately, Task 14). The page is a
 * static string (see `page.ts`'s doc comment for why it's inlined rather than read from
 * disk), so this route is just a content-type-correct echo of it.
 */
export function registerPageRoute(app: FastifyInstance): void {
  app.get("/", async (_req, reply) => {
    reply.type("text/html; charset=utf-8").send(CONTROL_CENTER_HTML);
  });
}
