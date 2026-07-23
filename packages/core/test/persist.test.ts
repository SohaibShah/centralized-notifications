import { afterAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { validate } from "../src/pipeline/validate";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

const notif = (id: string): Notification => ({
  id,
  module: "dsr",
  title: "Persist me",
  description: "",
  priority: "high",
  snoozable: false,
  audience: { scope: "global" },
});

test("persist inserts once and reports accepted, then duplicate on retry", async () => {
  const id = `persist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  expect(await persist(query, notif(id), false)).toBe("accepted");
  expect(await persist(query, notif(id), false)).toBe("duplicate");
});

test("validate rejects a malformed payload with a value-free error", () => {
  const result = validate({ id: "x" }); // missing required fields
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("module");
});
