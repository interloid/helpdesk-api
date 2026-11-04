import "reflect-metadata";
import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, test } from "vitest";
import { createApp } from "./app.js";
import { logger } from "./config/logger.js";
import { errorHandler } from "./middleware/errors.js";

const app = createApp({ rateLimit: false });

describe("app", () => {
  test("GET /health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  test("unknown route returns JSON 404", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.status).toBe(404);
  });

  test("malformed JSON returns 400", async () => {
    const res = await request(app)
      .post("/health")
      .set("content-type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
  });

  test("serves the OpenAPI spec", async () => {
    const res = await request(app).get("/docs.json");
    expect(res.status).toBe(200);
    expect(res.body.paths).toHaveProperty("/health");
    expect(res.body.paths).toHaveProperty("/ready");
  });
});

describe("CORS", () => {
  test("allows the configured origin", async () => {
    const res = await request(app).get("/health").set("origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  test("does not allow other origins", async () => {
    const res = await request(app).get("/health").set("origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("request id", () => {
  test("echoes a well-formed incoming x-request-id", async () => {
    const res = await request(app).get("/health").set("x-request-id", "abc-123_DEF");
    expect(res.headers["x-request-id"]).toBe("abc-123_DEF");
  });

  test.each([["x".repeat(129)], ["has spaces"], ["inject\"quote"], ["a;b"]])(
    "replaces an unsafe x-request-id %#",
    async (bad) => {
      const res = await request(app).get("/health").set("x-request-id", bad);
      expect(res.headers["x-request-id"]).not.toBe(bad);
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe("rate limiting", () => {
  test("429 with the standard JSON error after the limit", async () => {
    const limited = createApp({ rateLimit: { windowMs: 60_000, max: 2 } });
    await request(limited).get("/nope");
    await request(limited).get("/nope");
    const res = await request(limited).get("/nope");
    expect(res.status).toBe(429);
    expect(res.body.error.status).toBe(429);
    expect(res.headers["ratelimit-policy"]).toBeTruthy();
  });

  test("does not count or block /health and /ready", async () => {
    const limited = createApp({ rateLimit: { windowMs: 60_000, max: 1 } });
    for (let i = 0; i < 3; i++) {
      expect((await request(limited).get("/health")).status).toBe(200);
      expect((await request(limited).get("/ready")).status).toBe(200);
    }
  });
});

describe("error handler", () => {
  test("delegates when headers were already sent instead of throwing", async () => {
    const streamApp = express()
      .use(pinoHttp({ logger }))
      .get("/stream", (_req, res, next) => {
        res.status(200).write("partial");
        next(new Error("boom mid-stream"));
      })
      .use(errorHandler);

    // Express's final handler destroys the socket: the client sees an aborted response, and the
    // process doesn't crash with ERR_HTTP_HEADERS_SENT.
    await expect(request(streamApp).get("/stream")).rejects.toThrow(/aborted|socket hang up/);
  });
});
