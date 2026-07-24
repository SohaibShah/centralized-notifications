import { describe, expect, it } from "vitest";
import { buildApp } from "../app";

const cfg = {
  hubUrl: "http://localhost:3000",
  intakeToken: "intake-token-abcdefgh",
  dispatchToken: "d",
  port: 4000,
};

describe("GET /", () => {
  it("serves the control-center HTML page", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Control Center");
  });
});
