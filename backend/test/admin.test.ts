import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";

describe("admin schema (migration 005)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("creates the modules and global_settings tables and the suppressed column", async () => {
    await query(
      "INSERT INTO modules (key, label) VALUES ('smoke', 'Smoke') ON CONFLICT (key) DO NOTHING",
    );
    const mod = await query<{ enabled: boolean }>(
      "SELECT enabled FROM modules WHERE key = 'smoke'",
    );
    expect(mod.rows[0]?.enabled).toBe(true);

    const settings = await query<{ ai_summary_enabled: boolean }>(
      "SELECT ai_summary_enabled FROM global_settings WHERE id = true",
    );
    expect(settings.rows[0]?.ai_summary_enabled).toBe(true);

    const col = await query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'suppressed'",
    );
    expect(col.rowCount).toBe(1);
  });

  it("enforces the global_settings singleton", async () => {
    await expect(query("INSERT INTO global_settings (id) VALUES (false)")).rejects.toThrow();
  });
});
