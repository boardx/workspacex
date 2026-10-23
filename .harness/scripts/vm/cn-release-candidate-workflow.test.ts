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
    expect(workflow).toContain("actions: write");
    expect(promotion).toContain("actions: write");
  });
  it("requires manual main admission and rejects unsafe contexts before side effects", () => {
    const result = spawnSync("python3", ["-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_prepare_manual_gate.py", "-v"], { encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("executes the automatic dispatcher counterexamples in the harness CI lane", () => {
    const result = spawnSync(process.execPath, ["--test", ".github/scripts/cn-auto-release.test.mjs", ".github/scripts/cn-auto-source.test.mjs", ".harness/scripts/vm/cn-auto-isolated-target.test.mjs", ".harness/scripts/vm/cn-migration-runtime-probe.test.mjs"], { encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("executes real Python source importer counterexamples in the harness CI lane", () => {
    const result = spawnSync("python3", ["-B", "-m", "unittest", "discover", "-s", ".harness/scripts/vm/tests", "-p", "test_cn_auto_source.py", "-v"], { encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 65_000);

  it("executes automatic host provider boundaries and timeout counterexamples",()=>{
    for(const pattern of ["test_cn_auto_prepare.py","test_cn_auto_prepare_provider.py","test_cn_compose_baseline.py","test_cn_auto_baseline_schema.py"]){
      const result=spawnSync("python3",["-B","-m","unittest","discover","-s",".harness/scripts/vm","-p",pattern,"-v"],{encoding:"utf8",timeout:60_000});
      expect(result.status,result.stdout+result.stderr).toBe(0);
      expect(result.stdout+result.stderr).not.toContain("Ran 0 tests");
    }
  },70_000);

  it.skipIf(process.platform!=="linux"||process.env.GITHUB_ACTIONS!=="true")("executes encrypted backup, restored row fidelity, internal network and daemon timeout cleanup on real Docker",()=>{
    for(const image of ["postgres:16","redis:7"]){
      const pull=spawnSync("docker",["pull",image],{encoding:"utf8",timeout:180_000});
      expect(pull.status,pull.stdout+pull.stderr).toBe(0);
    }
    const result=spawnSync("python3",["-B","-m","unittest","discover","-s",".harness/scripts/vm","-p","test_cn_auto_prepare_provider.py","-v"],{encoding:"utf8",timeout:240_000,env:{...process.env,CN_AUTO_PREPARE_DOCKER_TEST:"1"}});
    expect(result.status,result.stdout+result.stderr).toBe(0);
    expect(result.stdout+result.stderr).not.toContain("skipped");
  },610_000);

  // Local macOS skips are explicit and cannot establish Linux uid/lock behavior
  // or live host readiness. CI uses an official disposable image, never a local image.
  it.skipIf(process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true")("executes root Linux source import integration without a network", () => {
    const result = spawnSync("docker", ["run", "--rm", "--user", "0", "--network", "none", "-v", `${process.cwd()}:/source:ro`, "python:3.12-bookworm", "python3", "-B", "/source/.harness/scripts/vm/tests/cn-auto-source-linux-integration.py"], { encoding: "utf8", timeout: 180_000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS: two actual root/ghrunner imports");
  }, 190_000);

  it("defaults auto-promotion off and dispatches only after complete frozen-tag preparation", () => {
    expect(workflow).toMatch(/auto_promote:[\s\S]*?type: boolean\n        default: false/);
    expect(workflow).toContain("if: inputs.auto_promote");
    expect(workflow).toContain("RELEASE_TAG: ${{ steps.prepared.outputs.release_tag }}");
    expect(workflow).toContain("id: prepared");
    const dispatch = workflow.indexOf("cn-auto-release.mjs promote");
    expect(dispatch).toBeGreaterThan(workflow.indexOf("freeze-tag"));
    expect(workflow.indexOf("freeze-tag")).toBeGreaterThan(workflow.indexOf('workspacex-cn-verify-promotion "${revision}"'));
    expect(workflow).not.toMatch(/always\(\).*auto_promote/);
    expect(workflow).not.toContain("continue-on-error");
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
