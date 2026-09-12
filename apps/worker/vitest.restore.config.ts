import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/backup-restore.acceptance.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
