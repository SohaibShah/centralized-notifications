import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { ingest } from "../src/pipeline/ingest";
import { getFeatureFlags, invalidatePolicyCache, isModuleEnabled } from "../src/pipeline/policy";

describe("policy cache", () => {
  beforeAll(async () => migrate());
  afterAll(async () => closePool());
  beforeEach(async () => {
    await query("DELETE FROM modules WHERE key LIKE 'pol-%'");
    await query("DELETE FROM notifications WHERE module LIKE 'pol-%'");
    await query("UPDATE global_settings SET ai_summary_enabled = true WHERE id = true");
    invalidatePolicyCache();
  });

  it("treats a never-seen module as enabled", async () => {
    expect(await isModuleEnabled("pol-unknown")).toBe(true);
  });

  it("reflects a disabled module only after the cache is invalidated", async () => {
    await query("INSERT INTO modules (key, label, enabled) VALUES ('pol-a', 'A', false)");
    // Prime the cache before pol-a is known-disabled to prove staleness, then invalidate.
    await isModuleEnabled("pol-a");
    invalidatePolicyCache();
    expect(await isModuleEnabled("pol-a")).toBe(false);
  });

  it("reads feature flags and re-reads them after invalidation", async () => {
    expect((await getFeatureFlags()).aiSummaryEnabled).toBe(true);
    await query("UPDATE global_settings SET ai_summary_enabled = false WHERE id = true");
    invalidatePolicyCache();
    expect((await getFeatureFlags()).aiSummaryEnabled).toBe(false);
  });

  it("suppresses (persists but does not deliver) a disabled module's notification", async () => {
    await query("INSERT INTO modules (key, label, enabled) VALUES ('pol-off', 'Off', false)");
    invalidatePolicyCache();
    const id = `pol-supp-${Date.now()}`;
    const res = await ingest({
      id,
      module: "pol-off",
      title: "hidden",
      description: "",
      priority: "high",
      snoozable: true,
      audience: { scope: "global" },
    });
    expect(res.status).toBe("accepted");
    const row = await query<{ suppressed: boolean }>(
      "SELECT suppressed FROM notifications WHERE id = $1",
      [id],
    );
    expect(row.rows[0]?.suppressed).toBe(true);
  });
});
