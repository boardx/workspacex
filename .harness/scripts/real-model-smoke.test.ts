import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

// Exercise the real shell orchestration with local process doubles. These tests
// prove exit-code handling; they do not count as real model or browser evidence.
function probe(options: { unsetLog?: boolean; stackFails?: boolean; specExit?: number }) {
  const dir = mkdtempSync(join(tmpdir(), "wx-real-model-exit-"));
  try {
    const scripts = join(dir, "scripts");
    const bin = join(dir, "bin");
    mkdirSync(scripts);
    mkdirSync(bin);
    copyFileSync(join(root, "scripts/real-model-env.sh"), join(scripts, "real-model-env.sh"));
    let script = readFileSync(join(root, "scripts/real-model-smoke.sh"), "utf8");
    // Cleanup must never touch another running stack's global pid files.
    script = script.replace("/tmp/e2e-api.pid /tmp/e2e-sandbox.pid /tmp/e2e-deep-agent.pid",
      `${dir}/api.pid ${dir}/sandbox.pid ${dir}/deep-agent.pid`);
    // Force the expansion failure reported in #4886 at the original startup
    // boundary. Bash can supply a zero status to EXIT for this class of error.
    if (options.unsetLog) script = script.replace(/^STACK_LOG=.*\n/m, "unset STACK_LOG\n");
    writeFileSync(join(scripts, "real-model-smoke.sh"), script);
    writeFileSync(join(dir, "e2e-up.sh"), options.stackFails
      ? "#!/bin/bash\nexit 37\n"
      : "#!/bin/bash\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done\n");
    for (const [name, body] of Object.entries({
      curl: `exit ${options.stackFails ? 1 : 0}`,
      docker: "exit 0",
      pnpm: 'case "$*" in *:raw) printf "%s\\n" "$*" >> "$PROBE_SPEC_CALLS"; exit "$PROBE_SPEC_EXIT";; esac\nexit 0',
    })) {
      const path = join(bin, name);
      writeFileSync(path, `#!/bin/bash\n${body}\n`);
      chmodSync(path, 0o755);
    }
    const callsFile = join(dir, "spec-calls");
    const run = spawnSync("bash", [join(scripts, "real-model-smoke.sh")], {
      encoding: "utf8", timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        WORKSPACEX_ENV_FILE: join(dir, "missing.env"),
        REAL_MODEL_E2E_EVIDENCE_DIR: join(dir, "evidence"),
        COMPOSE_PROJECT_NAME: "wx-real-model-exit-probe",
        WORKSPACEX_API_PORT: "32001", WORKSPACEX_WEB_PORT: "32002",
        WORKSPACEX_DB: "wx_real_model_exit_probe", SKILL_SANDBOX_PORT: "32003",
        DASHSCOPE_API_KEY: "probe-not-a-secret", DASHSCOPE_BASE_URL: "http://127.0.0.1:32004",
        DASHSCOPE_MODEL: "exit-code-probe", PROBE_SPEC_CALLS: callsFile,
        PROBE_SPEC_EXIT: String(options.specExit ?? 0),
      },
    });
    let specCalls = "";
    try { specCalls = readFileSync(callsFile, "utf8"); } catch { /* Startup failed before the spec. */ }
    return { ...run, specCalls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("real-model-smoke exit status (#4886)", () => {
  it("fails on an unbound startup variable even when EXIT sees status zero", () => {
    const run = probe({ unsetLog: true });
    expect(run.error).toBeUndefined();
    expect(run.stderr).toContain("STACK_LOG: unbound variable");
    expect(run.status).toBe(1);
    expect(run.specCalls).toBe("");
  });

  it("fails when the stack exits before readiness, without running a spec", () => {
    const run = probe({ stackFails: true });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(1);
    expect(run.specCalls).toBe("");
  });

  it.each([0, 41])("preserves the completed spec exit code %i", (specExit) => {
    const run = probe({ specExit });
    expect(run.error).toBeUndefined();
    expect(run.specCalls.trim()).toBe("run e2e:real-model-smoke:raw");
    expect(run.status).toBe(specExit);
  });
});
