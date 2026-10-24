import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = readFileSync(resolve(root, ".github/workflows/promote-cn-production.yml"), "utf8");
const candidateWorkflow = readFileSync(resolve(root, ".github/workflows/prepare-cn-release.yml"), "utf8");
const verifier = readFileSync(resolve(root, ".harness/scripts/vm/verify-cn-release-promotion.sh"), "utf8");
const identity = readFileSync(resolve(root, ".harness/scripts/vm/cn-frozen-release-identity.mjs"), "utf8");
const bootstrap = readFileSync(resolve(root, ".harness/scripts/vm/bootstrap-cn-production.sh"), "utf8");
const deploy = readFileSync(resolve(root, ".harness/scripts/vm/deploy-cn-production.sh"), "utf8");

describe("GitHub-based CN production promotion", () => {
  it("verifies checkout ancestry offline and rejects missing or invalid identities", () => {
    const result = spawnSync(process.execPath, ["--test", ".harness/scripts/vm/cn-checkout-offline.selftest.mjs"], { encoding: "utf8" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it("executes domestic Git export and runner capability failure fixtures", () => {
    // The full 13-case real Git/bundle/fsck suite took 50.16s in a standalone
    // run. Budget this test process explicitly; production deadlines are unchanged.
    const result = spawnSync(process.execPath, ["--test", ".harness/scripts/vm/cn-domestic-checkout.selftest.mjs"], { encoding: "utf8", timeout: 75000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 80000);
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
    expect(workflow).toContain('"${GITHUB_REF}" == refs/tags/cn-prepared-*');
    expect(workflow.match(/environment: production-cn-promotion/g)).toHaveLength(1);
    expect(workflow.match(/environment: production-cn$/gm)).toHaveLength(1);
  });

  it("does not audit release governance or require a governance receipt", () => {
    for(const text of [workflow,candidateWorkflow,verifier,identity]){
      expect(text).not.toMatch(/gh\s+api[^\n]*(?:rulesets|environments\/)/);
      expect(text).not.toContain('governance-evidence.json');
      expect(text).not.toContain('governance-public.pem');
      expect(text).not.toContain('governanceReceiptSha256');
      expect(text).not.toContain('FROZEN_RELEASE_ENVIRONMENT_POLICY');
    }
    expect(workflow).not.toContain('Verify automatic GitHub production governance');
    expect(identity).toContain("gh('apps/github-actions')");
    expect(identity).toContain('validateAdmissionDeployment');
  });

  it("fails closed on privileged script drift and requires source staging before approval", () => {
    expect(workflow).toContain("actions/checkout@v5");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("git rev-parse --verify origin/main");
    expect(workflow).toContain("CN_TRUSTED_ENTRYPOINT_DRIFT");
    expect(workflow).toContain("workspacex-cn-verify-promotion");
    expect(workflow).toContain("/opt/workspacex-cn/release-origin-cache.git");
    expect(workflow).not.toContain('fetch --no-tags "${GITHUB_WORKSPACE}"');
    expect(workflow).toContain("CN_FROZEN_RELEASE_OFFLINE_SOURCE_NOT_READY");
    expect(candidateWorkflow).not.toContain('fetch --no-tags "${GITHUB_WORKSPACE}"');
    expect(workflow).toContain("GIT_NO_LAZY_FETCH=1");
    const hostJob = candidateWorkflow.split("  build-candidate:")[1];
    const cloudJob = candidateWorkflow.split("  build-candidate:")[0];
    expect(hostJob).not.toContain("actions/checkout@v5");
    expect(hostJob).not.toMatch(/git.*fetch/);
    expect(cloudJob).toContain("runs-on: ubuntu-latest");
    expect(cloudJob).toContain("fetch-depth: 0");
    expect(candidateWorkflow).toContain("workspacex-cn-export-source");
    expect(candidateWorkflow).toContain("git merge-base --is-ancestor");
    expect(candidateWorkflow).toContain("CN_DOMESTIC_SOURCE_NOT_READY");
    expect(candidateWorkflow).toContain("CN_TRUSTED_ENTRYPOINT_DRIFT");
  });

  it("prepares before approval and rejects incomplete evidence without a fallback", () => {
    const readiness = workflow.indexOf("  readiness:");
    const verify = workflow.indexOf('workspacex-cn-verify-promotion "${verify_flags[@]}" "${REVISION}" "${EXPECTED_MAIN_CN}"');
    const approval = workflow.indexOf("environment: production-cn-promotion");
    const recheck = workflow.indexOf("Require a complete immutable preparation receipt");
    const activate = workflow.indexOf("Activate, browser-verify, then compare-and-swap main-cn");
    expect(readiness).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(readiness);
    expect(approval).toBeGreaterThan(verify);
    expect(workflow).toContain("needs: readiness");
    expect(recheck).toBeGreaterThan(approval);
    expect(activate).toBeGreaterThan(recheck);
    expect(workflow).not.toContain('workspacex-cn-deploy --prepare "${REVISION}"');
    expect(workflow).toContain("if [[ ${verify_status} -eq 3 ]]");
    expect(workflow).toContain("CN_PROMOTION_NOT_READY");
    const build = candidateWorkflow.indexOf("if ! sudo -n /usr/local/bin/workspacex-cn-build-candidate");
    const prepare = candidateWorkflow.indexOf('workspacex-cn-deploy --prepare "${revision}"');
    const prepared = candidateWorkflow.indexOf('workspacex-cn-verify-promotion "${revision}"');
    expect(build).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(build);
    expect(prepared).toBeGreaterThan(prepare);
  });

  it("activates before a strict GraphQL CAS and compensates if the final ref write fails", () => {
    expect(workflow).toContain('git/ref/heads/main-cn" --jq .object.sha');
    expect(workflow).toContain("updateRefs(input:");
    expect(workflow).toContain('refUpdates:[{name:"refs/heads/main-cn",beforeOid,afterOid,force:false}]');
    expect(workflow).toContain('gh api graphql --input "${graphql_input}"');
    expect(workflow).not.toContain("git push origin");
    expect(workflow).toContain('[[ "${current}" == "${expected_remote}" ]]');
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
    expect(bootstrap).toContain('"$TRUSTED_PROMOTION_BIN" "$TRUSTED_EXPORT_BIN" > "$sudoers_temp"');
  });
});


describe("branch-push activation gates", () => {
  const sha = "a".repeat(40), newer = "b".repeat(40);
  it("reserves the already-promoted shortcut for manual mode", () => {
    const condition = workflow.match(/if \[\[ "\$\{PROMOTION_MODE\}" == manual && "\$\{current\}" == "\$\{REVISION\}" \]\]; then/);
    expect(condition).not.toBeNull();
    for (const [mode, expected] of [["manual", "shortcut"], ["branch-push", "activate"]]) {
      const result = spawnSync("bash", ["-c", `${condition![0]} echo shortcut; else echo activate; fi`], {
        encoding: "utf8", env: { ...process.env, PROMOTION_MODE: mode, current: sha, REVISION: sha },
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(expected);
    }
  });
  it("rejects a superseded target before activation but accepts the current target", () => {
    const start = workflow.indexOf("          # Refuse an obsolete branch-push target");
    const end = workflow.indexOf("          # CN_LOCAL_PROMOTION_PREACTIVATION_END", start);
    expect(start).toBeGreaterThan(-1);
    const gate = workflow.slice(start, end);
    const activation = workflow.indexOf('workspacex-cn-deploy "${REVISION}"', end);
    expect(activation).toBeGreaterThan(end);
    for (const [head, expected] of [[sha, 0], [newer, 1]]) {
      const result = spawnSync("bash", ["-c", 'gh() { echo "$REMOTE_HEAD"; }; ' + gate], {
        encoding: "utf8", env: { ...process.env, PROMOTION_MODE: "branch-push", REVISION: sha, REMOTE_HEAD: head, GITHUB_REPOSITORY: "boardx/workspacex" },
      });
      expect(result.status, result.stderr).toBe(expected);
    }
  });
});

it("keeps the runtime baseline separate from the remote CAS target in automatic promotions", () => {
  const baseline = "b".repeat(40), revision = "a".repeat(40);
  const guardStart = workflow.indexOf("          expected_remote=${EXPECTED_MAIN_CN}");
  const guardEnd = workflow.indexOf("          sudo -n", guardStart);
  const guard = workflow.slice(guardStart, guardEnd);
  const casStart = workflow.indexOf("          repository_id=$(gh api");
  const casEnd = workflow.indexOf('          if [[ "${RELEASE_MODE:-standard}" == app-only ]]; then', casStart);
  const cas = workflow.slice(casStart, casEnd).split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  for (const [mode, head, status] of [["manual", baseline, 0], ["branch-push", revision, 0], ["branch-push", baseline, 1]] as const) {
    const result = spawnSync("bash", ["-c", `set -euo pipefail
gh(){ echo repository-id; }
${guard}
${cas}
trap 'rm -f "$graphql_input"' EXIT
cat "$graphql_input"`], {
      encoding: "utf8", env: { ...process.env, PROMOTION_MODE: mode, EXPECTED_MAIN_CN: baseline, REVISION: revision, current: head, GITHUB_REPOSITORY: "boardx/workspacex" },
    });
    expect(result.status, result.stderr).toBe(status);
    if (status === 0) {
      const ref = JSON.parse(result.stdout).variables.refUpdates[0];
      expect(ref).toEqual({ name: "refs/heads/main-cn", beforeOid: head, afterOid: revision, force: false });
    }
  }
});
