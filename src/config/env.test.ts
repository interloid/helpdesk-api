import { describe, expect, test } from "vitest";
import { DbSslMode, validate } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  CORS_ORIGIN: "http://localhost:5173",
};

describe("env validation", () => {
  test("applies defaults", () => {
    const env = validate(base);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      TRUST_PROXY: 0,
      DB_SSL: DbSslMode.Disable,
      DB_POOL_MAX: 10,
      RATE_LIMIT_MAX: 300,
      HTTP_KEEP_ALIVE_TIMEOUT_MS: 65_000,
    });
  });

  test("converts numeric strings", () => {
    expect(validate({ ...base, PORT: "8080", TRUST_PROXY: "2" })).toMatchObject({ PORT: 8080, TRUST_PROXY: 2 });
  });

  test("drops undeclared variables", () => {
    expect(validate({ ...base, SOME_SECRET: "x" })).not.toHaveProperty("SOME_SECRET");
  });

  test("parses a comma-separated CORS origin list", () => {
    const env = validate({ ...base, CORS_ORIGIN: "https://a.example.com, https://b.example.com:8443" });
    expect(env.CORS_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com:8443"]);
  });

  test.each(["*", "https://a.example.com/", "https://a.example.com/path", "ftp://a.example.com", "", "not a url"])(
    "rejects CORS_ORIGIN %j",
    (CORS_ORIGIN) => {
      expect(() => validate({ ...base, CORS_ORIGIN })).toThrow(/CORS_ORIGIN/);
    },
  );

  test("rejects an invalid DB_SSL mode", () => {
    expect(() => validate({ ...base, DB_SSL: "on" })).toThrow(/DB_SSL/);
  });

  test("rejects out-of-range numbers", () => {
    expect(() => validate({ ...base, DB_POOL_MAX: "0" })).toThrow(/DB_POOL_MAX/);
    expect(() => validate({ ...base, TRUST_PROXY: "abc" })).toThrow(/TRUST_PROXY/);
  });

  test("requires DATABASE_URL", () => {
    expect(() => validate({ CORS_ORIGIN: base.CORS_ORIGIN })).toThrow(/DATABASE_URL/);
  });
});
