import type { DataSource } from "typeorm";
import type { ReadinessCheck } from "../readiness.js";

export function databaseCheck(dataSource: DataSource): ReadinessCheck {
  return {
    name: "database",
    async check() {
      if (!dataSource.isInitialized) {
        throw new Error("data source not initialized");
      }
      await dataSource.query("SELECT 1");
    },
  };
}
