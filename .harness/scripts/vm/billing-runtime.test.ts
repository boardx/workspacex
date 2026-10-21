import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../..");

describe("trusted devapp billing configuration", () => {
  it("checks Stripe staging, retry recovery and activation compensation in CI", () => {
    const result = spawnSync(process.execPath, ["--test", "scripts/billing/prepare-runtime.test.mjs"],
      { cwd: root, encoding: "utf8", timeout: 15_000 });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(Number(result.stdout.match(/# pass (\d+)/)?.[1] ?? 0)).toBeGreaterThanOrEqual(17);
    expect(result.stdout).toContain("# fail 0");
  });

  it("validates, persists, verifies and rolls back payment-only configuration", () => {
    const result = spawnSync("python3", ["-m", "unittest", "discover", "-s", ".harness/scripts/vm/tests", "-p", "test_billing_runtime.py"],
      { cwd: root, encoding: "utf8", timeout: 15_000 });
    expect(result.stderr + result.stdout).toContain("Ran 11 tests");
    expect(result.status, result.stderr + result.stdout).toBe(0);
  });

  it("serializes manual main-only operations behind the protected environment", () => {
    const workflow = parse(readFileSync(resolve(root, ".github/workflows/devapp-configure-billing.yml"), "utf8"));
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.concurrency).toEqual({ group: "workspacex-devapp-deploy", "cancel-in-progress": false });
    const job = workflow.jobs.configure;
    expect(job.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(job.environment).toBe("devapp-trusted-scripts");
    expect(job.steps[0].with.ref).toBe("${{ github.sha }}");
    expect(job.steps[0].with["persist-credentials"]).toBe(false);
    const configuring = job.steps.find((step: { run?: string }) => step.run?.includes("--configure-billing"));
    expect(configuring.run).toContain('printf \'%s\' "$DEVAPP_BILLING_CONFIG_JSON" | sudo -n /usr/local/bin/workspacex-deploy --configure-billing');
    expect(configuring.env).toEqual({ DEVAPP_BILLING_CONFIG_JSON: "${{ secrets.DEVAPP_BILLING_CONFIG_JSON }}" });
    expect(configuring.run).not.toMatch(/sudo\s+(-E|env)/);
    expect(job.steps.at(-1).run).toContain("node scripts/billing/prepare-runtime.mjs --activate-from-env");
  });

  it("rejects a stale dispatch before inspecting installed files", () => {
    const workflow = parse(readFileSync(resolve(root, ".github/workflows/devapp-configure-billing.yml"), "utf8"));
    const verify = workflow.jobs.configure.steps.find((step: { run?: string }) => step.run?.includes("git rev-parse HEAD"));
    expect(verify.run).toContain("git ls-remote --exit-code origin refs/heads/main");
    const guard = verify.run.split("check()", 1)[0];
    for (const remote of ["current", "stale"]) {
      const result = spawnSync("bash", ["-c", `
        git() {
          if [[ "$1" == rev-parse ]]; then printf '%s\\n' current;
          elif [[ "$1" == ls-remote ]]; then printf '%s\\trefs/heads/main\\n' "$REMOTE_REVISION";
          else return 99; fi
        }
        ${guard}
      `], { encoding: "utf8", timeout: 5_000,
          env: { PATH: process.env.PATH, GITHUB_SHA: "current", REMOTE_REVISION: remote, GITHUB_TOKEN: "fixture" } });
      expect(result.status, result.stderr).toBe(remote === "current" ? 0 : 1);
    }
  });

  it("rejects extra configure arguments before consulting caller env or refs", () => {
    const result = spawnSync("bash", [resolve(import.meta.dirname, "deploy.sh"), "--configure-billing", "other"],
      { encoding: "utf8", timeout: 5_000, env: { PATH: process.env.PATH, ENV_FILE: "/does/not/exist" } });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("exactly one mode argument");
  });
});
