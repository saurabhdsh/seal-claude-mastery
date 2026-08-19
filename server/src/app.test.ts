import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("health", () => {
  it("returns ok", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("auth rbac", () => {
  it("rejects missing bearer on admin", async () => {
    const app = createApp();
    const res = await request(app).get("/api/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("rejects missing bearer on assessment", async () => {
    const app = createApp();
    const res = await request(app).get("/api/assessment/mine");
    expect(res.status).toBe(401);
  });
});
