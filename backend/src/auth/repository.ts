import { query } from "../db/pool";

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
}

/** The authenticated-user shape the rest of the app consumes (drives authz + audience). */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  teamIds: string[];
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    "SELECT id, username, display_name, password_hash FROM users WHERE username = $1",
    [username],
  );
  return rows[0] ?? null;
}

export async function getUserWithRolesTeams(id: string): Promise<SessionUser | null> {
  const { rows } = await query<{ id: string; username: string; display_name: string }>(
    "SELECT id, username, display_name FROM users WHERE id = $1",
    [id],
  );
  const user = rows[0];
  if (!user) return null;

  const roles = await query<{ role_key: string }>(
    "SELECT role_key FROM user_roles WHERE user_id = $1",
    [id],
  );
  const teams = await query<{ team_key: string }>(
    "SELECT team_key FROM user_teams WHERE user_id = $1",
    [id],
  );

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    roles: roles.rows.map((r) => r.role_key),
    teamIds: teams.rows.map((t) => t.team_key),
  };
}
