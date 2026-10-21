import { defineConfig } from "vitest/config";

// Every test starts its own in-process Postgres (PGlite). With test files running in parallel
// that can take longer than vitest's 5 s default on a busy machine, so allow more.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
