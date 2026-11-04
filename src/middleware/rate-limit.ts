import { rateLimit, type Options } from "express-rate-limit";
import { HttpError } from "./errors.js";

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

/**
 * Per-client-IP rate limiter. Uses the in-memory store, so limits are per instance; switch to a shared
 * store (e.g. rate-limit-redis) once the API runs on more than one instance.
 * Requires a correct TRUST_PROXY behind a proxy, otherwise every client shares the proxy's IP.
 */
export function createRateLimiter(
  { windowMs, max }: RateLimitConfig,
  extra: Partial<Options> = {},
) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Route through errorHandler so 429s use the same JSON error shape.
    handler: (_req, _res, next, options) => {
      next(new HttpError(options.statusCode, "Too many requests, please try again later."));
    },
    ...extra,
  });
}

/** Tight limiter for sensitive routes (login, password reset, etc.). */
export function strictLimiter(max = 10, windowMs = 15 * 60_000) {
  return createRateLimiter({ windowMs, max });
}
