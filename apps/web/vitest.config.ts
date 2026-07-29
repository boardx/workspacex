import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@/…` is the app's own alias (tsconfig `paths`). Without it here, a test may only READ a
  // module's source, never import it -- and a source-text assertion cannot check that the values
  // agree with the contract, only that the import line is spelled right.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
