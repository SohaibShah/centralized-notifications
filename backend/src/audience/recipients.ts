import type { Audience } from "@notifications/shared";
import { query } from "../db/pool";

/**
 * WHO a live notification reaches: the ids the delivery hub keys subscribers by
 * (`Subscriber.userId` = internal user id today), or "all" for global (caller broadcasts).
 * Backed by the internal membership tables now; the host resolves this at extraction.
 */
export async function resolveRecipients(audience: Audience): Promise<string[] | "all"> {
  if (audience.scope === "global") return "all";
  if (!audience.id) return []; // schema guarantees an id for non-global; defensive
  const byScope: Record<"user" | "team" | "role", string> = {
    user: "SELECT id AS user_id FROM users WHERE username = $1",
    team: "SELECT user_id FROM user_teams WHERE team_key = $1",
    role: "SELECT user_id FROM user_roles WHERE role_key = $1",
  };
  const { rows } = await query<{ user_id: string }>(byScope[audience.scope], [audience.id]);
  return rows.map((row) => row.user_id);
}
