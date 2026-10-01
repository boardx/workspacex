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
  ])("%s keeps ownership during cleanup and releases only after successful teardown", async (_label, options, expected) => {
    const result = await run(options);
    expect(result.code, result.stderr).toBe(expected);
    expect(result.duringCleanup).toHaveLength(Object.keys(PORT_BASE).length);
    if (!("signal" in options) && !("missingCommand" in options)) {
      expect(result.duringChild).toEqual(result.duringCleanup);
    }
    if ("cleanupExit" in options && options.cleanupExit !== 0) {
      expect(result.remaining).toEqual(result.duringCleanup);
    } else {
      expect(result.remaining).toEqual([]);
    }
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

it("#3128 SIGKILL of the wrapper cannot surrender an alive child's unbound startup port", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orphan-startup-lease-"));
  const leaseDir = join(temp, "leases"), ready = join(temp, "ready.json");
  const go = join(temp, "go"), bound = join(temp, "bound"), stop = join(temp, "stop"), done = join(temp, "done");
  const docker = join(temp, "docker");
  writeFileSync(docker, "#!/bin/sh\nexit 0\n"); chmodSync(docker, 0o755);
  const script = `const fs=require('node:fs'),net=require('node:net');const paths=${JSON.stringify({ready,go,bound,stop,done})};let server;fs.writeFileSync(paths.ready,JSON.stringify({pid:process.pid,port:Number(process.env.WORKSPACEX_API_PORT)}));const timer=setInterval(()=>{if(fs.existsSync(paths.stop)){clearInterval(timer);const finish=()=>{fs.writeFileSync(paths.done,'done');process.exit(0)};if(server)server.close(finish);else finish();return;}if(!server&&fs.existsSync(paths.go)){server=net.createServer();server.listen(Number(process.env.WORKSPACEX_API_PORT),'127.0.0.1',()=>fs.writeFileSync(paths.bound,'bound'));}},20);`;
  const wrapper = spawn(process.execPath, ["--import", "tsx", ".harness/scripts/fixtures/with-test-isolation-fixture.ts", "--", process.execPath, "-e", script], {
    cwd: ROOT, env: { ...process.env, WORKSPACEX_ISOLATION_ID: undefined, WORKSPACEX_ISOLATION_SEED: temp,
      WORKSPACEX_VERIFY_OUTER_DB: undefined, WORKSPACEX_VERIFY_OUTER_COMPOSE: undefined,
      WORKSPACEX_TEST_PORT_LEASE_DIR: leaseDir, PATH: `${temp}:${process.env.PATH ?? ""}` },
    stdio: "ignore",
  });
  async function until(predicate: () => boolean) {
    const end = Date.now() + 10_000;
    while (!predicate() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(predicate()).toBe(true);
  }
  async function claim(port: number): Promise<boolean> {
    const probe = spawn(process.execPath, ["--import", "tsx", ".harness/scripts/fixtures/test-port-lease-fixture.ts", leaseDir, String(port)], {
      cwd: ROOT, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const closed = new Promise<void>((resolve) => probe.once("close", () => resolve()));
    try {
      const held = await new Promise<boolean>((resolve, reject) => {
        probe.once("message", (m) => resolve((m as { held: boolean }).held));
        probe.once("error", reject);
        probe.once("exit", () => reject(new Error("probe exited before reporting ownership")));
      });
      if (held) probe.send("release");
      await closed;
      return held;
    } finally { probe.kill(); }
  }
  try {
    await until(() => existsSync(ready));
    const child = JSON.parse(readFileSync(ready, "utf8")) as { pid: number; port: number };
    expect(child.pid).not.toBe(wrapper.pid);
    expect(existsSync(bound)).toBe(false); // An actual command is alive, but has not bound yet.
    const exited = new Promise<void>((resolve) => wrapper.once("exit", () => resolve()));
    wrapper.kill("SIGKILL");
    await exited;
    expect(await claim(child.port), "orphan-startup port must remain leased to the alive child").toBe(false);
    writeFileSync(go, "go");
    await until(() => existsSync(bound));
    expect(await claim(child.port)).toBe(false);
    writeFileSync(stop, "stop");
    await until(() => existsSync(done));
    // Death alone never proves all descendants are gone: keep the quarantine.
    await until(() => !existsSync(`/proc/${child.pid}/stat`) || /\) Z /.test(readFileSync(`/proc/${child.pid}/stat`, "utf8")));
    expect(await claim(child.port)).toBe(false);
    // Simulate explicit recovery of this test's own exact port only, after its
    // known child exited and a real bind proves there is no listener.
    const listener = (await import("node:net")).createServer();
    await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(child.port, "127.0.0.1", resolve); });
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    rmSync(join(leaseDir, String(child.port)), { recursive: true });
    expect(await claim(child.port)).toBe(true);
  } finally {
    writeFileSync(stop, "stop");
    wrapper.kill("SIGKILL");
    if (existsSync(ready)) await until(() => existsSync(done));
    rmSync(temp, { recursive: true, force: true });
  }
});
