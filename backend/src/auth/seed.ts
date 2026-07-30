import { query } from "../db/pool";
import { hashPassword } from "./password";

/**
 * Prototype seed data. All users share one known dev password — this is a
 * developer-studio prototype, so it's documented, not a secret. Idempotent:
 * safe to run repeatedly (upserts roles/teams/users, resets memberships).
 */
export const DEV_PASSWORD = "notify-dev-2026";

const ROLES = [
  { key: "admin", label: "Administrator" },
  { key: "privacy-analyst", label: "Privacy Analyst" },
  { key: "security-reviewer", label: "Security Reviewer" },
  { key: "access-approver", label: "Access Approver" },
];

const TEAMS = [
  { key: "privacy-ops", label: "Privacy Operations" },
  { key: "security", label: "Security" },
];

const USERS = [
  {
    username: "admin",
    displayName: "Admin User",
    roles: ["admin"],
    teams: [] as string[],
    timezone: "America/New_York",
  },
  {
    username: "priya",
    displayName: "Priya Nair",
    roles: ["privacy-analyst"],
    teams: ["privacy-ops"],
    timezone: "Asia/Kolkata",
  },
  {
    username: "sam",
    displayName: "Sam Okafor",
    roles: ["security-reviewer"],
    teams: ["security"],
    timezone: "Europe/London",
  },
  {
    username: "alex",
    displayName: "Alex Chen",
    roles: ["access-approver"],
    teams: [] as string[],
    timezone: "Asia/Singapore",
  },
  {
    username: "jordan",
    displayName: "Jordan Lee",
    roles: [] as string[],
    teams: ["privacy-ops"],
    timezone: "America/Los_Angeles",
  },
];

export async function seedIdentity(): Promise<void> {
  for (const role of ROLES) {
    await query(
      "INSERT INTO roles (key, label) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label",
      [role.key, role.label],
    );
  }
  for (const team of TEAMS) {
    await query(
      "INSERT INTO teams (key, label) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label",
      [team.key, team.label],
    );
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const user of USERS) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (username, display_name, password_hash, timezone)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE
         SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash,
             timezone = EXCLUDED.timezone
       RETURNING id`,
      [user.username, user.displayName, passwordHash, user.timezone],
    );
    const userId = rows[0]?.id;
    if (!userId) throw new Error(`failed to upsert user ${user.username}`);

    await query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
    for (const roleKey of user.roles) {
      await query(
        "INSERT INTO user_roles (user_id, role_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, roleKey],
      );
    }
    await query("DELETE FROM user_teams WHERE user_id = $1", [userId]);
    for (const teamKey of user.teams) {
      await query(
        "INSERT INTO user_teams (user_id, team_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, teamKey],
      );
    }
  }
}
