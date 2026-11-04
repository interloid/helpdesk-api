import cors from "cors";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env, Environment } from "./config/env.js";
import { logger } from "./config/logger.js";
import { getOpenapiSpec } from "./docs/swagger.js";
import { ReadinessService } from "./health/readiness.js";
import { healthRouter } from "./health/routes.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createRateLimiter, type RateLimitConfig } from "./middleware/rate-limit.js";

/** Accept a caller's request id only if it's short and safe to echo into headers and logs. */
const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;
const PROBE_PATHS = new Set(["/health", "/ready"]);

export interface AppDeps {
  /** Dependency checks for GET /ready. Defaults to an empty service (always ready). */
  readiness?: ReadinessService;
  /** Global rate limit. Defaults to RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX; `false` disables it. */
  rateLimit?: RateLimitConfig | false;
}

export function createApp({
  readiness = new ReadinessService(),
  rateLimit = { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
}: AppDeps = {}) {
  const app = express();

  app.disable("x-powered-by");
  // Behind a proxy/load balancer, trust its X-Forwarded-* headers so req.ip (used by rate limiting
  // and logs) and req.protocol are the client's, not the proxy's.
  if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id =
          typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      autoLogging: { ignore: (req) => PROBE_PATHS.has(req.url ?? "") },
      // Log a compact line per request instead of every header.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  // After CORS so browsers can read 429 responses.
  if (rateLimit) {
    app.use(createRateLimiter(rateLimit, { skip: (req) => PROBE_PATHS.has(req.path) }));
  }
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter(readiness));

  if (env.NODE_ENV !== Environment.Production) {
    const spec = getOpenapiSpec();
    app.get("/docs.json", (_req, res) => {
      res.json(spec);
    });
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
  }

  // Mount routers here, e.g. app.use("/api/tickets", ticketsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
