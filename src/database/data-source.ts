import "reflect-metadata";
import { readFileSync } from "node:fs";
import type { TlsOptions } from "node:tls";
import { fileURLToPath } from "node:url";
import { DataSource } from "typeorm";
import { DbSslMode, env } from "../config/env.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function sslOptions(): TlsOptions | false {
  switch (env.DB_SSL) {
    case DbSslMode.Disable:
      return false;
    case DbSslMode.Require:
      // Encrypted, but the server certificate isn't verified (vulnerable to MITM). Prefer verify-full.
      return { rejectUnauthorized: false };
    case DbSslMode.VerifyFull:
      return {
        rejectUnauthorized: true,
        ...(env.DB_SSL_CA && { ca: readFileSync(env.DB_SSL_CA, "utf8") }),
      };
  }
}

// Used by the app and by the TypeORM CLI (npm run db:*), which loads the compiled dist/database/data-source.js.
export const AppDataSource = new DataSource({
  type: "postgres",
  url: env.DATABASE_URL,
  ssl: sslOptions(),
  entities: [here("../**/*.entity.js")],
  migrations: [here("./migrations/*.js")],
  synchronize: false,
  logging: false,
  extra: {
    // node-postgres pool settings
    max: env.DB_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Server-side cap on statement runtime, plus a client-side cap that also covers network stalls.
    // 0 disables both.
    ...(env.DB_STATEMENT_TIMEOUT_MS > 0 && {
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      query_timeout: env.DB_STATEMENT_TIMEOUT_MS + 1_000,
    }),
    application_name: "helpdesk-api",
  },
});
