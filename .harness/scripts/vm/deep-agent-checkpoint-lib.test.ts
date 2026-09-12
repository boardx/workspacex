import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
const lib = resolve(import.meta.dirname, "deep-agent-lib.sh");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function fixture(existing = "") {
  const dir = mkdtempSync(join(tmpdir(), "checkpoint-lib-")); dirs.push(dir);
  const env = join(dir, "deploy.env"); writeFileSync(env, existing, { mode: 0o600 });
  const docker = join(dir, "docker");
  writeFileSync(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_DIR/argv"
if [ "$1" = inspect ]; then printf '%s\\n' "\${NETWORKS:-workspacex_default}"; exit 0; fi
cat >> "$TEST_DIR/sql"
[ "\${PG_FAIL:-0}" = 0 ] || { echo private-sql-diagnostic >&2; exit 1; }
`); chmodSync(docker, 0o755);
  const run = (extra = {}) => spawnSync("bash", ["-c", `set -euo pipefail; source '${lib}'; deep_agent_checkpoint_bootstrap '${env}' workspacex-postgres-1`], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_DIR: dir, ...extra } });
  return { dir, env, run };
}
it("bootstraps missing DSN and reuses credentials without placing them in process arguments or output", () => {
  const f = fixture("OTHER=value\n"); const first = f.run(); expect(first.status).toBe(0);
  const content = readFileSync(f.env, "utf8"); const password = /wsx_deep_agent:([0-9a-f]{64})@postgres:5432/.exec(content)?.[1];
  expect(password).toBeTruthy(); expect(content).toContain("/wsx_deep_agent");
  expect(statSync(f.env).mode & 0o777).toBe(0o600);
  expect(first.stdout).toBe("workspacex_default\n"); expect(first.stderr).toBe("");
  expect(readFileSync(join(f.dir, "argv"), "utf8")).not.toContain(password!);
  expect(readFileSync(join(f.dir, "sql"), "utf8")).toContain("NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  expect(f.run().status).toBe(0); expect(readFileSync(f.env, "utf8")).toBe(content);
});
it("preserves an existing external DSN byte-for-byte", () => {
  const existing = "DEEP_AGENT_CHECKPOINT_DB=postgresql://custom:sentinel@external/db\n";
  const f = fixture(existing); expect(f.run().status).toBe(0); expect(readFileSync(f.env, "utf8")).toBe(existing);
  expect(readFileSync(join(f.dir, "argv"), "utf8")).not.toContain("exec");
});
it("fails closed on ambiguous networks without generating credentials", () => {
  const f = fixture(); const result = f.run({ NETWORKS: "network-a\nnetwork-b" });
  expect(result.status).not.toBe(0); expect(readFileSync(f.env, "utf8")).toBe("");
});
it("retains generated credentials after a database failure for an idempotent retry and redacts diagnostics", () => {
  const f = fixture(); const failed = f.run({ PG_FAIL: "1" }); expect(failed.status).not.toBe(0);
  const saved = readFileSync(f.env, "utf8"); expect(saved).toContain("DEEP_AGENT_CHECKPOINT_DB=");
  expect(failed.stderr).not.toContain("private-sql-diagnostic"); expect(f.run().status).toBe(0);
  expect(readFileSync(f.env, "utf8")).toBe(saved);
});
