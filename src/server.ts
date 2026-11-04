import "reflect-metadata";
import { setTimeout as sleep } from "node:timers/promises";
import { DbSslMode, env, Environment } from "./config/env.js";
import { logger } from "./config/logger.js";
import { AppDataSource } from "./database/data-source.js";
import { databaseCheck } from "./health/checks/database.js";
import { ReadinessService } from "./health/readiness.js";
import { createApp } from "./app.js";

const isProduction = env.NODE_ENV === Environment.Production;

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled promise rejection");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});

if (isProduction && env.DB_SSL === DbSslMode.Disable) {
  logger.warn("DB_SSL=disable in production: database traffic is unencrypted");
}
if (isProduction && env.TRUST_PROXY === 0) {
  logger.warn("TRUST_PROXY=0: if this runs behind a proxy/load balancer, rate limiting sees the proxy's IP");
}

/** Retry with exponential backoff (1s, 2s, 4s, ... capped at 30s) so a DB that's briefly down during a
 * deploy doesn't kill the process. After boot the pg pool reconnects on its own; /ready reports state. */
async function connectDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await AppDataSource.initialize();
      logger.info("database connected");
      return;
    } catch (err) {
      if (attempt >= env.DB_CONNECT_RETRIES) throw err;
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      logger.warn(
        { err, attempt, maxAttempts: env.DB_CONNECT_RETRIES, retryInMs: delayMs },
        "database connection failed, retrying",
      );
      await sleep(delayMs);
    }
  }
}

try {
  await connectDatabase();
} catch (err) {
  logger.fatal({ err }, "failed to connect to database");
  process.exit(1);
}

// Add a check here for each new external connection (e.g. redisCheck(redisClient)).
const readiness = new ReadinessService([databaseCheck(AppDataSource)], {
  exposeErrors: !isProduction,
  cacheMs: env.READINESS_CACHE_MS,
});

const app = createApp({ readiness });

const server = app.listen(env.PORT, (err?: Error) => {
  if (err) {
    logger.fatal({ err }, "failed to start server");
    process.exit(1);
  }
  const baseUrl = `http://localhost:${env.PORT}`;
  logger.info(`helpdesk-api listening on ${baseUrl} (${env.NODE_ENV})`);
  logger.info(`Readiness: ${baseUrl}/ready`);
  // Docs are only mounted outside production (see createApp).
  if (!isProduction) {
    logger.info(`Swagger UI: ${baseUrl}/docs  (spec: ${baseUrl}/docs.json)`);
  }
});

// Node defaults: requestTimeout 300s, keepAliveTimeout 5s. A keep-alive shorter than the load balancer's
// idle timeout causes sporadic 502s; headersTimeout must exceed keepAliveTimeout.
server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS + 1_000;

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  readiness.setDraining();

  const forceExit = setTimeout(() => {
    logger.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async (err) => {
    if (err) logger.error({ err }, "error while closing server");
    try {
      // Close other connections (e.g. Redis) here too.
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    } catch (dbErr) {
      logger.error({ err: dbErr }, "error while closing database");
      process.exit(1);
    }
    process.exit(err ? 1 : 0);
  });
  server.closeIdleConnections();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
