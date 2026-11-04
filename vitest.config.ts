import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    environment: "node",
    // Required by src/config/env.ts; real DB tests should override DATABASE_URL.
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/helpdesk-test",
      CORS_ORIGIN: "http://localhost:5173",
    },
  },
});
