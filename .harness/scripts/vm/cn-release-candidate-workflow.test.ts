import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/prepare-cn-release.yml"), "utf8");

describe("CN release candidate workflow", () => {
  it("starts only after a successful main backend-gates run", () => {
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain('workflows: ["backend-gates"]');
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it("builds an exact SHA through the trusted candidate entrypoint", () => {
    expect(workflow).toContain("workspacex-cn-build-candidate");
    expect(workflow).toContain("github.event.workflow_run.head_sha");
    expect(workflow).toContain("workspacex-cn-release-candidate");
    expect(workflow).not.toContain("docker build");
  });
});
