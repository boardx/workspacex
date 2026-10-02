import { afterEach, describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
// @ts-expect-error executable Next configuration has no standalone declaration
import config from "../next.config.mjs";

type Rewrite = { source: string; destination: string; has?: Parameters<typeof matchHas>[2] };
function matches(rule: Rewrite, path: string, accept?: string) {
  return getPathMatch(rule.source)(path) !== false && (!rule.has || matchHas(
    { headers: accept ? { accept } : {}, cookies: {} } as Parameters<typeof matchHas>[0], {}, rule.has,
  ) !== false);
}
afterEach(() => vi.unstubAllEnvs());

describe("#930 projects collection proxy preserves the frontend page", () => {
  it("routes JSON before files, retaining HTML, RSC and ordinary navigation", async () => {
    vi.stubEnv("FULLSTACK_E2E_API_ORIGIN", undefined);
    vi.stubEnv("CHAT_READ_E2E_API_ORIGIN", "http://127.0.0.1:3274");
    const { beforeFiles, afterFiles } = await config.rewrites();
    expect(beforeFiles.find((r: Rewrite) => matches(r, "/projects", "application/json"))?.destination)
      .toBe("http://127.0.0.1:3274/projects");
    for (const accept of [undefined, "*/*", "text/html,application/xhtml+xml", "text/x-component"]) {
      expect(beforeFiles.find((r: Rewrite) => matches(r, "/projects", accept))).toBeUndefined();
    }
    expect(beforeFiles.find((r: Rewrite) => matches(r, "/projects/p/overview", "application/json"))).toBeUndefined();
    expect(afterFiles.find((r: Rewrite) => matches(r, "/projects/p/overview", "application/json"))?.destination)
      .toBe("http://127.0.0.1:3274/projects/:path*");
  });
  it("retains the explicit fullstack prefix without taking over /projects", async () => {
    vi.stubEnv("FULLSTACK_E2E_API_ORIGIN", "http://127.0.0.1:3274");
    const { beforeFiles, afterFiles } = await config.rewrites();
    expect(beforeFiles.find((r: Rewrite) => matches(r, "/projects", "application/json"))).toBeUndefined();
    expect(afterFiles.find((r: Rewrite) => matches(r, "/__fullstack_api/projects", "application/json"))?.destination)
      .toBe("http://127.0.0.1:3274/projects");
  });
  it("adds no API rewrite when no proxy origin is configured", async () => {
    vi.stubEnv("FULLSTACK_E2E_API_ORIGIN", "");
    vi.stubEnv("CHAT_READ_E2E_API_ORIGIN", "");
    const { beforeFiles } = await config.rewrites();
    expect(beforeFiles.find((r: Rewrite) => matches(r, "/projects", "application/json"))).toBeUndefined();
  });
});
