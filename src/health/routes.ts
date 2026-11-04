import { Router } from "express";
import type { ReadinessService } from "./readiness.js";

export function healthRouter(readiness: ReadinessService): Router {
  const router = Router();

  /**
   * @openapi
   * /health:
   *   get:
   *     summary: Liveness check
   *     description: The process is up. Does not check dependencies; use /ready for that.
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Service is alive
   */
  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  /**
   * @openapi
   * /ready:
   *   get:
   *     summary: Readiness check
   *     description: >
   *       Checks every connected dependency (database, and future ones like Redis).
   *       Returns 200 when all critical dependencies are up (status "ready" or "degraded"),
   *       and 503 when any critical dependency is down or the server is shutting down.
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Ready to serve traffic
   *         content:
   *           application/json:
   *             example:
   *               status: ready
   *               checks:
   *                 database: { status: up, critical: true, latencyMs: 2 }
   *       503:
   *         description: Not ready
   *         content:
   *           application/json:
   *             example:
   *               status: not_ready
   *               checks:
   *                 database: { status: down, critical: true, latencyMs: 2000, error: "timed out after 2000ms" }
   */
  router.get("/ready", async (_req, res) => {
    const report = await readiness.run();
    const ok = report.status === "ready" || report.status === "degraded";
    res.status(ok ? 200 : 503).set("cache-control", "no-store").json(report);
  });

  return router;
}
