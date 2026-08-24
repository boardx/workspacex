import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@/…` is the app's own alias (tsconfig `paths`). Without it here, a test may only READ a
  // module's source, never import it -- and a source-text assertion cannot check that the values
  // agree with the contract, only that the import line is spelled right.
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
    server: {
      deps: {
        /**
         * DA-19b：vitest 默认把 `node_modules` 下的 ESM 包当 SSR "外部依赖"，交给
         * Node 原生 `import()` 加载，绕开 Vite/vitest 自己的模块图——`vi.mock()` 只能
         * 拦截经过 vitest 模块图的 import，拦不到被外部化后走 Node 原生加载器的这条
         * 路径。`@copilotkit/react-core` 顶层无条件 `import "./index.css"`
         * （Tailwind v4 编译产物），被外部化后 Node 原生加载器不认 `.css` 扩展名，
         * 直接 `ERR_UNKNOWN_FILE_EXTENSION`。`inline` 强制这个包走 vitest 自己的
         * 转换/模块图，`copilotkit-v2-panel-markdown.test.tsx` 里对这个 CSS specifier
         * 的 `vi.mock(..., () => ({}))` 才有拦截的路径可走。
         */
        inline: [/@copilotkit\/react-core/],
      },
    },
    /**
     * #76: neither timeout was set here, so both stayed at vitest's defaults (5s test /
     * 10s hook). This suite doesn't connect to Postgres like apps/api's does, so the risk
     * is smaller, but jsdom's first spin-up per file is not free on a loaded machine, and
     * an unset value here is exactly the kind of thing that looks fine until the day it
     * doesn't -- set explicitly rather than relying on "probably enough".
     */
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
