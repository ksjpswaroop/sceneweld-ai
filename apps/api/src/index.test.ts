import { describe, expect, it } from "bun:test";

import app from "./index";

function request(path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, init));
}

describe("API routes", () => {
  it("reports root status", async () => {
    const response = await request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports health with an ISO timestamp", async () => {
    const response = await request("/health");
    const body = (await response.json()) as {
      healthy: boolean;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(body.healthy).toBe(true);
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("echoes a valid message", async () => {
    const response = await request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "phase-zero" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "phase-zero" });
  });

  it("rejects an invalid echo body", async () => {
    const response = await request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await request("/unknown");

    expect(response.status).toBe(404);
  });
});
