import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool";
import { requireUser } from "./guards";

const timezoneBodySchema = z.object({ timezone: z.string().min(1).max(100) });

/** True if the IANA zone is one the runtime recognizes. Constructing a formatter throws RangeError
 *  for an unknown zone — a lib-version-independent check (no reliance on Intl.supportedValuesOf). */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Self-service profile endpoints owned by the host (identity lives here, not in the library).
 * `PATCH /me/timezone` lets a user set their own IANA timezone, which the summary scheduler reads to
 * generate each user's digest in their local morning. Scoped to the session user — a user can only
 * change their own timezone.
 */
export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/me/timezone", { preHandler: requireUser }, async (req, reply) => {
    const body = timezoneBodySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });
    if (!isValidTimeZone(body.data.timezone)) {
      return reply.code(400).send({ error: "unknown timezone" });
    }
    await query("UPDATE users SET timezone = $1 WHERE id = $2", [body.data.timezone, req.user!.id]);
    return reply.code(200).send({ timezone: body.data.timezone });
  });
}
