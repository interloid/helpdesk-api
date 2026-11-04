/**
 * Readiness = "can this instance serve traffic right now?" (as opposed to /health, which only says the
 * process is alive). Each external dependency (database, Redis, queues, ...) contributes one check.
 */
export interface ReadinessCheck {
  /** Key used in the /ready response, e.g. "database", "redis". */
  name: string;
  /** Resolve if the dependency is usable; throw (or reject) if not. May return extra details to report. */
  check: () => Promise<Record<string, unknown> | void>;
  /** If false, a failure marks the service "degraded" but still ready (e.g. an optional cache). Default true. */
  critical?: boolean;
  /** Per-check timeout. Default 2000ms. */
  timeoutMs?: number;
}

export type CheckStatus = "up" | "down";

export interface CheckResult {
  status: CheckStatus;
  critical: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export type ReadinessStatus = "ready" | "degraded" | "not_ready" | "shutting_down";

export interface ReadinessReport {
  status: ReadinessStatus;
  checks: Record<string, CheckResult>;
}

const DEFAULT_TIMEOUT_MS = 2000;

export interface ReadinessOptions {
  /** Include check error messages in the report. Turn off in production. Default true. */
  exposeErrors?: boolean;
  /** Reuse results for this long, so probe floods don't become dependency load. Default 0 (no cache). */
  cacheMs?: number;
}

type CheckResults = Record<string, CheckResult>;

export class ReadinessService {
  private readonly checks: ReadinessCheck[] = [];
  private readonly exposeErrors: boolean;
  private readonly cacheMs: number;
  private draining = false;
  private cached: { results: CheckResults; at: number } | undefined;
  private inFlight: Promise<CheckResults> | undefined;

  constructor(checks: ReadinessCheck[] = [], { exposeErrors = true, cacheMs = 0 }: ReadinessOptions = {}) {
    this.exposeErrors = exposeErrors;
    this.cacheMs = cacheMs;
    for (const c of checks) this.register(c);
  }

  register(check: ReadinessCheck): void {
    if (this.checks.some((c) => c.name === check.name)) {
      throw new Error(`Readiness check "${check.name}" is already registered`);
    }
    this.checks.push(check);
    this.cached = undefined;
  }

  /** Call when shutdown starts so load balancers stop sending new traffic. Takes effect immediately. */
  setDraining(): void {
    this.draining = true;
  }

  async run(): Promise<ReadinessReport> {
    const checks = await this.results();

    let status: ReadinessStatus;
    const values = Object.values(checks);
    if (this.draining) status = "shutting_down";
    else if (values.some((r) => r.status === "down" && r.critical)) status = "not_ready";
    else if (values.some((r) => r.status === "down")) status = "degraded";
    else status = "ready";

    return { status, checks };
  }

  /** Cached results if fresh; otherwise one shared run, even when many requests arrive at once. */
  private results(): Promise<CheckResults> {
    if (this.cached && performance.now() - this.cached.at < this.cacheMs) {
      return Promise.resolve(this.cached.results);
    }
    this.inFlight ??= this.runAll().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runAll(): Promise<CheckResults> {
    const list = await Promise.all(this.checks.map((c) => this.runOne(c)));
    const results = Object.fromEntries(this.checks.map((c, i) => [c.name, list[i]!]));
    this.cached = { results, at: performance.now() };
    return results;
  }

  private async runOne(c: ReadinessCheck): Promise<CheckResult> {
    const critical = c.critical ?? true;
    const timeoutMs = c.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = performance.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      const details = await Promise.race([
        c.check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return {
        status: "up",
        critical,
        latencyMs: Math.round(performance.now() - start),
        ...(details && { details }),
      };
    } catch (err) {
      return {
        status: "down",
        critical,
        latencyMs: Math.round(performance.now() - start),
        error: this.exposeErrors && err instanceof Error ? err.message : "unavailable",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
