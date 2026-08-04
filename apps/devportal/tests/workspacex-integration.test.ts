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
const cutoverScript = readFileSync(path.join(appRoot, "scripts/pages-cutover.mjs"), "utf8");

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
    expect(cutoverScript).toContain('const PROJECT = "devportal"');
    expect(cutoverScript).toContain('const CUSTOM_ORIGIN = "https://develop.boardx.us"');
    expect(cutoverScript).toContain(
      'const PAGES_ORIGIN = "https://devportal-4mx.pages.dev"',
    );
  });

  it("keeps pull-request cancellation isolated from serialized production deploys", () => {
    expect(deployWorkflow).toContain("github.event_name");
    expect(deployWorkflow).toContain("github.event.pull_request.number");
    expect(deployWorkflow).toContain("github.ref");
    expect(deployWorkflow).toMatch(
      /cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    );
    expect(deployWorkflow).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it("runs deployment and production smoke through the rollback-aware cutover", () => {
    expect(deployWorkflow).toContain("node scripts/pages-cutover.mjs");
    expect(deployWorkflow).not.toContain("pnpm exec wrangler pages deploy");
    expect(deployWorkflow).not.toContain("name: Public smoke check");
    const wranglerTeamDomain = wrangler.match(/^CF_ACCESS_TEAM_DOMAIN\s*=\s*"([^"]+)"/m)?.[1];
    const workflowTeamDomain = deployWorkflow.match(/^\s*CF_ACCESS_TEAM_DOMAIN:\s*(\S+)\s*$/m)?.[1];
    expect(wranglerTeamDomain).toBe("https://boardx.cloudflareaccess.com");
    expect(workflowTeamDomain).toBe(wranglerTeamDomain);
  });
});
