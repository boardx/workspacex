import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const wrangler = readFileSync(path.join(appRoot, "wrangler.toml"), "utf8");
const packageJson = JSON.parse(
  readFileSync(path.join(appRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const deployWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/deploy-devportal.yml"),
  "utf8",
);

describe("WorkSpaceX DevPortal deployment boundary (#450)", () => {
  it("targets the WorkSpaceX gateway and repository", () => {
    expect(wrangler).toContain(
      'COORD_GATEWAY_URL = "https://coord-gateway.boardx.workers.dev"',
    );
    expect(wrangler).toContain('GITHUB_REPO = "boardx/workspacex"');
    expect(wrangler).not.toMatch(/^\s*COORD_SERVICE_[A-Z0-9_]*\s*=/m);
  });

  it("does not create a second coordination database", () => {
    expect(wrangler).not.toMatch(/\[\[\s*d1_databases\s*\]\]/i);
    expect(wrangler).not.toMatch(/\[\[\s*durable_objects\.bindings\s*\]\]/i);
    expect(wrangler).not.toMatch(/\[\[\s*hyperdrive\s*\]\]/i);

    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    expect(Object.keys(allDependencies)).not.toEqual(
      expect.arrayContaining(["pg", "postgres", "@neondatabase/serverless"]),
    );
  });

  it("validates pull requests and deploys only WorkSpaceX main to the existing Pages project", () => {
    expect(deployWorkflow).toContain("pull_request:");
    expect(deployWorkflow).toContain("github.event_name == 'push'");
    expect(deployWorkflow).toContain("--project-name devportal");
    expect(deployWorkflow).toContain("https://develop.boardx.us/");
    expect(deployWorkflow).toContain("https://devportal-4mx.pages.dev/api/portal/pulse");
  });
});
