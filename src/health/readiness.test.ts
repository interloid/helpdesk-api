import "reflect-metadata";
import request from "supertest";
import { describe, expect, test } from "vitest";
import { createApp } from "../app.js";
import { ReadinessService, type ReadinessCheck } from "./readiness.js";

const up = (name: string): ReadinessCheck => ({ name, check: async () => {} });
const down = (name: string, critical = true): ReadinessCheck => ({
  name,
  critical,
  check: async () => {
    throw new Error("connection refused");
  },
});

describe("GET /ready", () => {
  test("200 ready when every check is up", async () => {
    const app = createApp({ readiness: new ReadinessService([up("database"), up("redis")]) });
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.status).toBe("ready");
    expect(res.body.checks.database).toMatchObject({ status: "up", critical: true });
    expect(res.body.checks.redis.status).toBe("up");
  });

  test("503 not_ready when a critical check fails", async () => {
    const app = createApp({ readiness: new ReadinessService([up("redis"), down("database")]) });
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.checks.database).toMatchObject({ status: "down", error: "connection refused" });
  });

  test("200 degraded when only a non-critical check fails", async () => {
    const app = createApp({
      readiness: new ReadinessService([up("database"), down("cache", false)]),
    });
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
  });

  test("a hanging check times out instead of hanging the endpoint", async () => {
    const hang: ReadinessCheck = { name: "slow", timeoutMs: 50, check: () => new Promise(() => {}) };
    const app = createApp({ readiness: new ReadinessService([hang]) });
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks.slow.error).toBe("timed out after 50ms");
  });

  test("503 shutting_down once draining", async () => {
    const readiness = new ReadinessService([up("database")]);
    readiness.setDraining();
    const res = await request(createApp({ readiness })).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("shutting_down");
  });

  test("hides error messages when exposeErrors is false", async () => {
    const app = createApp({ readiness: new ReadinessService([down("database")], { exposeErrors: false }) });
    const res = await request(app).get("/ready");
    expect(res.body.checks.database.error).toBe("unavailable");
  });

  test("rejects duplicate check names", () => {
    expect(() => new ReadinessService([up("database"), up("database")])).toThrow(/already registered/);
  });
});

describe("ReadinessService caching", () => {
  function counting(name = "database") {
    const check: ReadinessCheck & { calls: number } = {
      name,
      calls: 0,
      async check() {
        check.calls++;
        await new Promise((r) => setTimeout(r, 10));
      },
    };
    return check;
  }

  test("reuses the result within cacheMs", async () => {
    const c = counting();
    const svc = new ReadinessService([c], { cacheMs: 60_000 });
    await svc.run();
    await svc.run();
    expect(c.calls).toBe(1);
  });

  test("re-runs checks when caching is off", async () => {
    const c = counting();
    const svc = new ReadinessService([c]);
    await svc.run();
    await svc.run();
    expect(c.calls).toBe(2);
  });

  test("concurrent calls share one in-flight run", async () => {
    const c = counting();
    const svc = new ReadinessService([c]);
    const reports = await Promise.all([svc.run(), svc.run(), svc.run()]);
    expect(c.calls).toBe(1);
    expect(reports.every((r) => r.status === "ready")).toBe(true);
  });

  test("draining overrides a cached ready result immediately", async () => {
    const svc = new ReadinessService([counting()], { cacheMs: 60_000 });
    expect((await svc.run()).status).toBe("ready");
    svc.setDraining();
    expect((await svc.run()).status).toBe("shutting_down");
  });
});
