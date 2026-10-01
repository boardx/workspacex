import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PORT_BASE } from "./lib/test-isolation";

const ROOT = resolve(import.meta.dirname, "../..");

async function run(options: {
  childExit?: number; cleanupExit?: number; signal?: "SIGTERM" | "SIGINT";
  missingCommand?: boolean; mismatch?: boolean; admissionError?: boolean; verifyError?: boolean; hardExit?: boolean;
}) {
  const temp = mkdtempSync(join(tmpdir(), "wrapper-port-lease-"));
  const leaseDir = join(temp, "leases");
  const cleanupSnapshot = join(temp, "cleanup.json");
  const childSnapshot = join(temp, "child.json");
  const docker = join(temp, "docker");
  writeFileSync(docker, `#!/bin/sh\n"${process.execPath}" -e 'require("node:fs").writeFileSync(${JSON.stringify(cleanupSnapshot)},JSON.stringify(require("node:fs").readdirSync(${JSON.stringify(leaseDir)})))'\nexit ${options.cleanupExit ?? 0}\n`);
  chmodSync(docker, 0o755);
  const childScript = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(childSnapshot)},JSON.stringify(fs.readdirSync(process.env.WORKSPACEX_TEST_PORT_LEASE_DIR)));` +
    (options.signal ? "setInterval(()=>{},1000)" : `process.exit(${options.childExit ?? 0})`);
  const args = options.hardExit
    ? ["--import", "tsx", "--input-type=module", "-e",
      "import {ensureReservedTestIsolation} from './.harness/scripts/lib/test-isolation.ts';const reservation=await ensureReservedTestIsolation(process.env);await reservation.release();process.exit(1)"]
    : options.verifyError
    ? ["--import", "tsx", "--input-type=module", "-e",
      "import {verify} from './.harness/scripts/verify.ts';verify({_:[],opts:{},flags:{}}).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)})"]
    : options.admissionError
    ? ["--import", "tsx", "--input-type=module", "-e",
      "import {runWithTestIsolation} from './.harness/scripts/with-test-isolation.ts';runWithTestIsolation(['--','true'],{acquireSlot:async()=>{throw new Error('admission fixture failure')}}).then(c=>process.exit(c),e=>{console.error(e.message);process.exit(1)})"]
    : ["--import", "tsx", ".harness/scripts/fixtures/with-test-isolation-fixture.ts", "--",
      ...(options.missingCommand ? [join(temp, "missing-command")] : [process.execPath, "-e", childScript])];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      // Force a genuinely owning wrapper even when the suite inherits a scope.
      WORKSPACEX_ISOLATION_ID: undefined,
      WORKSPACEX_ISOLATION_SEED: temp,
      WORKSPACEX_TEST_PORT_LEASE_DIR: leaseDir,
      WORKSPACEX_VERIFY_OUTER_DB: options.mismatch ? "wrong-db" : undefined,
      WORKSPACEX_VERIFY_OUTER_COMPOSE: options.mismatch ? "wrong-compose" : undefined,
      WORKSPACEX_KEEP_TEST_STACK: undefined,
      PATH: `${temp}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", signalled = false;
  child.stdout!.on("data", (chunk) => {
    stdout += String(chunk);
    if (options.signal && !signalled && stdout.includes("[test-isolation]")) {
      signalled = true;
      child.kill(options.signal);
    }
  });
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  try {
    const code = await new Promise<number | null>((resolveClose, reject) => {
      child.once("error", reject);
      child.once("close", resolveClose);
    });
    return { code, stderr,
      duringCleanup: existsSync(cleanupSnapshot) ? JSON.parse(readFileSync(cleanupSnapshot, "utf8")) as string[] : null,
      duringChild: existsSync(childSnapshot) ? JSON.parse(readFileSync(childSnapshot, "utf8")) as string[] : null,
      remaining: existsSync(leaseDir) ? readdirSync(leaseDir) : [],
      leaseDirExists: existsSync(leaseDir),
    };
  } finally {
    child.kill("SIGKILL");
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("#3128 wrapper owns port leases through teardown", () => {
  it.each([
    ["success", { childExit: 0 }, 0],
    ["assertion failure", { childExit: 7 }, 7],
    ["cleanup failure", { childExit: 0, cleanupExit: 42 }, 1],
    ["assertion and cleanup failure", { childExit: 7, cleanupExit: 42 }, 7],
    ["SIGTERM", { signal: "SIGTERM" as const }, 143],
    ["SIGINT", { signal: "SIGINT" as const }, 130],
    ["spawn failure", { missingCommand: true }, 1],
  ])("%s keeps ownership during cleanup then releases all leases", async (_label, options, expected) => {
    const result = await run(options);
    expect(result.code, result.stderr).toBe(expected);
    expect(result.duringCleanup).toHaveLength(Object.keys(PORT_BASE).length);
    if (!("signal" in options) && !("missingCommand" in options)) {
      expect(result.duringChild).toEqual(result.duringCleanup);
    }
    expect(result.remaining).toEqual([]);
  });

  it.each([
    ["outer scope mismatch", { mismatch: true }, 2],
    ["admission failure", { admissionError: true }, 1],
    ["harness verify setup failure", { verifyError: true }, 1],
    ["explicit process.exit without async finally", { hardExit: true }, 1],
  ])("%s releases leases without starting a child or Docker cleanup", async (_label, options, expected) => {
    const result = await run(options);
    expect(result.code, result.stderr).toBe(expected);
    expect(result.duringChild).toBeNull();
    expect(result.duringCleanup).toBeNull();
    expect(result.leaseDirExists).toBe(true);
    expect(result.remaining).toEqual([]);
  });
});
