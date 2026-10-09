import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/prepare-cn-release.yml"), "utf8");

describe("CN release candidate workflow", () => {
  it("grants every new evidence read explicitly without deployment/check/status writes", () => {
    const promotion = readFileSync(resolve(process.cwd(), ".github/workflows/promote-cn-production.yml"), "utf8");
    for (const source of [workflow, promotion]) {
      for (const permission of ["checks: read", "statuses: read", "deployments: read", "contents: write"]) expect(source).toContain(permission);
      expect(source).not.toMatch(/(?:checks|statuses|deployments): write/);
      expect(source).toContain("GH_TOKEN: ${{ github.token }}");
    }
    expect(workflow).toContain("actions: read");
    expect(promotion).toContain("actions: write");
  });
  it("requires manual main admission and rejects unsafe contexts before side effects", () => {
    const result = spawnSync("python3", ["-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_prepare_manual_gate.py", "-v"], { encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("builds an exact SHA through the trusted candidate entrypoint", () => {
    expect(workflow).toContain("workspacex-cn-build-candidate");
    expect(workflow).toContain("INPUT_SHA: ${{ inputs.release_sha }}");
    expect(workflow).not.toContain("workflow_run");
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
