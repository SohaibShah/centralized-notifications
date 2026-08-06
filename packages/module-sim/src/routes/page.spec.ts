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

  it("exposes the send-count, burst seed, and one-subject thread controls", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({ method: "GET", url: "/" });

    // Send-N-times on the custom form.
    expect(res.body).toContain('id="custom-count"');
    // Reproducible-demo seed on the burst form.
    expect(res.body).toContain('id="burst-seed"');
    // The preset panel loads into the custom form rather than emitting directly.
    expect(res.body).toContain("Load into Custom form");
    // The one-subject thread (grouping demo) panel + its own count/seed.
    expect(res.body).toContain('id="thread-form"');
    expect(res.body).toContain('id="thread-count"');
    expect(res.body).toContain('id="thread-seed"');
  });
});
