-- Prototype identity: users + roles + teams (many-to-many). In production this is
-- replaced by the host application's identity; these tables fall away.
-- Roles/teams are keyed by human-readable slugs that double as the audience `id`
-- for role/team-scoped notifications (resolved to members in Task 4).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  key   text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE teams (
  key   text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE user_roles (
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES roles (key) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_key)
);

CREATE TABLE user_teams (
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES teams (key) ON DELETE CASCADE,
  PRIMARY KEY (user_id, team_key)
);
