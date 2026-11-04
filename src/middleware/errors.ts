import type { ErrorRequestHandler, RequestHandler } from "express";
import { env, Environment } from "../config/env.js";

/** Throw from a handler to send a specific status. Express 5 forwards async throws automatically. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Response already started (e.g. streaming): we can't send JSON, so let Express close the connection.
  if (res.headersSent) {
    req.log.error({ err }, "error after response headers were sent");
    next(err);
    return;
  }

  // HttpError, or errors from body-parser and friends that carry a 4xx/5xx status.
  const status =
    typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;

  if (status >= 500) {
    req.log.error({ err }, "unhandled error");
  } else if (status !== 404) {
    req.log.warn({ status, message: err instanceof Error ? err.message : String(err) }, "client error");
  }

  // Don't leak internals for unexpected errors outside development.
  const exposeMessage = status < 500 || env.NODE_ENV === Environment.Development;

  res.status(status).json({
    error: {
      status,
      message: exposeMessage && err instanceof Error ? err.message : "Internal Server Error",
      ...(err instanceof HttpError && err.details !== undefined && { details: err.details }),
    },
  });
};
