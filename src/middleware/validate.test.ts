import "reflect-metadata";
import { Type } from "class-transformer";
import { IsEmail, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from "class-validator";
import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, test } from "vitest";
import { logger } from "../config/logger.js";
import { errorHandler } from "./errors.js";
import { validateBody, validateQuery } from "./validate.js";

class AddressDto {
  @IsString()
  city: string;
}

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}

class ListQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

function makeApp() {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.post("/users", validateBody(CreateUserDto), (req, res) => {
    res.json({ isInstance: req.body instanceof CreateUserDto, body: req.body });
  });
  app.get("/users", validateQuery(ListQueryDto), (_req, res) => {
    res.json(res.locals.query);
  });
  app.use(errorHandler);
  return app;
}

describe("validateBody", () => {
  test("passes a valid body through as a typed DTO instance", async () => {
    const res = await request(makeApp()).post("/users").send({ email: "a@b.co", name: "Al" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isInstance: true, body: { email: "a@b.co", name: "Al" } });
  });

  test("400 with per-field details", async () => {
    const res = await request(makeApp()).post("/users").send({ email: "nope", name: "A" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Validation failed");
    expect(Object.keys(res.body.error.details).sort()).toEqual(["email", "name"]);
  });

  test("rejects properties not declared on the DTO (mass-assignment guard)", async () => {
    const res = await request(makeApp())
      .post("/users")
      .send({ email: "a@b.co", name: "Al", role: "admin" });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty("role");
  });

  test("reports nested errors with a dotted path", async () => {
    const res = await request(makeApp())
      .post("/users")
      .send({ email: "a@b.co", name: "Al", address: { city: 5 } });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty(["address.city"]);
  });

  test("does not coerce JSON body types", async () => {
    const res = await request(makeApp()).post("/users").send({ email: "a@b.co", name: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty("name");
  });

  test("rejects a missing body", async () => {
    const res = await request(makeApp()).post("/users");
    expect(res.status).toBe(400);
  });
});

describe("validateQuery", () => {
  test("converts and exposes the query on res.locals.query", async () => {
    const res = await request(makeApp()).get("/users?limit=20");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ limit: 20 });
  });

  test("400 for an out-of-range value", async () => {
    const res = await request(makeApp()).get("/users?limit=500");
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty("limit");
  });

  test("400 for an unknown query parameter", async () => {
    const res = await request(makeApp()).get("/users?admin=true");
    expect(res.status).toBe(400);
  });
});
