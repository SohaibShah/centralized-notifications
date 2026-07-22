import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb } from "../src/db";
import { DeliveryHub } from "../src/delivery/hub";
import { ingest } from "../src/pipeline/ingest";
import { PolicyStore } from "../src/policy/store";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
const hub = new DeliveryHub();
const policy = new PolicyStore({ query, catalog: [{ id: "dsr", label: "DSR" }] });
const deps = { query, hub, policy };
afterAll(() => pool.end());

beforeAll(() => policy.reconcile());

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const payload = (id: string, module: string) => ({
  id,
  module,
  title: id,
  description: "",
  priority: "high",
  snoozable: false,
  audience: { scope: "global" },
});

test("a valid known-module notification is accepted and published", async () => {
  const publish = vi.spyOn(hub, "publish");
  const id = `ingest-ok-${stamp}`;
  const res = await ingest(deps, payload(id, "dsr"));
  expect(res).toEqual({ status: "accepted", id });
  expect(publish).toHaveBeenCalledOnce();
  publish.mockRestore();
});

test("an unknown module is rejected as invalid and never published", async () => {
  const publish = vi.spyOn(hub, "publish");
  const res = await ingest(deps, payload(`ingest-unknown-${stamp}`, "not-a-real-module"));
  expect(res).toEqual({ status: "invalid" });
  expect(publish).not.toHaveBeenCalled();
  publish.mockRestore();
});

test("a malformed payload is rejected as invalid", async () => {
  const res = await ingest(deps, { id: "x" });
  expect(res).toEqual({ status: "invalid" });
});
