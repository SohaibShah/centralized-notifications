import secureSession from "@fastify/secure-session";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { getEnv } from "../config/env";

declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;
  }
}

const COOKIE_NAME = "session";

/**
 * Stateless encrypted-cookie sessions. The cookie carries only the user id,
 * encrypted+signed with SESSION_SECRET. Reading the id back out is the single
 * seam production later swaps for the host application's identity.
 */
export async function registerSession(app: FastifyInstance): Promise<void> {
  const env = getEnv();
  await app.register(secureSession, {
    key: Buffer.from(env.SESSION_SECRET, "hex"),
    cookieName: COOKIE_NAME,
    expiry: 60 * 60 * 8, // seconds — the encrypted token is rejected after 8h
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: env.NODE_ENV === "production",
      maxAge: 60 * 60 * 8,
    },
  });
}

export function setSessionUser(req: FastifyRequest, userId: string): void {
  req.session.set("userId", userId);
}

export function clearSession(req: FastifyRequest): void {
  req.session.delete();
}

export function getSessionUserId(req: FastifyRequest): string | null {
  const userId = req.session.get("userId");
  return typeof userId === "string" ? userId : null;
}
