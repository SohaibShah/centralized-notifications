import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("s3cret-pw");
    expect(hash).not.toBe("s3cret-pw");
    expect(await verifyPassword(hash, "s3cret-pw")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("s3cret-pw");
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("returns false (does not throw) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-real-hash", "whatever")).toBe(false);
  });
});
