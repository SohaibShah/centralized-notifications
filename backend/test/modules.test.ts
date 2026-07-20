import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { touchModule } from "../src/pipeline/modules";

describe("touchModule", () => {
  beforeAll(async () => migrate());
  afterAll(async () => closePool());

  it("bumps last_seen_at for a seeded module without inserting", async () => {
    await query("UPDATE modules SET last_seen_at = '2000-01-01T00:00:00Z' WHERE key = 'dsr'");
    await touchModule("dsr");
    const { rows } = await query<{ last_seen_at: Date }>(
      "SELECT last_seen_at FROM modules WHERE key = 'dsr'",
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.last_seen_at).getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("is a no-op for an unknown key (inserts nothing)", async () => {
    await touchModule("touch-nonexistent");
    const { rowCount } = await query("SELECT 1 FROM modules WHERE key = 'touch-nonexistent'");
    expect(rowCount).toBe(0);
  });
});
