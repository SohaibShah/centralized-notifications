import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb } from "../src/db";
import { PolicyStore } from "../src/policy/store";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
const store = new PolicyStore({ query, catalog: [{ id: "dsr", label: "DSR" }] });

beforeAll(() => store.reconcile());
afterAll(async () => {
  // Restore the shared settings singleton so other test files see defaults.
  await query("UPDATE global_settings SET ai_summary_enabled = true WHERE id = true");
  await pool.end();
});

test("reconcile inserts a state row; resolveModule reads catalog + state", async () => {
  expect(await store.resolveModule("dsr")).toEqual({ known: true, enabled: true });
  expect(await store.resolveModule("not-in-catalog")).toEqual({ known: false, enabled: true });
});

test("setModuleEnabled toggles enabled and invalidates the cache", async () => {
  await store.setModuleEnabled("dsr", false);
  expect(await store.resolveModule("dsr")).toEqual({ known: true, enabled: false });
  await store.setModuleEnabled("dsr", true);
  expect((await store.resolveModule("dsr")).enabled).toBe(true);
});

test("listModules returns host-config label ⨝ state ⨝ aggregate", async () => {
  const dsr = (await store.listModules()).find((m) => m.id === "dsr");
  expect(dsr?.label).toBe("DSR");
  expect(dsr?.enabled).toBe(true);
  expect(typeof dsr?.total).toBe("number");
});

test("settings default true; updateSettings persists and invalidates", async () => {
  expect((await store.getSettings()).aiSummaryEnabled).toBe(true);
  await store.updateSettings({ aiSummaryEnabled: false });
  expect((await store.getSettings()).aiSummaryEnabled).toBe(false);
});
