import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate, type ValidatorOptions } from "class-validator";
import type { RequestHandler } from "express";
import { formatValidationErrors } from "../common/validation.js";
import { HttpError } from "./errors.js";

const VALIDATOR_OPTIONS: ValidatorOptions = {
  whitelist: true, // strip properties without decorators
  forbidNonWhitelisted: true, // ...and reject the request if any were sent
  forbidUnknownValues: true,
};

/**
 * `convert`: coerce values to the DTO's declared types. Needed for query strings (everything is a string);
 * off for JSON bodies, which already carry types, so `{ "age": "5" }` is rejected rather than coerced.
 */
async function toValidated<T extends object>(
  dto: ClassConstructor<T>,
  input: unknown,
  convert: boolean,
): Promise<T> {
  const instance = plainToInstance(dto, input ?? {}, { enableImplicitConversion: convert });
  const errors = await validate(instance, VALIDATOR_OPTIONS);
  if (errors.length > 0) {
    throw new HttpError(400, "Validation failed", formatValidationErrors(errors));
  }
  return instance;
}

/**
 * Validates req.body against a class-validator DTO and replaces it with the typed instance.
 *
 *   router.post("/tickets", validateBody(CreateTicketDto), (req, res) => { req.body as CreateTicketDto });
 */
export function validateBody<T extends object>(dto: ClassConstructor<T>): RequestHandler {
  return async (req, _res, next) => {
    req.body = await toValidated(dto, req.body, false);
    next();
  };
}

/**
 * Validates req.query against a DTO. Express 5's req.query is a read-only getter, so the typed result
 * goes on res.locals.query.
 */
export function validateQuery<T extends object>(dto: ClassConstructor<T>): RequestHandler {
  return async (req, res, next) => {
    res.locals.query = await toValidated(dto, req.query, true);
    next();
  };
}
