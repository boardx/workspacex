import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const dir = resolve(import.meta.dirname);
const deploy = readFileSync(join(dir, "deploy.sh"), "utf8");
const preflight = deploy.slice(deploy.indexOf("DEEP_AGENT_CONTAINER_PORT="), deploy.indexOf("\ndocker rm -f workspacex-deep-agent"));
const temps: string[] = [];
afterEach(() => temps.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function run(fail = false, ports = '{"8000/tcp":{}}') {
  const path = mkdtempSync(join(tmpdir(), "checkpoint-preflight-")); temps.push(path);
  writeFileSync(join(path, "docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1" = image ]; then printf '%s\\n' "$PORTS"; exit 0; fi
if [ "$1" = run ]; then [ "$FAIL" = 0 ]; exit $?; fi
exit 0
`);
  writeFileSync(join(path, "timeout"), '#!/bin/sh\nshift\nexec "$@"\n');
  chmodSync(join(path, "docker"), 0o755); chmodSync(join(path, "timeout"), 0o755);
  const result = spawnSync("bash", ["-c", `set -euo pipefail\n${preflight}\nprintf '%s' "$DEEP_AGENT_CONTAINER_PORT"`], {
    encoding: "utf8", env: { ...process.env, PATH: `${path}:${process.env.PATH}`, CALLS: join(path, "calls"), PORTS: ports, FAIL: fail ? "1" : "0", DEEP_AGENT_IMAGE: "reviewed-image", DEEP_AGENT_SHA: "123", DEEP_AGENT_NETWORK: "isolated-network", DEEP_AGENT_ENV_FILE: join(path, "private.env") },
  });
  return { ...result, calls: readFileSync(join(path, "calls"), "utf8") };
}
it("derives the image port and initializes durable storage on the same private network", () => {
  const result = run(); expect(result.status).toBe(0); expect(result.stdout).toBe("8000");
  expect(result.calls).toContain("--network isolated-network --env-file");
  expect(result.calls).toContain("--add-host workspacex-api-host:host-gateway");
  expect(result.calls).toContain("PostgresLedger");
  expect(result.calls).toContain("probe_checkpoint");
  expect(result.calls).toContain("probe_checkpoint_isolation");
  expect(result.calls).toContain("probe_restricted_runtime");
  expect(result.calls).not.toContain("rm -f workspacex-deep-agent");
});
it("database readiness failure cleans only its probe and retains the old service", () => {
  const result = run(true); expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("previous service retained");
  expect(result.calls).toContain("rm -f workspacex-checkpoint-probe-123");
  expect(result.calls).not.toContain("rm -f workspacex-deep-agent");
});
it("rejects ambiguous exposed ports before starting a database probe", () => {
  const result = run(false, '{"8000/tcp":{},"2024/tcp":{}}');
  expect(result.status).not.toBe(0); expect(result.calls).not.toContain("run --rm");
});
it("wires the reviewed bootstrap before env projection and uses the derived port/network", () => {
  expect(deploy.indexOf("deep_agent_checkpoint_bootstrap")).toBeLessThan(deploy.indexOf("deep_agent_project_capability_env \"$ENV_FILE\""));
  expect(deploy).toContain('${DEEP_AGENT_HOST_PORT}:${DEEP_AGENT_CONTAINER_PORT}');
  expect(deploy).toContain('--network "$DEEP_AGENT_NETWORK"');
  const dockerfile = readFileSync(resolve(dir, "../../../apps/deep-agent-service/Dockerfile"), "utf8");
  const port = /EXPOSE (\d+)/.exec(dockerfile)![1];
  expect(dockerfile).toContain(`"--port", "${port}"`);
});
