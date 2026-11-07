import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("executes protected multi-Compose identity and rollback protocol counterexamples", () => {
  const result = spawnSync("python3", ["-B", "-m", "unittest", "discover", "-s", ".harness/scripts/vm", "-p", "test_cn_compose_baseline.py", "-v"], { encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it("uses one byte-identical baseline producer for deployment and promotion and fails closed on ingress restore", () => {
  const read=(name:string)=>readFileSync(new URL(name,import.meta.url),"utf8");
  for (const name of ["deploy-cn-production.sh", "verify-cn-release-promotion.sh"]) {
    const source=read(name),capture=source.slice(source.indexOf("capture_baseline() {"));
    expect(capture.split("\n}")[0]).toContain('cn_compose_baseline.py capture "$1"');
    expect(capture.split("\n}")[0]).not.toContain("schemaVersion:1");
  }
  const deploy=read("deploy-cn-production.sh"),restore=deploy.slice(deploy.indexOf("restore_baseline() {"),deploy.indexOf("enable_run_drain() {"));
  expect(restore).toContain('nginx -t && systemctl reload nginx || fail "baseline nginx restore failed"');
  expect(restore.indexOf('|| fail "baseline nginx restore failed"')).toBeLessThan(restore.indexOf("candidate_config_action restore"));
});
