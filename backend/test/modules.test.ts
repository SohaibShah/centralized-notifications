import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { upsertModuleSeen } from "../src/pipeline/modules";

describe("module auto-discovery", () => {
  beforeAll(async () => migrate());
  afterAll(async () => closePool());
  beforeEach(async () => {
    await query("DELETE FROM modules WHERE key LIKE 'disc-%'");
  });

  it("inserts a never-seen module exactly once, enabled, with a derived label", async () => {
    await upsertModuleSeen("disc-vendor_risk");
    await upsertModuleSeen("disc-vendor_risk");
    const { rows } = await query<{ label: string; enabled: boolean }>(
      "SELECT label, enabled FROM modules WHERE key = 'disc-vendor_risk'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.label).toBe("Disc Vendor Risk"); // title-cased from the full key `disc-vendor_risk`
  });

  it("never re-enables or relabels an existing module on later publishes", async () => {
    await upsertModuleSeen("disc-x");
    await query("UPDATE modules SET enabled = false, label = 'Custom' WHERE key = 'disc-x'");
    await upsertModuleSeen("disc-x");
    const { rows } = await query<{ label: string; enabled: boolean }>(
      "SELECT label, enabled FROM modules WHERE key = 'disc-x'",
    );
    expect(rows[0]?.enabled).toBe(false);
    expect(rows[0]?.label).toBe("Custom");
  });
});
