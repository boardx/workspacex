import { afterEach, describe, expect, it } from "vitest";
// next.config is executable ESM JavaScript and intentionally has no declaration file.
// @ts-expect-error importing runtime Next configuration is the behavior under test.
import rawNextConfig from "../../next.config.mjs";

type Rewrite = { source: string; destination: string };
const nextConfig = rawNextConfig as { rewrites(): Promise<{ readonly afterFiles: readonly Rewrite[] }> };
const originalOrigin = process.env.FULLSTACK_E2E_API_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.FULLSTACK_E2E_API_ORIGIN;
  else process.env.FULLSTACK_E2E_API_ORIGIN = originalOrigin;
});

describe("Board same-origin API rewrites", () => {
  it("routes Board collections, resources, tag catalog and tag resources", async () => {
    process.env.FULLSTACK_E2E_API_ORIGIN = "http://127.0.0.1:3274";
    const { afterFiles } = await nextConfig.rewrites();
    const sources = new Set(afterFiles.map(rewrite => rewrite.source));
    for (const source of ["/whiteboards", "/whiteboards/:path*", "/whiteboard-tags", "/whiteboard-tags/:path*"]) {
      expect(sources.has(`/__fullstack_api${source}`), `missing ${source}`).toBe(true);
    }
  });
});
