import { fileURLToPath } from "node:url";
import swaggerJsdoc from "swagger-jsdoc";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));

let cached: object | undefined;

/**
 * Builds the OpenAPI spec from @openapi JSDoc blocks (works from dist/, since tsc keeps comments, and from
 * src/ under vitest). Lazy + memoized so production, where docs are off, never scans files.
 */
export function getOpenapiSpec(): object {
  cached ??= swaggerJsdoc({
    definition: {
      openapi: "3.1.0",
      info: { title: "Helpdesk API", version: "1.0.0" },
    },
    apis: [
      `${srcRoot}app.{js,ts}`,
      `${srcRoot}health/routes.{js,ts}`,
      `${srcRoot}routes/**/*.{js,ts}`,
    ],
  });
  return cached;
}
