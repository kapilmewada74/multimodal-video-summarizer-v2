import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js keeps JSX untouched for its own compiler; tests need it compiled.
  esbuild: { jsx: "automatic" },
});
