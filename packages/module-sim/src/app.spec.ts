import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("buildApp", () => {
  it("serves /health", async () => {
    const app = buildApp({
      hubUrl: "http://localhost:3000",
      intakeToken: "t",
      dispatchToken: "d",
      port: 4000,
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
