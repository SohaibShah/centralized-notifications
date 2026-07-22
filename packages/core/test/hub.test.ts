import { expect, test, vi } from "vitest";
import type { Audience, Notification } from "@notifications/shared";
import { DeliveryHub } from "../src/delivery/hub";

const n = (audience: Audience): Notification => ({
  id: "x",
  module: "dsr",
  title: "t",
  description: "",
  priority: "high",
  snoozable: false,
  audience,
});

test("publish delivers a team notification only to matching subscribers", () => {
  const hub = new DeliveryHub();
  const priya = vi.fn();
  const sam = vi.fn();
  hub.subscribe({
    principal: { userKey: "priya", roles: [], teamKeys: ["privacy"] },
    deliver: priya,
  });
  hub.subscribe({ principal: { userKey: "sam", roles: [], teamKeys: ["security"] }, deliver: sam });
  hub.publish(n({ scope: "team", id: "privacy" }));
  expect(priya).toHaveBeenCalledOnce();
  expect(sam).not.toHaveBeenCalled();
});

test("publish delivers a global notification to all subscribers", () => {
  const hub = new DeliveryHub();
  const a = vi.fn();
  const b = vi.fn();
  hub.subscribe({ principal: { userKey: "a", roles: [], teamKeys: [] }, deliver: a });
  hub.subscribe({ principal: { userKey: "b", roles: [], teamKeys: [] }, deliver: b });
  hub.publish(n({ scope: "global" }));
  expect(a).toHaveBeenCalledOnce();
  expect(b).toHaveBeenCalledOnce();
});

test("a throwing subscriber does not abort the publish loop", () => {
  const hub = new DeliveryHub();
  const ok = vi.fn();
  hub.subscribe({
    principal: { userKey: "x", roles: [], teamKeys: [] },
    deliver: () => {
      throw new Error("boom");
    },
  });
  hub.subscribe({ principal: { userKey: "y", roles: [], teamKeys: [] }, deliver: ok });
  expect(() => hub.publish(n({ scope: "global" }))).not.toThrow();
  expect(ok).toHaveBeenCalledOnce();
});
