import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the repo-root shared contracts so tests can `import ... from "@shared/..."`,
// and the server source so tests can `import ... from "@/logic/..."`.
const sharedDir = fileURLToPath(new URL("../types", import.meta.url));
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": sharedDir,
      "@": srcDir,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
