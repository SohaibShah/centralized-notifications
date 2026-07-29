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

  it("exposes an audience picker on the custom form", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.body).toContain('id="custom-audience-scope"');
    expect(res.body).toContain('id="custom-audience-id"');
    // The four audience scopes must be selectable.
    for (const scope of ["global", "team", "role", "user"]) {
      expect(res.body).toContain(`value="${scope}"`);
    }
  });
});
