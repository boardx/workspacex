import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = readFileSync(resolve(root, ".github/workflows/promote-cn-production.yml"), "utf8");
const candidateWorkflow = readFileSync(resolve(root, ".github/workflows/prepare-cn-release.yml"), "utf8");
const verifier = readFileSync(resolve(root, ".harness/scripts/vm/verify-cn-release-promotion.sh"), "utf8");
const bootstrap = readFileSync(resolve(root, ".harness/scripts/vm/bootstrap-cn-production.sh"), "utf8");
const deploy = readFileSync(resolve(root, ".harness/scripts/vm/deploy-cn-production.sh"), "utf8");

describe("GitHub-based CN production promotion", () => {
  it("verifies checkout ancestry offline and rejects missing or invalid identities", () => {
    const result = spawnSync(process.execPath, ["--test", ".harness/scripts/vm/cn-checkout-offline.selftest.mjs"], { encoding: "utf8" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it("accepts only an exact SHA and an explicit compare-and-swap baseline", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_sha:");
    expect(workflow).toContain("expected_main_cn_sha:");
    expect(workflow).toContain('[[ "${REVISION}" =~ ^[a-f0-9]{40}$ ]]');
    expect(workflow).toContain('[[ "${EXPECTED_MAIN_CN}" =~ ^[a-f0-9]{40}$ ]]');
    expect(workflow).toContain('git merge-base --is-ancestor "${EXPECTED_MAIN_CN}" "${REVISION}"');
  });

  it("requires the production Environment and serializes promotion with activation", () => {
    expect(workflow).toContain("environment: production-cn-promotion");
    expect(workflow).toContain("group: workspacex-cn-production-deploy");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).not.toContain("CN_RELEASE_GITHUB_TOKEN");
    expect(workflow).toContain('rule.type==="required_reviewers"');
    expect(workflow).toContain('JSON.stringify(names)!==JSON.stringify(["main","main-cn"])');
    expect(workflow).toContain("production-cn must allow exactly main and main-cn and must not require a second reviewer");
    expect(workflow).toContain('deployments.includes("production-cn-promotion")');
    expect(workflow).toContain('types.has("deletion")');
    expect(workflow).toContain('"${GITHUB_REF}" == refs/heads/main');
    expect(workflow.match(/environment: production-cn-promotion/g)).toHaveLength(1);
    expect(workflow.match(/environment: production-cn$/gm)).toHaveLength(1);
  });

  it("fails closed on privileged script drift and seeds the domestic mirror from GitHub", () => {
    expect(workflow).toContain("actions/checkout@v5");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("git rev-parse --verify origin/main");
    expect(workflow).toContain("CN_TRUSTED_ENTRYPOINT_DRIFT");
    expect(workflow).toContain("workspacex-cn-verify-promotion");
    expect(workflow).toContain("/opt/workspacex-cn/release-origin-cache.git");
    expect(workflow).toContain('fetch --no-tags "${GITHUB_WORKSPACE}" "+${REVISION}:refs/heads/main"');
    expect(workflow).toContain("GIT_NO_LAZY_FETCH=1");
    expect(candidateWorkflow).toContain("actions/checkout@v5");
    expect(candidateWorkflow).toContain("persist-credentials: false");
    expect(candidateWorkflow).toContain("git rev-parse --verify origin/main");
    expect(candidateWorkflow).toContain("CN_SOURCE_CACHE_REVISION_MISMATCH");
    expect(candidateWorkflow).toContain("CN_TRUSTED_ENTRYPOINT_DRIFT");
  });

  it("prepares only when absent, then verifies protected evidence before CAS", () => {
    const verify = workflow.indexOf('workspacex-cn-verify-promotion "${REVISION}" "${EXPECTED_MAIN_CN}"');
    const prepare = workflow.indexOf('workspacex-cn-deploy --prepare "${REVISION}"');
    const promote = workflow.indexOf("Activate, browser-verify, then compare-and-swap main-cn");
    expect(verify).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(verify);
    expect(promote).toBeGreaterThan(prepare);
    expect(workflow).toContain("if [[ ${verify_status} -eq 3 ]]");
    expect(workflow).toContain("CN_PROMOTION_PREPARED_RECEIPT_REJECTED");
  });

  it("activates before a strict GraphQL CAS and compensates if the final ref write fails", () => {
    expect(workflow).toContain('git/ref/heads/main-cn" --jq .object.sha');
    expect(workflow).toContain("updateRefs(input:");
    expect(workflow).toContain('refUpdates:[{name:"refs/heads/main-cn",beforeOid,afterOid,force:false}]');
    expect(workflow).toContain('gh api graphql --input "${graphql_input}"');
    expect(workflow).not.toContain("git push origin");
    expect(workflow).toContain('[[ "${current}" == "${EXPECTED_MAIN_CN}" ]]');
    expect(workflow).toContain('update-ref refs/heads/main-cn "${REVISION}" "${EXPECTED_MAIN_CN}"');
    expect(workflow).toContain('rev-parse origin/main-cn)" == "${REVISION}"');
    const activate = workflow.indexOf('workspacex-cn-deploy "${REVISION}"');
    const cas = workflow.indexOf("updateRefs(input:");
    expect(activate).toBeGreaterThan(-1);
    expect(cas).toBeGreaterThan(activate);
    expect(workflow).toContain('workspacex-cn-deploy --rollback "${REVISION}"');
    expect(workflow).toContain('workspacex-cn-deploy --verify-active "${REVISION}"');
    expect(workflow).not.toContain("gh workflow run deploy-cn-production.yml");
    expect(deploy).toContain("--rollback|--verify-active");
    expect(deploy).toContain("promotion_cas_rollback_completed");
    expect(deploy).toContain("CN_PRODUCTION_ACTIVE_VERIFIED");
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
