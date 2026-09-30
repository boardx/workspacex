import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = readFileSync(resolve(root, ".github/workflows/promote-cn-production.yml"), "utf8");
const candidateWorkflow = readFileSync(resolve(root, ".github/workflows/prepare-cn-release.yml"), "utf8");
const verifier = readFileSync(resolve(root, ".harness/scripts/vm/verify-cn-release-promotion.sh"), "utf8");
const bootstrap = readFileSync(resolve(root, ".harness/scripts/vm/bootstrap-cn-production.sh"), "utf8");

describe("GitHub-based CN production promotion", () => {
  it("accepts only an exact SHA and an explicit compare-and-swap baseline", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_sha:");
    expect(workflow).toContain("expected_main_cn_sha:");
    expect(workflow).toContain('[[ "${REVISION}" =~ ^[a-f0-9]{40}$ ]]');
    expect(workflow).toContain('[[ "${EXPECTED_MAIN_CN}" =~ ^[a-f0-9]{40}$ ]]');
    expect(workflow).toContain('git merge-base --is-ancestor "${EXPECTED_MAIN_CN}" "${REVISION}"');
  });

  it("requires the production Environment and serializes promotion with activation", () => {
    expect(workflow).toContain("environment: production-cn");
    expect(workflow).toContain("group: workspacex-cn-production-deploy");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("CN_RELEASE_GITHUB_TOKEN");
    expect(workflow).toContain('rule.type==="required_reviewers"');
    expect(workflow).toContain("deployment_branch_policy?.protected_branches===true");
    expect(workflow).toContain('"${GITHUB_REF}" == refs/heads/main');
    expect(workflow).toContain("main-cn direct pushes must be restricted");
  });

  it("fails closed on privileged script drift and seeds the domestic mirror from GitHub", () => {
    expect(workflow).toContain("actions/checkout@v4");
    expect(workflow).toContain("CN_TRUSTED_ENTRYPOINT_DRIFT");
    expect(workflow).toContain("workspacex-cn-verify-promotion");
    expect(workflow).toContain("/opt/workspacex-cn/release-origin-cache.git");
    expect(workflow).toContain('fetch --no-tags "${GITHUB_WORKSPACE}" "+${REVISION}:refs/heads/main"');
    expect(workflow).toContain("GIT_NO_LAZY_FETCH=1");
    expect(candidateWorkflow).toContain("actions/checkout@v4");
    expect(candidateWorkflow).toContain("CN_SOURCE_CACHE_REVISION_MISMATCH");
    expect(candidateWorkflow).toContain("CN_TRUSTED_ENTRYPOINT_DRIFT");
  });

  it("prepares only when absent, then verifies protected evidence before CAS", () => {
    const verify = workflow.indexOf('workspacex-cn-verify-promotion "${REVISION}" "${EXPECTED_MAIN_CN}"');
    const prepare = workflow.indexOf('workspacex-cn-deploy --prepare "${REVISION}"');
    const promote = workflow.indexOf("Compare-and-swap main-cn by fast-forward");
    expect(verify).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(verify);
    expect(promote).toBeGreaterThan(prepare);
    expect(workflow).toContain("if [[ ${verify_status} -eq 3 ]]");
    expect(workflow).toContain("CN_PROMOTION_PREPARED_RECEIPT_REJECTED");
  });

  it("re-reads the ref, uses the non-force GitHub API, and never directly activates production", () => {
    expect(workflow).toContain('git/ref/heads/main-cn" --jq .object.sha');
    expect(workflow).toContain('git/refs/heads/main-cn"');
    expect(workflow).toContain("-F force=false");
    expect(workflow).not.toContain("git push origin");
    expect(workflow).toContain('[[ "${current}" == "${EXPECTED_MAIN_CN}" ]]');
    expect(workflow).toContain("gh workflow run deploy-cn-production.yml");
    expect(workflow).not.toContain("workspacex-cn-deploy \"${REVISION}\"");
  });

  it("root verifier binds the live baseline to manifest, seal, and fresh receipts", () => {
    expect(verifier).toContain("CN_PROMOTION_NOT_PREPARED");
    expect(verifier).toContain('exit 3');
    expect(verifier).toContain('fast-safe-release.json');
    expect(verifier).toContain('prepare-receipt.json');
    expect(verifier).toContain('"$PREFLIGHT_VERIFIER" preactivate');
    expect(verifier).toContain("candidate manifest or seal validation failed");
    expect(verifier).toContain("capture_baseline");
    expect(verifier).toContain("cn-fast-safe-release validate");
    expect(verifier).toContain("release.lock");
    expect(verifier).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|git push/);
  });

  it("installs the verifier only through the controlled root bootstrap", () => {
    expect(bootstrap).toContain("TRUSTED_PROMOTION_BIN");
    expect(bootstrap).toContain('install -o root -g root -m 0755 "$promotion_script" "$TRUSTED_PROMOTION_BIN"');
    expect(bootstrap).toContain('"$TRUSTED_PROMOTION_BIN" > "$sudoers_temp"');
  });
});
