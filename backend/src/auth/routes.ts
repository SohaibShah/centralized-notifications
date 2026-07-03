import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env";
import { getSessionUser, requireUser } from "./guards";
import { hashPassword, verifyPassword } from "./password";
import { getUserByUsername } from "./repository";
import { clearSession, setSessionUser } from "./session";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

// Normalizes login timing so a missing username can't be distinguished from a
// wrong password by response time (avoids user enumeration). Always runs one
// verify: against the real hash if the user exists, else a throwaway hash.
let dummyHash: string | undefined;
async function verifyWithTimingGuard(
  passwordHash: string | undefined,
  password: string,
): Promise<boolean> {
  dummyHash ??= await hashPassword("timing-guard-placeholder");
  const ok = await verifyPassword(passwordHash ?? dummyHash, password);
  return passwordHash ? ok : false;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Tight per-IP limit on the credential endpoint — argon2 verify is CPU/memory
  // heavy, so this bounds brute-force and DoS. Relaxed under test so the suite's
  // many rapid logins from one IP aren't throttled. (Requires @fastify/rate-limit
  // registered in buildServer.)
  const loginRateLimit = {
    max: getEnv().NODE_ENV === "test" ? 1000 : 10,
    timeWindow: "1 minute",
  };

  app.post("/auth/login", { config: { rateLimit: loginRateLimit } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });

    const { username, password } = parsed.data;
    const userRow = await getUserByUsername(username);
    const ok = await verifyWithTimingGuard(userRow?.password_hash, password);
    if (!userRow || !ok) return reply.code(401).send({ error: "invalid credentials" });

    setSessionUser(req, userRow.id);
    const user = await getSessionUser(req);
    if (!user) return reply.code(500).send({ error: "failed to load session user" });
    return reply.code(200).send({ user });
  });

  app.post("/auth/logout", async (req, reply) => {
    clearSession(req);
    return reply.code(204).send();
  });

  app.get("/auth/me", { preHandler: requireUser }, async (req, reply) => {
    return reply.send({ user: req.user });
  });
}
