import { afterEach, describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { research } from "@repo/contracts";
import { GUIDED_RESEARCH_SIX_STEPS } from "../lib/guided-research-six-step";

// next.config is executable ESM JavaScript and intentionally has no standalone declaration file.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../next.config.mjs";

type Rewrite = { readonly source: string; readonly destination: string; readonly has?: readonly { type: string; key: string; value: string }[] };
// issue #2067: `rewrites()` now returns `{ beforeFiles, afterFiles }` (a `/chat` rewrite
// needed the `beforeFiles` slot — see next.config.mjs's own header comment on why) instead
// of a bare array. The e2e API-proxy rules this test cares about are still in `afterFiles`.
const nextConfig = rawNextConfig as { rewrites(): Promise<{ readonly afterFiles: readonly Rewrite[] }> };

const ORIGINAL_ORIGIN = process.env.FULLSTACK_E2E_API_ORIGIN;
const ORIGINAL_CHAT_ORIGIN = process.env.CHAT_READ_E2E_API_ORIGIN;

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.FULLSTACK_E2E_API_ORIGIN;
  else process.env.FULLSTACK_E2E_API_ORIGIN = ORIGINAL_ORIGIN;
  if (ORIGINAL_CHAT_ORIGIN === undefined) delete process.env.CHAT_READ_E2E_API_ORIGIN;
  else process.env.CHAT_READ_E2E_API_ORIGIN = ORIGINAL_CHAT_ORIGIN;
});

describe("guided research browser routing", () => {
  it("keeps every workflow page internal before the same-origin API wildcard", async () => {
    delete process.env.FULLSTACK_E2E_API_ORIGIN;
    process.env.CHAT_READ_E2E_API_ORIGIN = "http://127.0.0.1:3274";
    const { afterFiles } = await nextConfig.rewrites();
    for (const step of GUIDED_RESEARCH_SIX_STEPS) {
      const pathname = `/research/grs_example/${step.id}`;
      const hit = afterFiles.find((rule) => !rule.has && getPathMatch(rule.source)(pathname) !== false);
      expect(hit?.destination, pathname).toBe(`/research/:sessionId/${step.id}`);
    }
    for (const operation of Object.values(research.operations)) {
      const pathname = operation.path.replace(/:[A-Za-z0-9_]+/g, "example");
      if (pathname !== "/research" && !pathname.startsWith("/research/")) continue;
      const hit = afterFiles.find((rule) => getPathMatch(rule.source)(pathname) !== false
        && (!rule.has || rule.has.every((condition) => condition.type === "header"
          && condition.key === "accept" && condition.value === "application/json")));
      expect(hit?.destination, pathname).toMatch(/^http:\/\/127\.0\.0\.1:3274\/research/);
    }
  });
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
