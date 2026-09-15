import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const candidate = readFileSync(resolve(import.meta.dirname, "build-cn-release-candidate.sh"), "utf8");
const restore = candidate.match(/^restore_checkout\(\)\{[\s\S]*?^\}/m)?.[0];
if (!restore) throw new Error("candidate checkout restore function is missing");
const roots: string[] = [];
function git(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
}
function repository() {
  const directory = mkdtempSync(join(tmpdir(), "cn-candidate-checkout-"));
  roots.push(directory);
  git(directory, "init", "-q");
  git(directory, "config", "user.name", "CN test");
  git(directory, "config", "user.email", "cn-test@example.invalid");
  writeFileSync(join(directory, "file.txt"), "baseline\n");
  git(directory, "add", ".");
  git(directory, "commit", "-qm", "baseline");
  const baseline = git(directory, "rev-parse", "HEAD");
  git(directory, "branch", "-M", "main-cn");
  writeFileSync(join(directory, "file.txt"), "candidate\n");
  git(directory, "commit", "-qam", "candidate");
  const next = git(directory, "rev-parse", "HEAD");
  git(directory, "reset", "--hard", baseline);
  return { directory, baseline, next };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each(["branch", "detached"])("restores original %s checkout after an injected publisher failure", kind => {
  const { directory, baseline, next } = repository();
  if (kind === "detached") git(directory, "checkout", "-q", "--detach", baseline);
  const originalRef = kind === "branch" ? "refs/heads/main-cn" : "";
  const script = `set -euo pipefail\nREPOSITORY_DIR=$1\nbaseline_head=$(git -C "$REPOSITORY_DIR" rev-parse HEAD)\nbaseline_ref=$(git -C "$REPOSITORY_DIR" symbolic-ref -q HEAD || true)\n${restore}\ntrap 'status=$?; restore_checkout || status=99; exit "$status"' EXIT\ngit -C "$REPOSITORY_DIR" checkout -q --detach $2\nexit 23\n`;
  const result = spawnSync("bash", ["-c", script, "bash", directory, next], { encoding: "utf8" });
  expect(result.status).toBe(23);
  expect(git(directory, "rev-parse", "HEAD")).toBe(baseline);
  const ref = spawnSync("git", ["-C", directory, "symbolic-ref", "-q", "HEAD"], { encoding: "utf8" });
  expect(ref.stdout.trim()).toBe(originalRef);
  expect(git(directory, "status", "--porcelain")).toBe("");
});
