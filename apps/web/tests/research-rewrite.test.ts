import { afterEach, describe, expect, it } from "vitest";

// next.config is executable ESM JavaScript and intentionally has no standalone declaration file.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../next.config.mjs";

type Rewrite = { readonly source: string; readonly destination: string };
const nextConfig = rawNextConfig as { rewrites(): Promise<readonly Rewrite[]> };

const ORIGINAL_ORIGIN = process.env.FULLSTACK_E2E_API_ORIGIN;

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.FULLSTACK_E2E_API_ORIGIN;
  else process.env.FULLSTACK_E2E_API_ORIGIN = ORIGINAL_ORIGIN;
});

describe("guided research browser routing", () => {
  it("proxies the bare collection and every session checkpoint to the real API", async () => {
    process.env.FULLSTACK_E2E_API_ORIGIN = "http://127.0.0.1:3274";

    const rewrites = await nextConfig.rewrites();
    const researchRewrites = rewrites
      .filter((rewrite) => rewrite.source.includes("/research"));

    expect(researchRewrites).toEqual([
      { source: "/__fullstack_api/research", destination: "http://127.0.0.1:3274/research" },
      { source: "/__fullstack_api/research/:path*", destination: "http://127.0.0.1:3274/research/:path*" },
    ]);
  });
});
