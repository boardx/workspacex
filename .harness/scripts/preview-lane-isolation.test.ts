import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isHeavyE2eCommand } from "./lib/heavy-suite-lock";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("fixture-only preview lane isolation (#4888, #4889)", () => {
  it.each(["prototype-audit", "design-loop"])("%s enters the existing heavy-browser lock", (lane) => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"));
    const command = pkg.scripts[`verify:${lane}`].split(" ") as string[];
    expect(command.slice(0, 3)).toEqual(["tsx", ".harness/scripts/with-test-isolation.ts", "--"]);
    expect(isHeavyE2eCommand(command.slice(3))).toBe(true);
  });

  it.each(["prototype-audit", "design-loop"])("%s uses its reserved port and rejects inherited API prefixes", async (lane) => {
    vi.stubEnv("WORKSPACEX_WEB_PORT", "28761");
    vi.stubEnv("E2E_BASE_URL", "");
    // No override rather than an explicitly empty override.
    delete process.env.E2E_BASE_URL;
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3200");
    vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "/__fullstack_api");
    const config = lane === "design-loop"
      ? (await import("../../apps/web/playwright.design-loop.config")).default
      : (await import("../../apps/web/playwright.prototype-audit.config")).default;
    const server = config.webServer as { command: string; url: string; env: Record<string, string> };
    expect(config.use?.baseURL).toBe("http://localhost:28761");
    expect(server.url).toBe(config.use?.baseURL);
    expect(server.command).toContain("next dev -p 28761");
    expect(server.env.NEXT_PUBLIC_API_URL).toBe(config.use?.baseURL);
    expect(server.env.NEXT_PUBLIC_API_PATH_PREFIX).toBe("");
    expect(config.workers).toBe(1);
  });
});
