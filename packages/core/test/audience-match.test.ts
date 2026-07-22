import { expect, test } from "vitest";
import { matchAudience } from "../src/audience/match";

const p = { userKey: "priya", roles: ["privacy-analyst"], teamKeys: ["privacy"] };

test("global matches everyone", () => {
  expect(matchAudience(p, { scope: "global" })).toBe(true);
});
test("team matches only members", () => {
  expect(matchAudience(p, { scope: "team", id: "privacy" })).toBe(true);
  expect(matchAudience(p, { scope: "team", id: "security" })).toBe(false);
});
test("role matches only holders", () => {
  expect(matchAudience(p, { scope: "role", id: "privacy-analyst" })).toBe(true);
  expect(matchAudience(p, { scope: "role", id: "admin" })).toBe(false);
});
test("user matches only the userKey", () => {
  expect(matchAudience(p, { scope: "user", id: "priya" })).toBe(true);
  expect(matchAudience(p, { scope: "user", id: "sam" })).toBe(false);
});
