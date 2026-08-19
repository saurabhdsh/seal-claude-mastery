import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^(\.{1,2}\/.+)\.js$/, replacement: "$1.ts" }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://saurabhdubey@127.0.0.1:5432/seal?schema=public",
      JWT_ACCESS_SECRET: "test-access-secret-32-chars-minimum",
      JWT_REFRESH_SECRET: "test-refresh-secret-32-chars-minimum",
      REDIS_URL: "redis://localhost:6379",
      APP_URL: "http://localhost:5173",
    },
  },
});
