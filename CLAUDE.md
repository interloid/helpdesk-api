# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules (required for every task)

1. **Investigate, then plan.** For any change, bug or task, first find the root cause or the code involved, then write up a plan before editing.
2. **Keep changes minimal.** Change only what the issue or task needs. No drive-by refactors, renames, formatting or "while I'm here" fixes. If something else looks wrong, mention it instead of changing it.
3. **Tests are mandatory for behaviour changes.** Add or update tests whenever an API endpoint is added or changed, or when a change affects business logic. Put them next to the code as `*.test.ts`, using supertest against `createApp()` for endpoints.
4. **Follow this loop, in order, every time:**
   1. Make the code change.
   2. Add or update the tests.
   3. Run `npm run typecheck` and `npm test`. Both must pass. Report failures with their output; don't hide them.
   4. Verify each affected endpoint through the running server:
      - Start it with `npm run dev`.
      - Confirm the endpoint and its `@openapi` docs show up correctly in `/docs.json` (Swagger UI at `/docs`).
      - Call the endpoint with the documented request and check that the real response matches the documented one.
      - If the endpoint's behaviour or shape changed, update its `@openapi` block too.
5. **Git:** never commit or push without asking first, every time. Commit messages are one plain, human-readable line with no Claude/AI attribution.

## Project status

Early-stage helpdesk REST API: the HTTP shell (app, config, logging, errors, docs, health/readiness) and the TypeORM DataSource are in place; no entities, migrations or domain routes yet. The `package.json` scripts and dependencies show the intended stack and layout, so follow them when adding code:

- Express 5 + helmet + cors, pino / pino-http logging (pino-pretty in dev)
- PostgreSQL via TypeORM (`DATABASE_URL`), with class-validator / class-transformer for DTOs
- Auth with bcrypt + jsonwebtoken
- API docs via swagger-jsdoc + swagger-ui-express
- Tests with vitest + supertest

`db:seed` expects `src/database/seed.ts`, which doesn't exist yet.

## Architecture

- `src/server.ts` is the process entrypoint only. It:
  - connects the DB, retrying with backoff (`DB_CONNECT_RETRIES`), then exits 1
  - logs production warnings for `DB_SSL=disable` and `TRUST_PROXY=0`
  - builds the `ReadinessService` and listens, with tuned `requestTimeout` / `keepAliveTimeout` / `headersTimeout`
  - on SIGTERM/SIGINT: marks readiness as draining, closes the HTTP server, then closes connections, all within `SHUTDOWN_TIMEOUT_MS`
- `src/app.ts` exports `createApp({ readiness?, rateLimit? })`, which builds the Express app without listening or connecting anything. Tests import it with supertest, pass fake checks, and usually pass `rateLimit: false`.
- `src/database/data-source.ts` exports `AppDataSource`, shared by the app and the TypeORM CLI. Entities are discovered by the glob `**/*.entity.js` and migrations from `database/migrations/`, so name entity files `*.entity.ts`. TLS (`DB_SSL`: `disable` / `require` / `verify-full`, optional `DB_SSL_CA`), pool size and statement timeout come from env.
- Health: `GET /health` is liveness only (no dependency calls). `GET /ready` runs every registered `ReadinessCheck` (`src/health/readiness.ts`) in parallel with a per-check timeout, and returns 200 for `ready`/`degraded` and 503 for `not_ready`/`shutting_down`. To add a dependency (e.g. Redis), write a check under `src/health/checks/` (see `database.ts`), add it to the list in `server.ts`, and close the connection in `shutdown()`. Mark optional dependencies `critical: false`. Results are cached for `READINESS_CACHE_MS`, and concurrent calls share one run. Draining overrides the cache. Error messages in the report are hidden in production.
- Middleware order in `createApp()`: pino-http → helmet → cors → rate limiter → `express.json` → routes → `notFound` → `errorHandler`. Mount new routers before `notFound`.
  - pino-http takes the request id from `x-request-id` only if it matches `^[\w-]{1,128}$`, otherwise generates a UUID, and echoes it back.
  - cors uses `env.CORS_ORIGINS`.
  - The rate limiter is global per IP (`RATE_LIMIT_*`), skips `/health` and `/ready`, and sits after cors so browsers can read 429s.
  - Use `strictLimiter()` from `src/middleware/rate-limit.ts` on sensitive routes such as login. It's an in-memory store, so limits are per instance; switch to a shared store before scaling out.
- `req.ip` is only correct behind a proxy if `TRUST_PROXY` is set to the number of hops. It defaults to 0 while the deployment topology is undecided.
- Request validation: `validateBody(Dto)` / `validateQuery(Dto)` from `src/middleware/validate.ts`.
  - Unknown properties are rejected with a 400 whose `details` maps field path → messages.
  - Bodies are not type-coerced, query strings are. The validated query is on `res.locals.query`, because Express 5's `req.query` is read-only.
  - Error formatting is shared with env validation via `src/common/validation.ts`.
- `src/config/env.ts` validates `process.env` with class-validator at import time and exports a frozen `env`. Read config from `env`, never from `process.env` directly. Add new variables there with `@Expose()` or they are dropped, and document them in `.env.example`, which lists every variable with its default. `CORS_ORIGIN` must be exact http(s) origins; `*` is rejected because CORS uses credentials.
- `src/config/logger.ts` is the shared pino logger (pretty in development, JSON with string `level` and `service` fields otherwise). It redacts `password`/`token`/`secret`/`authorization`-style keys. Inside handlers use `req.log` so lines carry the request id. 404s aren't logged as errors, other 4xx are logged at `warn`, and 5xx at `error`.
- Errors: throw `HttpError(status, message, details?)` from `src/middleware/errors.ts`. Express 5 forwards async throws, so no try/catch or `next(err)` wrapper is needed. Responses are `{ error: { status, message, details? } }`; 5xx messages are hidden outside development.
- OpenAPI: `@openapi` JSDoc blocks in `src/app.ts`, `src/health/routes.ts` and `src/routes/**` are collected by `src/docs/swagger.ts`. Swagger UI at `/docs`, spec at `/docs.json`, both disabled when `NODE_ENV=production`, where `getOpenapiSpec()` never runs. `package.json` `overrides.glob` forces a patched `glob` under swagger-jsdoc (it pins a vulnerable 11.x). Re-check that override when upgrading swagger-jsdoc.
- `vitest.config.ts` sets placeholder `DATABASE_URL`/`CORS_ORIGIN` so `env.ts` validates under test.

## Commands

Requires Node >= 26 (`.nvmrc`; `.npmrc` sets `engine-strict`). Install with `npm ci`. TypeScript is pinned to an exact version on purpose; it's the TS 7 native compiler, which has no JS API, so `ts-node` / `typeorm-ts-node-*` cannot be used.

Copy `.env.example` to `.env`. Only `DATABASE_URL` and `CORS_ORIGIN` are required; everything else has a default. There is no `dotenv`: `src/config/env.ts` calls `process.loadEnvFile()` itself (if `.env` exists, never overriding variables already set, and skipped when `NODE_ENV=test`). So the app, TypeORM CLI and seed script all get `.env` just by importing `env`.

```sh
npm run dev         # clean build, then tsc watch + node --watch dist/server.js (runs compiled output)
npm run build       # rm -rf dist && tsc -p tsconfig.build.json (excludes *.test.ts / *.spec.ts)
npm start           # node dist/server.js
npm run typecheck   # tsc --noEmit on tsconfig.json, tests included (there is no linter configured)
npm test            # vitest run with NODE_ENV=test LOG_LEVEL=silent; only src/**/*.{test,spec}.ts
npm test -- path/to/file.test.ts         # single file
npm test -- path/to/file.test.ts -t "name"  # single test by name

npm run db:generate -- src/database/migrations/<Name>  # build, then generate a migration
npm run db:run      # build, then apply migrations
npm run db:revert   # build, then revert the last migration
npm run db:seed     # build, then run the seed script
```

The TypeORM CLI runs against compiled JS in `dist/`, so entity and migration globs in the DataSource must point at `dist/**/*.js`, not `src/**/*.ts`. `build` wipes `dist/` first so deleted entities/migrations don't linger.

CI: `.github/workflows/ci.yml` runs `npm ci` → typecheck → test → build → `npm audit --omit=dev --audit-level=high` on Node from `.nvmrc`, with a Postgres 17 service available for integration tests.

There is no linter: `typescript-eslint` requires TypeScript < 6.1 and can't run against TS 7. Use Biome if one is added.

## TypeScript / module conventions

- ESM (`"type": "module"`) with `module`/`moduleResolution: nodenext`: relative imports must use the `.js` extension (e.g. `import { x } from './routes/tickets.js'`).
- `verbatimModuleSyntax` is on, so type-only imports must use `import type`.
- `experimentalDecorators` + `emitDecoratorMetadata` are enabled for TypeORM and class-validator. Import `reflect-metadata` once at the top of each entrypoint (server, data source, seed). `useDefineForClassFields` is `false` so entity fields don't become own properties that shadow decorator-defined accessors; don't turn it back on. Node's built-in type stripping can't emit decorator metadata, so always go through `tsc`.
- `strictPropertyInitialization` is off (for decorated entity fields), but `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Indexed access returns `T | undefined`, and you can't assign `undefined` to an optional property unless its type includes it explicitly.
- `rootDir` is `src`, so all source (including tests, if they are type-checked) must live under `src/`.
