import { afterEach, describe, expect, it } from "vitest";

// next.config is executable ESM JavaScript and intentionally has no standalone declaration file.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../next.config.mjs";

type Rewrite = { readonly source: string; readonly destination: string };
// issue #2067: `rewrites()` now returns `{ beforeFiles, afterFiles }` (a `/chat` rewrite
// needed the `beforeFiles` slot — see next.config.mjs's own header comment on why) instead
// of a bare array. The e2e API-proxy rules this test cares about are still in `afterFiles`.
const nextConfig = rawNextConfig as { rewrites(): Promise<{ readonly afterFiles: readonly Rewrite[] }> };

const ORIGINAL_ORIGIN = process.env.FULLSTACK_E2E_API_ORIGIN;

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.FULLSTACK_E2E_API_ORIGIN;
  else process.env.FULLSTACK_E2E_API_ORIGIN = ORIGINAL_ORIGIN;
});

describe("guided research browser routing", () => {
  it("proxies the bare collection and every session checkpoint to the real API", async () => {
    process.env.FULLSTACK_E2E_API_ORIGIN = "http://127.0.0.1:3274";

    const { afterFiles } = await nextConfig.rewrites();
    const researchRewrites = afterFiles
      .filter((rewrite) => rewrite.source.includes("/research"));

    expect(researchRewrites).toEqual([
      { source: "/__fullstack_api/research", destination: "http://127.0.0.1:3274/research" },
      { source: "/__fullstack_api/research/:path*", destination: "http://127.0.0.1:3274/research/:path*" },
    ]);
  });
});
