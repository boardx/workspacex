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
    const promotion = readFileSync(resolve(process.cwd(), ".github/workflows/promote-cn-production.yml"), "utf8");
    // A candidate may prepare the same host later used by activation. Serialize
    // both jobs under the same non-cancelling group instead of racing locks.
    for (const source of [workflow, promotion]) {
      expect(source).toContain("group: workspacex-cn-production-deploy");
      expect(source).toContain("cancel-in-progress: false");
    }
    expect(workflow.indexOf("workspacex-cn-deploy --check-prepare-inputs")).toBeLessThan(workflow.indexOf("if ! sudo -n /usr/local/bin/workspacex-cn-build-candidate"));
    expect(workflow.indexOf("if ! sudo -n /usr/local/bin/workspacex-cn-build-candidate")).toBeLessThan(workflow.indexOf("workspacex-cn-deploy --prepare"));
    expect(workflow.indexOf("workspacex-cn-deploy --prepare")).toBeLessThan(workflow.indexOf('workspacex-cn-verify-promotion "${revision}"'));
    expect(workflow).not.toContain("docker build");
    expect(workflow).toContain("sudo -n /usr/local/bin/workspacex-cn-build-candidate");
    expect(workflow).toContain("CN_CANDIDATE_NONINTERACTIVE_ENTRYPOINT_FAILED");
    expect(workflow).not.toMatch(/\bsudo \/usr\/local\/bin\/workspacex-cn-build-candidate/);
  });
});
