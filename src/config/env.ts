import "reflect-metadata";
import { Expose, plainToInstance } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateBy,
  validateSync,
  type ValidationOptions,
} from "class-validator";
import { formatValidationErrors } from "../common/validation.js";

export enum Environment {
  Development = "development",
  Production = "production",
  Test = "test",
}

export enum LogLevel {
  Fatal = "fatal",
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Trace = "trace",
  Silent = "silent",
}

export enum DbSslMode {
  /** No TLS. Local development only. */
  Disable = "disable",
  /** TLS, but the server certificate is not verified (managed DBs without a CA bundle). */
  Require = "require",
  /** TLS with certificate + hostname verification (use DB_SSL_CA for a private CA). */
  VerifyFull = "verify-full",
}

export function parseOrigins(value: string): string[] {
  return value
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Each comma-separated entry must be an exact http(s) origin (no path, no trailing slash, no "*"). */
function IsOriginList(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: "isOriginList",
      validator: {
        validate(value: unknown) {
          if (typeof value !== "string") return false;
          const origins = parseOrigins(value);
          return (
            origins.length > 0 &&
            origins.every((o) => {
              try {
                const url = new URL(o);
                return (url.protocol === "http:" || url.protocol === "https:") && url.origin === o;
              } catch {
                return false;
              }
            })
          );
        },
        defaultMessage: () =>
          '$property must be a comma-separated list of origins like "https://app.example.com" (no paths, no "*")',
      },
    },
    options,
  );
}

export class EnvironmentVariables {
  // --- App ---
  @IsEnum(Environment)
  @Expose()
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  @Expose()
  PORT: number = 3000;

  @IsEnum(LogLevel)
  @Expose()
  LOG_LEVEL: LogLevel = LogLevel.Info;

  @IsOriginList()
  @Expose()
  CORS_ORIGIN: string;

  /** Number of reverse-proxy hops in front of the app (0 = exposed directly). Drives req.ip and rate limiting. */
  @IsInt()
  @Min(0)
  @Max(10)
  @Expose()
  TRUST_PROXY: number = 0;

  // --- HTTP server ---
  @IsInt()
  @Min(1000)
  @Expose()
  HTTP_REQUEST_TIMEOUT_MS: number = 30_000;

  /** Keep above the load balancer's idle timeout to avoid intermittent 502s. */
  @IsInt()
  @Min(1000)
  @Expose()
  HTTP_KEEP_ALIVE_TIMEOUT_MS: number = 65_000;

  @IsInt()
  @Min(1000)
  @Expose()
  SHUTDOWN_TIMEOUT_MS: number = 10_000;

  // --- Rate limiting (per client IP, in-memory store) ---
  @IsInt()
  @Min(1000)
  @Expose()
  RATE_LIMIT_WINDOW_MS: number = 60_000;

  @IsInt()
  @Min(1)
  @Expose()
  RATE_LIMIT_MAX: number = 300;

  // --- Database ---
  @IsUrl({ protocols: ["postgres", "postgresql"], require_tld: false })
  @Expose()
  DATABASE_URL: string;

  @IsEnum(DbSslMode)
  @Expose()
  DB_SSL: DbSslMode = DbSslMode.Disable;

  /** Path to a PEM CA bundle, used with DB_SSL=verify-full for a private CA. */
  @IsOptional()
  @IsString()
  @Expose()
  DB_SSL_CA: string | undefined;

  @IsInt()
  @Min(1)
  @Max(100)
  @Expose()
  DB_POOL_MAX: number = 10;

  @IsInt()
  @Min(0)
  @Expose()
  DB_STATEMENT_TIMEOUT_MS: number = 15_000;

  /** Connection attempts at boot before giving up (exponential backoff from 1s). */
  @IsInt()
  @Min(1)
  @Max(20)
  @Expose()
  DB_CONNECT_RETRIES: number = 5;

  // --- Health ---
  /** How long a /ready result is reused, so probe floods don't turn into DB load. */
  @IsInt()
  @Min(0)
  @Expose()
  READINESS_CACHE_MS: number = 1000;

  /** Parsed CORS_ORIGIN. */
  get CORS_ORIGINS(): string[] {
    return parseOrigins(this.CORS_ORIGIN);
  }
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
    // Keep only the declared keys, not the rest of process.env.
    excludeExtraneousValues: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = Object.entries(formatValidationErrors(errors))
      .map(([key, messages]) => `  ${key}: ${messages.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return validatedConfig;
}

/**
 * Load .env for processes not started with --env-file (TypeORM CLI, seed script).
 * Variables already set in the environment win. Skipped under tests so they stay deterministic.
 */
function loadDotEnv(): void {
  if (process.env.NODE_ENV === Environment.Test) return;
  try {
    process.loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

loadDotEnv();

export const env: Readonly<EnvironmentVariables> = Object.freeze(validate(process.env));
