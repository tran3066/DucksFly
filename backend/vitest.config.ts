import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the repo-root shared contracts so tests can `import ... from "@shared/..."`.
const sharedDir = fileURLToPath(new URL("../types", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": sharedDir,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
