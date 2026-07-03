import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2's default variant is argon2id (the OWASP-recommended one). We
// rely on that default rather than importing the `Algorithm` const enum, which
// `verbatimModuleSyntax` disallows. If the library's default ever changes, pin it
// explicitly here.
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Verify a password against a stored hash. Returns false (never throws) on a
 *  malformed/unknown hash so callers can treat it as a failed login uniformly. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
