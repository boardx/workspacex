import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const HELPER = resolve(import.meta.dirname, "deploy-readiness.sh");
const GATE = resolve(import.meta.dirname, "deploy-gate.sh");
const DEPLOY = resolve(import.meta.dirname, "deploy.sh");
const PROVISION = resolve(import.meta.dirname, "provision.sh");
const WORKFLOW = resolve(ROOT, ".github/workflows/backend-gates.yml");
const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

function fixture(sequence: string[]) {
  const temp = mkdtempSync(join(tmpdir(), "deploy-readiness-"));
  temps.push(temp);
  const sequenceFile = join(temp, "api-sequence");
  const counterFile = join(temp, "api-count");
  const commandLog = join(temp, "commands");
  writeFileSync(sequenceFile, `${sequence.join("\n")}\n`);
  writeFileSync(counterFile, "0\n");
  writeFileSync(commandLog, "");

  const curl = join(temp, "curl");
  writeFileSync(curl, `#!/bin/sh
url=""
for arg in "$@"; do url="$arg"; done
case "$url" in
  */healthz)
    count=$(cat "${counterFile}")
    count=$((count + 1))
    printf '%s\n' "$count" > "${counterFile}"
    state=$(sed -n "\${count}p" "${sequenceFile}")
    [ -n "$state" ] || state=refuse
    case "$state" in
      trusted) printf '%s\n' '{"trustworthy":true,"rlsForced":true,"appRoleIsOwner":false}' ;;
      untrusted) printf '%s\n' '{"trustworthy":true,"rlsForced":false,"appRoleIsOwner":false}' ;;
      refuse) exit 7 ;;
    esac
    ;;
  http://127.0.0.1:3100/)
    [ "\${FAKE_WEB_MODE:-ready}" = ready ] || exit 7
    printf '%s\n' '<html>ready</html>'
    ;;
  https://*/kernel/probe/identity-session)
    [ "\${FAKE_PUBLIC_PROBE_MODE:-hidden}" = exposed ] && exit 0
    exit 7
    ;;
  *) exit 22 ;;
esac
`);
  chmodSync(curl, 0o755);

  for (const command of ["systemctl", "journalctl"]) {
    const path = join(temp, command);
    writeFileSync(path, `#!/bin/sh
printf '${command} %s\\n' "$*" >> "${commandLog}"
printf '%s\n' 'AUTHORIZATION=Bearer-leaked TOKEN=leaked PASSWORD=leaked COOKIE=leaked'
exit 1
`);
    chmodSync(path, 0o755);
  }
  const sleep = join(temp, "sleep");
  writeFileSync(sleep, "#!/bin/sh\nexit 0\n");
  chmodSync(sleep, 0o755);

  const sudo = join(temp, "sudo");
  writeFileSync(sudo, `#!/bin/sh
case "\${FAKE_ROOT_DEPLOY_MODE:-success}" in
  success) printf '%s\n' '══════ 7. 冒烟 —— trusted root deploy' ; exit 0 ;;
  smoke-failure) printf '%s\n' '══════ 7. 冒烟 —— trusted root deploy' ; exit 7 ;;
  early-failure) printf '%s\n' '══════ 6. 重启服务' ; exit 9 ;;
esac
`);
  chmodSync(sudo, 0o755);

  return { temp, counterFile, commandLog };
}

function runGate(sequence: string[], rootMode: "success" | "smoke-failure" | "early-failure") {
  const files = fixture(sequence);
  const result = spawnSync("bash", [GATE, "v-test"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${files.temp}:${process.env.PATH ?? ""}`,
      FAKE_ROOT_DEPLOY_MODE: rootMode,
      APP_API_PORT: "3200",
      APP_WEB_PORT: "3100",
      PUBLIC_DOMAIN: "example.test",
      DEPLOY_API_READINESS_ATTEMPTS: "8",
      DEPLOY_API_STABLE_SAMPLES: "3",
      DEPLOY_WEB_READINESS_ATTEMPTS: "3",
      DEPLOY_WEB_STABLE_SAMPLES: "2",
      DEPLOY_READINESS_INTERVAL_SECONDS: "0",
      DEPLOY_DIAGNOSTIC_LINES: "40",
    },
  });
  return {
    ...result,
    count: Number(readFileSync(files.counterFile, "utf8").trim()),
    commands: readFileSync(files.commandLog, "utf8").trim().split("\n").filter(Boolean),
  };
}

function run(
  sequence: string[],
  attempts = 8,
  modes: { web?: "ready" | "refuse"; publicProbe?: "hidden" | "exposed" } = {},
) {
  const files = fixture(sequence);
  const result = spawnSync("bash", ["-c", 'source "$1"; run_post_restart_smoke', "--", HELPER], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${files.temp}:${process.env.PATH ?? ""}`,
      APP_API_PORT: "3200",
      APP_WEB_PORT: "3100",
      PUBLIC_DOMAIN: "example.test",
      DEPLOY_API_READINESS_ATTEMPTS: String(attempts),
      DEPLOY_API_STABLE_SAMPLES: "3",
      DEPLOY_WEB_READINESS_ATTEMPTS: "3",
      DEPLOY_WEB_STABLE_SAMPLES: "2",
      DEPLOY_READINESS_INTERVAL_SECONDS: "0",
      DEPLOY_DIAGNOSTIC_LINES: "40",
      FAKE_WEB_MODE: modes.web ?? "ready",
      FAKE_PUBLIC_PROBE_MODE: modes.publicProbe ?? "hidden",
    },
  });
  return {
    ...result,
    count: Number(readFileSync(files.counterFile, "utf8").trim()),
    commands: readFileSync(files.commandLog, "utf8").trim().split("\n").filter(Boolean),
  };
}

describe("#448 post-restart readiness", () => {
  it("resets after success -> refusal and passes only after three trustworthy recovery samples", () => {
    const result = run(["trusted", "refuse", "trusted", "trusted", "trusted"]);
    expect(result.status).toBe(0);
    expect(result.count).toBe(5);
    expect(result.stdout).toContain("API trustworthy stable=3");
    expect(result.commands).toEqual([]);
  });

  it("does not count an HTTP 200 whose security assertions are false", () => {
    const result = run(["untrusted", "trusted", "trusted", "trusted"]);
    expect(result.status).toBe(0);
    expect(result.count).toBe(4);
    expect(result.stdout).toContain("API sample rejected");
  });

  it("fails permanently unavailable API and emits bounded, redacted diagnostics for both services", () => {
    const result = run(["refuse", "refuse", "refuse", "refuse"], 4);
    expect(result.status).not.toBe(0);
    expect(result.count).toBe(4);
    expect(result.stdout + result.stderr).toContain("API readiness timed out");
    expect(result.commands).toEqual([
      "systemctl status workspacex-api --no-pager --lines=20",
      "journalctl -u workspacex-api -n 40 --no-pager",
      "systemctl status workspacex-web --no-pager --lines=20",
      "journalctl -u workspacex-web -n 40 --no-pager",
    ]);
    expect(result.stdout + result.stderr).not.toContain("Bearer-leaked");
    expect(result.stdout + result.stderr).not.toContain("TOKEN=leaked");
    expect(result.stdout + result.stderr).toContain("<redacted>");
  });

  it("fails when Web never becomes ready and diagnoses both services", () => {
    const result = run(["trusted", "trusted", "trusted"], 3, { web: "refuse" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Web readiness timed out");
    expect(result.commands).toHaveLength(4);
  });

  it("fails when the private probe is exposed and diagnoses both services", () => {
    const result = run(["trusted", "trusted", "trusted"], 3, { publicProbe: "exposed" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("/kernel/probe/*");
    expect(result.commands).toHaveLength(4);
  });

  it("recovers only a trusted root deploy failure that reached smoke", () => {
    const result = runGate(["trusted", "refuse", "trusted", "trusted", "trusted"], "smoke-failure");
    expect(result.status).toBe(0);
    expect(result.count).toBe(5);
    expect(result.stdout).toContain("applying the stable postcondition gate");
  });

  it("preserves a trusted root deploy failure before smoke without probing healthy old services", () => {
    const result = runGate(["trusted", "trusted", "trusted"], "early-failure");
    expect(result.status).toBe(9);
    expect(result.count).toBe(0);
    expect(result.stderr).toContain("failed before post-restart smoke; refusing recovery");
    expect(result.commands).toEqual([
      "systemctl status workspacex-api --no-pager --lines=20",
      "journalctl -u workspacex-api -n 40 --no-pager",
      "systemctl status workspacex-web --no-pager --lines=20",
      "journalctl -u workspacex-web -n 40 --no-pager",
    ]);
    expect(result.stdout + result.stderr).not.toContain("Bearer-leaked");
  });

  it("CD delegates to the non-privileged stable gate and refuses pre-smoke root failures", () => {
    const gate = readFileSync(GATE, "utf8");
    const deploy = readFileSync(DEPLOY, "utf8");
    const provision = readFileSync(PROVISION, "utf8");
    const workflow = readFileSync(WORKFLOW, "utf8");
    expect(workflow).toMatch(/deploy:\n[\s\S]*actions\/checkout@v4[\s\S]*deploy-gate\.sh/);
    expect(workflow).toContain('bash .harness/scripts/vm/deploy-gate.sh "${{ github.ref_name }}"');
    expect(gate).toContain('source "$SCRIPT_DIR/deploy-readiness.sh"');
    expect(gate).toContain("root_deploy_status=${PIPESTATUS[0]}");
    expect(gate).toContain("failed before post-restart smoke; refusing recovery");
    expect(gate).toContain("run_post_restart_smoke");
    expect(deploy).toContain('source "$DEPLOY_READINESS_LIB"');
    expect(deploy).toContain("run_post_restart_smoke");
    expect(deploy).not.toContain('H=$(curl -fsS');
    expect(provision).toContain(
      'install -o root -g root -m 0644 "${APP_DIR}/.harness/scripts/vm/deploy-readiness.sh" /usr/local/lib/workspacex-deploy-readiness.sh',
    );
  });
});
