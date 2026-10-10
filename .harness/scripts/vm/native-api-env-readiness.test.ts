import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const lib = resolve(import.meta.dirname, "deep-agent-lib.sh");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const socket = "/run/workspacex-native/skill-sandbox.sock";
const binding = "a".repeat(64);
const secret = "b".repeat(64);
const valid = `NATIVE_SESSION_SOCKET=${socket}\0NATIVE_SESSION_BINDING_KEY=${binding}\0DEEP_AGENT_SERVICE_INTERNAL_KEY=${secret}\0KERNEL_NATIVE_RUNTIME=0\0`;

function probe(pids: number[], envs: Record<number, string>, sleep = ":", attempts = 5, seconds = 30, queryDelay = 0) {
  const dir = mkdtempSync(join(tmpdir(), "native-env-ready-")); dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "pids"), pids.join("\n") + "\n");
  writeFileSync(join(dir, "counter"), "0");
  writeFileSync(join(dir, "dispatches"), "0\n");
  writeFileSync(join(dir, "valid"), valid);
  for (const [pid, value] of Object.entries(envs)) {
    mkdirSync(join(dir, pid)); writeFileSync(join(dir, pid, "environ"), value);
  }
  // GNU timeout exists on the Linux deploy host; this portable equivalent keeps the
  // subprocess budget real when running the shell tests on macOS.
  const timeout = join(dir, "bin/timeout");
  writeFileSync(timeout, `#!/usr/bin/env python3\nimport os, signal, subprocess, sys\np = subprocess.Popen(sys.argv[3:], start_new_session=True)\ntry:\n    sys.exit(p.wait(timeout=float(sys.argv[2])))\nexcept subprocess.TimeoutExpired:\n    os.killpg(p.pid, signal.SIGKILL)\n    p.wait()\n    sys.exit(124)\n`);
  chmodSync(timeout, 0o755);
  const systemctl = join(dir, "bin/systemctl");
  writeFileSync(systemctl, `#!/usr/bin/env bash\nn=$(cat '${dir}/counter'); n=$((n+1)); echo "$n" > '${dir}/counter'\nsleep ${queryDelay}\nprintf done > '${dir}/query-completed'\nsed -n "\${n}p" '${dir}/pids'\n`);
  chmodSync(systemctl, 0o755);
  const result = spawnSync("bash", ["-c", `set -euo pipefail\nsource '${lib}'\nnative_runtime_api_process_env_file() { printf '%s/%s/environ' '${dir}' "$1"; }\nsleep() { ${sleep.replaceAll("DIR", dir)}; }\ntimeout() { local n; read -r n < '${dir}/dispatches'; printf '%s\\n' "$((n+1))" > '${dir}/dispatches'; printf '%s\\n' "$*" >> '${dir}/query-args'; command timeout "$@"; }\nSECONDS=0\nnative_runtime_wait_for_api_env workspacex-api '${socket}' 0\n`], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, DEPLOY_NATIVE_ENV_READINESS_ATTEMPTS: String(attempts), DEPLOY_NATIVE_ENV_READINESS_TIMEOUT_SECONDS: String(seconds), DEPLOY_NATIVE_ENV_STABLE_SAMPLES: "2", DEPLOY_READINESS_INTERVAL_SECONDS: "0" },
  });
  return { ...result, calls: Number(readFileSync(join(dir, "dispatches"), "utf8")), queryCompleted: existsSync(join(dir, "query-completed")), queryArgs: existsSync(join(dir, "query-args")) ? readFileSync(join(dir, "query-args"), "utf8").trim().split("\n") : [] };
}

describe("native API process environment readiness", () => {
  it("waits through the pre-exec environment and requires consecutive valid process samples", () => {
    const result = probe([10, 10, 10, 10, 10], { 10: "PATH=/usr/bin\0" }, "cp 'DIR/valid' 'DIR/10/environ'");
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toBe(5);
    expect(result.stdout).toContain("stable=2/2");
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(`${result.stdout}${result.stderr}`).not.toContain(binding);
  });
  it("rejects persistent wrong admission and missing binding values at the bounded deadline", () => {
    for (const env of [valid.replace("KERNEL_NATIVE_RUNTIME=0", "KERNEL_NATIVE_RUNTIME=1"), `NATIVE_SESSION_SOCKET=${socket}\0KERNEL_NATIVE_RUNTIME=0\0`]) {
      const result = probe([10, 10, 10], { 10: env }, ":", 3);
      expect(result.status).toBe(1);
      expect(result.calls).toBe(3);
      expect(result.stderr).toContain("native API process env readiness timed out");
      expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    }
  });
  it("reacquires MainPID and resets stability when the process changes", () => {
    const result = probe([10, 10, 11, 11, 11, 11], { 10: valid, 11: valid });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toBe(6);
    expect(result.stdout.match(/stable=1\/2/g)).toHaveLength(2);
  });
  it("rejects a process replacement during its environment read", () => {
    const result = probe([10, 11, 11, 11, 11, 11], { 10: valid, 11: valid });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toBe(6);
  });
  it("never accepts a missing PID or unreadable process environment", () => {
    for (const pids of [[0, 0, 0], [99, 99, 99]]) {
      const result = probe(pids, {}, ":", 3);
      expect(result.status).toBe(1);
      expect(result.calls).toBe(3);
    }
  });
  it("stops at the elapsed-time deadline even with sampling attempts remaining", () => {
    const result = probe([0, 0, 0, 0, 0], {}, "SECONDS=$((SECONDS+2))", 5, 2);
    expect(result.status).toBe(1);
    expect(result.calls).toBe(1);
  });
  it("bounds a stalled MainPID query by the remaining deadline", () => {
    const started = Date.now();
    const result = probe([10, 10], { 10: valid }, ":", 5, 1, 3);
    expect(result.status, result.stderr).toBe(1);
    expect(result.calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(result.queryCompleted).toBe(false);
    expect(result.queryArgs).toEqual(["--signal=KILL 1 systemctl show --property MainPID --value workspacex-api"]);
  });
  it("never dispatches a zero-duration query when the clock crosses the deadline", () => {
    const dir = mkdtempSync(join(tmpdir(), "native-env-boundary-")); dirs.push(dir);
    const calls = join(dir, "timeout-calls");
    const result = spawnSync("bash", ["-c", `set -euo pipefail
source '${lib}'
unset SECONDS
SECONDS=0
timeout() { printf '%s\\n' "$*" >> '${calls}'; return 124; }
set -T
trap 'case "$BASH_COMMAND" in remaining=*) SECONDS=$deadline ;; esac' DEBUG
native_runtime_wait_for_api_env workspacex-api '${socket}' 0
`], {
      encoding: "utf8", timeout: 2500,
      env: { ...process.env, DEPLOY_NATIVE_ENV_READINESS_ATTEMPTS: "5", DEPLOY_NATIVE_ENV_READINESS_TIMEOUT_SECONDS: "1", DEPLOY_NATIVE_ENV_STABLE_SAMPLES: "2", DEPLOY_READINESS_INTERVAL_SECONDS: "0" },
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("native API process env readiness timed out");
    expect(() => readFileSync(calls, "utf8")).toThrow();
  });
  it("the deployed path waits before authenticated callbacks without changing recovery authorization", () => {
    const deploy = readFileSync(resolve(import.meta.dirname, "deploy.sh"), "utf8");
    expect(deploy).toContain('native_runtime_wait_for_api_env workspacex-api');
    expect(deploy.indexOf("native_runtime_wait_for_api_env workspacex-api")).toBeLessThan(deploy.indexOf("native_runtime_assert_deep_agent_api_callback workspacex-deep-agent"));
    const gate = readFileSync(resolve(import.meta.dirname, "deploy-gate.sh"), "utf8");
    expect(gate).toContain("stage=smoke");
  });
});
