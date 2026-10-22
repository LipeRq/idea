import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json の "@/*" を解決する
  resolve: { tsconfigPaths: true },
  test: {
    // e2e/ は Playwright で実行する(npm run test:e2e)
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
