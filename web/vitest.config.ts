import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["web/test/**/*.test.ts"], poolOptions: { forks: { minForks: 1, maxForks: 2 } } } });
