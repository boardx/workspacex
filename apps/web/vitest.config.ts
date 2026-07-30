import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@/…` is the app's own alias (tsconfig `paths`). Without it here, a test may only READ a
  // module's source, never import it -- and a source-text assertion cannot check that the values
  // agree with the contract, only that the import line is spelled right.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  /**
   * `tsconfig.json` says `"jsx": "preserve"` because Next does its own JSX transform. esbuild
   * honours that and leaves JSX untransformed, so a `.tsx` test dies with `React is not defined`.
   * Declaring the automatic runtime here keeps tsconfig untouched (Next still owns the build).
   */
  esbuild: { jsx: "automatic" },
  test: {
    /**
     * `.tsx` was NOT in `include` while 13 phase-01 features planned React component tests under
     * `tests/ui/*.test.tsx`. A vitest run that collects zero files exits 1, so this did not fake a
     * green on its own -- but combined with `pnpm --filter web vitest run` (no `exec`, which pnpm
     * resolves to "no such script" and exits 0) the whole class was unverifiable AND green.
     * Both halves are fixed: the command form (feature_list) and the collection glob (here).
     */
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    /**
     * Default stays `node`: the existing gates here read source text and must not pay for a DOM.
     * Only component tests get jsdom, so adding one `.tsx` file cannot slow the source-text gates.
     */
    environment: "node",
    environmentMatchGlobs: [
      ["tests/**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["tests/setup-dom.ts"],
  },
});
