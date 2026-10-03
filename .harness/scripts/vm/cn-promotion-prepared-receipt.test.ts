import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const promotion = readFileSync(resolve(root, ".github/workflows/promote-cn-production.yml"), "utf8");
const candidate = readFileSync(resolve(root, ".github/workflows/prepare-cn-release.yml"), "utf8");
const deploy = readFileSync(resolve(import.meta.dirname, "deploy-cn-production.sh"), "utf8");
const verifier = readFileSync(resolve(import.meta.dirname, "verify-cn-release-promotion.sh"), "utf8");
type Step = { name?: string; run?: string };
const jobs = parse(promotion).jobs;
const step = (job: string, name: string): string => {
  const found = (jobs[job].steps as Step[]).find(item => item.name === name)?.run;
  if (!found) throw new Error(`Missing promotion gate ${job}/${name}`);
  return found;
};
const ready = step("readiness", "Fail NOT_READY before asking for production admission");
const admission = step("admit", "Require a complete immutable preparation receipt");
const revision = "a".repeat(40);
const baseline = "b".repeat(40);
function run(block: string, status: number, sha = revision) {
  // Only the read-only promotion verifier is authorized by the fixture. Any
  // fallback prepare/build/activation call fails even when verifier returns 0.
  const mock = `set -euo pipefail
REVISION=${revision}
EXPECTED_MAIN_CN=${baseline}
ATTEMPT_ID=gha-regression-1
GITHUB_SHA=${sha}
GITHUB_REF=refs/tags/cn-prepared-${revision}-gha-regression-1
EXPECTED_REQUEST_SHA256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
node() { [[ "$1" == --experimental-strip-types && "$3" == verify-dispatch ]] || exit 98; return 0; }
cmp() { return 0; }
git() { if [[ "$1" == rev-parse ]]; then echo ${baseline}; else return 0; fi; }
sudo() {
  [[ "$#" -eq 5 && "$1" == -n && "$2" == /usr/local/bin/workspacex-cn-verify-promotion ]] || exit 99
  printf 'VERIFIER_CALLED\\n' >&2
  return ${status}
}
`;
  return spawnSync("bash", ["-c", mock + block], { encoding: "utf8", timeout: 5_000 });
}

describe("CN complete preparation before production approval", () => {
  it("runs the real receipt gate in an unprotected job before admission", () => {
    expect(jobs.readiness.environment).toBeUndefined();
    expect(jobs.admit.needs).toBe("readiness");
    expect(jobs.admit.environment).toBe("production-cn-promotion");
    expect(ready).toContain("cmp --silent");
    expect(ready).toContain("workspacex-cn-verify-promotion");
    expect(promotion).not.toMatch(/sudo -n \/usr\/local\/bin\/workspacex-cn-(?:deploy --prepare|build-candidate)|docker build/);
  });

  for (const status of [0, 1, 3, 42]) {
    it(`preserves verifier exit ${status} before and after approval with no fallback`, () => {
      for (const block of [ready, admission]) {
        const result = run(block, status);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(status);
        expect((result.stdout + result.stderr)).toContain("VERIFIER_CALLED");
        expect(result.stdout.includes("CN_PROMOTION_NOT_READY")).toBe(status !== 0);
      }
    });
  }

  it("rejects workflow/source identity mismatch before receipt access or approval", () => {
    const result = run(ready, 0, baseline);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("CN_PROMOTION_NOT_READY_IDENTITY");
    expect((result.stdout + result.stderr)).not.toContain("VERIFIER_CALLED");
  });

  it("rejects trusted verifier drift and malformed attempt before receipt access", () => {
    for (const block of [ready.replace("cmp --silent", "false"), ready.replace('"${ATTEMPT_ID}" =~', '"invalid/attempt" =~')]) {
      const result = run(block, 0);
      expect(result.status).not.toBe(0);
      expect((result.stdout + result.stderr)).not.toContain("VERIFIER_CALLED");
    }
  });

  it("rejects GitHub baseline drift before approval while allowing exact replays", () => {
    const changed = ready.replace('github_main_cn=$(git rev-parse origin/main-cn)', 'github_main_cn=' + "c".repeat(40));
    const rejected = run(changed, 0);
    expect(rejected.status).toBe(3);
    expect((rejected.stdout + rejected.stderr)).not.toContain("VERIFIER_CALLED");
    const replay = ready.replace('github_main_cn=$(git rev-parse origin/main-cn)', 'github_main_cn=' + revision);
    expect(run(replay, 0).status).toBe(0);
  });

  it("uses complete receipt verification, not an input-presence assertion", () => {
    expect(candidate).toContain("workspacex-cn-deploy --check-prepare-inputs");
    expect(candidate).not.toContain('git -C "${repository}" fetch');
    const exporter = readFileSync(resolve(root, ".harness/scripts/vm/stage-cn-offline-source-cache.sh"), "utf8");
    expect(candidate).toContain("workspacex-cn-export-source");
    expect(exporter).toContain("CN_RELEASE_NOT_READY_BASELINE_REPOSITORY");
    expect(deploy).toContain("CN_RELEASE_PREPARE_INPUTS_PRESENT");
    expect(ready).not.toContain("--check-prepare-inputs");
    for (const gate of ["protected_file \"$prepare_receipt\"", "protected_file \"$fast_safe_receipt\"", "candidate configuration receipt rejected", "preactivate receipt is missing, changed, or expired", "prepared receipt, baseline, or manifest differs"]) {
      expect(verifier).toContain(gate);
    }
  });

  it("retains exact SHA, CAS, stable identity, browser, rollback, and activation budget", () => {
    for (const gate of ['"${REVISION}" == "${GITHUB_SHA}"', "merge-base --is-ancestor", "beforeOid,afterOid,force:false", "--rollback", "--verify-active"]) expect(promotion).toContain(gate);
    for (const gate of ["verify_stable_identity", "activation_deadline=$((SECONDS+300))", "cn-release-browser-smoke.mjs", "restore_baseline"]) expect(deploy).toContain(gate);
  });
});

const fixtures: string[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true }); });

it("rejects broken preparation input and real source closure before any build", () => {
  const fixture = mkdtempSync(join(tmpdir(), "cn-input-closure-"));
  fixtures.push(fixture);
  const repository = join(fixture, "repository");
  const cache = join(fixture, "cache.git");
  const input = join(fixture, "input.json");
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { encoding: "utf8", timeout: 5_000 });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  git(["init", "-q", "-b", "main", repository]);
  git(["-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture", "--allow-empty"]);
  const sha = git(["-C", repository, "rev-parse", "HEAD"]);
  git(["clone", "-q", "--bare", repository, cache]);
  chmodSync(cache, 0o700);
  const valid = () => writeFileSync(input, JSON.stringify({ sourceRevision: sha, expiresAt: new Date(Date.now() + 60_000).toISOString() }), { mode: 0o600 });
  const begin = deploy.indexOf('if [[ "$mode" == check-prepare-inputs ]]; then');
  const end = deploy.indexOf("\npnpm()", begin);
  const block = deploy.slice(deploy.indexOf("offline_source_self_contained()"), begin) + deploy.slice(begin, end);
  expect(begin).toBeGreaterThan(0);
  const check = (owner = "root:root", cachePath = cache) => spawnSync("bash", ["-c", `set -euo pipefail
mode=check-prepare-inputs
preparation_input="$1"
SOURCE_CACHE="$2"
revision="$3"
# This adapts GNU stat for a user-owned macOS fixture. Real ownership enforcement
# remains a Linux/root acceptance requirement, not proved by this test.
stat() { if [[ "$3" == "$SOURCE_CACHE" ]]; then echo "${owner}:700"; else echo "${owner}:600"; fi; }
${block}`, "bash", input, cachePath, sha], { encoding: "utf8", timeout: 5_000 });
  expect(check().status).toBe(3); // missing input
  valid();
  expect(check().status).toBe(0);
  expect(check().stdout).toContain("CN_RELEASE_PREPARE_INPUTS_PRESENT");
  expect(check("runner:runner").status).toBe(3);
  writeFileSync(input, JSON.stringify({ sourceRevision: baseline, expiresAt: new Date(Date.now() + 60_000).toISOString() }));
  expect(check().status).toBe(3);
  writeFileSync(input, JSON.stringify({ sourceRevision: sha, expiresAt: new Date(0).toISOString() }));
  expect(check().status).toBe(3);
  writeFileSync(input, "invalid-sensitive-fixture-do-not-print");
  const malformed = check();
  expect(malformed.status).toBe(3);
  expect(malformed.stderr).not.toContain("invalid-sensitive-fixture-do-not-print");
  valid();
  // A real borrowed-object cache passes Git fsck, but is not self-contained.
  const borrowed = join(fixture, "borrowed.git");
  git(["clone", "-q", "--bare", "--shared", repository, borrowed]);
  git(["-C", borrowed, "fsck", "--full", "--no-reflogs"]);
  expect(check("root:root", borrowed).status).toBe(3);
  const info = join(cache, "objects", "info", "alternates");
  writeFileSync(info, join(repository, ".git", "objects") + "\n");
  git(["-C", cache, "fsck", "--full", "--no-reflogs"]);
  expect(check().status).toBe(3);
  rmSync(info);
  const httpAlternates = join(cache, "objects", "info", "http-alternates");
  writeFileSync(httpAlternates, "");
  expect(check().status).toBe(3);
  rmSync(httpAlternates);
  const borrowedPack = join(cache, "objects", "pack", "external.pack");
  symlinkSync(join(repository, ".git", "objects"), borrowedPack);
  expect(check().status).toBe(3);
  rmSync(borrowedPack);
  writeFileSync(join(cache, "objects", "pack", "broken.promisor"), "");
  expect(check().status).toBe(3);
  rmSync(join(cache, "objects", "pack", "broken.promisor"));
  const backup = join(fixture, "saved-input.json");
  valid();
  writeFileSync(backup, readFileSync(input));
  rmSync(input);
  symlinkSync(backup, input);
  expect(check().status).toBe(3);
});
