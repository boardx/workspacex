#!/usr/bin/env -S pnpm exec tsx
/** Optional AIDT local profile. No Docker, TTL fixtures, public listeners or cloud credentials. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireControl, inspectControl, requestControl, serveControl } from "./aidt-control";
import { DEFAULT_PORTS, LOCAL_ADMIN_EMAIL, resolveLocalConfig, webEnv, type LocalPorts } from "./config";
import { runDoctor } from "./doctor";
import { up, type RunningStack } from "./up";
import { nextLaunch } from "./node-launch";
import { startManaged, type Managed } from "./processes";
import { acquireWebOutputLease, checkAidtWebBuild, fingerprintAidtWebBuild, invalidateAidtWebBuild, recordAidtWebBuild } from "./aidt-web-build";

const help = `WorkspaceX AIDT Local (Node 22, pnpm 9)
  pnpm aidt:local start        Start in this terminal; keep it open. Ctrl-C stops safely.
  pnpm aidt:local build        Build this AIDT profile once, without starting the database.
  pnpm aidt:local start --web start  Run the verified build; no on-demand page compilation.
  pnpm aidt:local status       Read owner and fresh API/Web health (no changes).
  pnpm aidt:local health       Same probe; exit 0 only when API and Web respond.
  pnpm aidt:local stop         Ask the original owner to stop; retain all saved data.
  pnpm aidt:local doctor       Check hardware and installed optional capabilities.
  pnpm aidt:local credentials  Show this local account in your private terminal.
Options: --data-dir <path> (default ~/.workspacex-aidt)
         --ports api=3200,web=3100,postgres=55432,sandbox=3310,...
         --repo-root <path>
         --web dev|start (start command only; default dev)
Start uses persistent PGlite, file sessions and filesystem objects.
Default dev compiles pages on demand. Prebuilt start requires a matching successful build.
Missing local model/ASR remain unavailable. No model is downloaded automatically.
This loopback profile is for one computer; it is not a remote classroom server.`;

function parseArgs(argv: string[]): { command: string; dataDir: string; repoRoot: string; ports: Partial<LocalPorts>; webMode: "dev" | "start" } {
  const args = argv.filter(a => a !== "--");
  const command = args.shift() ?? "help";
  const flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!;
    const value = args.shift();
    if (!["--data-dir", "--repo-root", "--ports", "--web"].includes(key) || !value || value.startsWith("--") || flags.has(key)) {
      throw new Error(`Unknown, duplicate or incomplete option ${key}. Run pnpm aidt:local help.`);
    }
    flags.set(key, value);
  }
  const ports: Partial<LocalPorts> = {};
  for (const pair of (flags.get("--ports") ?? "").split(",").filter(Boolean)) {
    const [key, value, extra] = pair.split("=");
    const n = Number(value);
    if (!key || !(key in DEFAULT_PORTS) || extra !== undefined || !Number.isInteger(n) || n < 1 || n > 65535 || key in ports) {
      throw new Error(`Invalid --ports entry: ${pair}`);
    }
    (ports as Record<string, number>)[key] = n;
  }
  const assigned = Object.values({ ...DEFAULT_PORTS, ...ports });
  if (new Set(assigned).size !== assigned.length) throw new Error("Service ports must be different.");
  const webMode = flags.get("--web") ?? "dev";
  if (webMode !== "dev" && webMode !== "start") throw new Error("--web must be dev or start.");
  if (flags.has("--web") && command !== "start") throw new Error("--web only applies to start. The build command always creates a production build.");
  return {
    command, ports, webMode,
    dataDir: resolve(flags.get("--data-dir") ?? join(homedir(), ".workspacex-aidt")),
    repoRoot: resolve(flags.get("--repo-root") ?? fileURLToPath(new URL("../../..", import.meta.url))),
  };
}

async function probe(url: string, timeoutMs: number): Promise<{ url: string; ok: boolean; status?: number; error?: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await r.body?.cancel();
    return { url, ok: r.status === 200, status: r.status };
  } catch (e) { return { url, ok: false, error: e instanceof Error ? e.message : "Connection failed" }; }
}

async function start(opts: ReturnType<typeof parseArgs>): Promise<void> {
  if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error(`Use Node.js 22 (repository .nvmrc). Current version: ${process.versions.node}`);
  const doctor = runDoctor(opts);
  if (!doctor.ok) throw new Error(`Hardware check failed: ${doctor.findings.join("; ")}. Run doctor for details.`);
  // This lock precedes resolveLocalConfig/secrets, migrations, ledger reaping and child creation.
  const lease = await acquireControl(opts.dataDir);
  let outputLease: Awaited<ReturnType<typeof acquireWebOutputLease>>;
  try { outputLease = await acquireWebOutputLease(opts.repoRoot); }
  catch (e) { await lease.close(); throw e; }
  let releasePromise: Promise<void> | undefined;
  const release = (): Promise<void> => {
    releasePromise ??= (async () => { await outputLease.close(); await lease.close(); })();
    return releasePromise;
  };
  let stack: RunningStack | undefined;
  let buildProcess: Managed | undefined;
  let phase: "starting" | "building" | "running" | "stopping" | "stop-failed" = opts.command === "build" ? "building" : "starting";
  let stopError: string | undefined;
  let stopRequested = false;
  let stopPromise: Promise<void> | undefined;
  let finish!: () => void;
  const finished = new Promise<void>(done => { finish = done; });
  const stop = (): Promise<void> => {
    const firstRequest = !stopRequested;
    stopRequested = true;
    if (phase !== "stop-failed") phase = "stopping";
    // During startup up() still owns cleanup. When it resolves, call this once again.
    if (!stack && !buildProcess) {
      if (firstRequest) console.log("Stop requested during startup. Waiting for native startup to return before stopping its owned services; this can take several minutes. Saved data is retained.");
      return Promise.resolve();
    }
    stopPromise ??= (async () => {
      try {
        if (stack) await stack.stop();
        else await buildProcess!.stop();
        await release();
        console.log("AIDT stopped. Saved data retained at " + lease.dataDir);
        finish();
      } catch (e) {
        phase = "stop-failed";
        stopError = e instanceof Error ? e.message : "Native shutdown failed";
        // Keep ownership and IPC. Deleting the lock would falsely report stopped.
        throw e;
      }
    })();
    return stopPromise;
  };
  const signal = (): void => { void stop().catch(e => { console.error(e); process.exitCode = 1; }); };
  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
  try {
    await serveControl(lease, async command => {
      if (command === "stop") {
        // Reply before closing the IPC server; a second stop joins the same promise.
        setTimeout(signal, 25);
        return { phase: phase === "stop-failed" ? phase : "stopping", accepted: phase !== "stop-failed", savedDataRetained: true, ...(stopError ? { error: stopError } : {}) };
      }
      if (!stack || phase !== "running") return { phase, webMode: opts.command === "build" ? "build" : opts.webMode, healthy: false, dataDir: lease.dataDir, reason: stopError ?? "Native services are building, starting or stopping" };
      const [api, web] = await Promise.all([
        probe(`${stack.urls.api}/healthz`, 4000), probe(`${stack.urls.web}/login`, 10_000),
      ]);
      return {
        phase, webMode: opts.webMode, healthy: phase === "running" && api.ok && web.ok,
        checkedAt: new Date().toISOString(), dataDir: lease.dataDir,
        urls: { workspace: `${stack.urls.web}/aidt`, api: stack.urls.api },
        probes: { api, web }, services: stack.health(),
        capabilities: stack.capabilities, warnings: stack.warnings,
      };
    });
    const config = resolveLocalConfig({ ...opts, dataDir: lease.dataDir, profile: "aidt" });
    if (opts.command === "build") {
      invalidateAidtWebBuild(config);
      const beforeBuild = fingerprintAidtWebBuild(config);
      const launch = nextLaunch(config.repoRoot, ["build"]);
      buildProcess = startManaged({
        name: "aidt-web-build", command: launch.command, args: launch.args,
        cwd: join(config.repoRoot, "apps", "web"),
        env: { ...webEnv(config), ...launch.env, NODE_ENV: "production", WORKSPACEX_RELEASE_BUILD: "1" },
        logDir: join(config.dataDir, "logs"),
      });
      const code = await buildProcess.exited;
      if (stopRequested) { await stop(); return; }
      if (code !== 0) throw new Error(`AIDT Web build failed (${code ?? "signal/spawn error"}); no successful build receipt was saved.\n${buildProcess.recentOutput()}`);
      await recordAidtWebBuild(config, beforeBuild);
      if (stopRequested) { invalidateAidtWebBuild(config); await stop(); return; }
      await release();
      console.log("AIDT build verified. Run pnpm aidt:local start --web start with the same API port to use it.");
      return;
    }
    if (opts.webMode === "start") {
      const build = checkAidtWebBuild(config);
      if (!build.usable) throw new Error(build.reason ?? "AIDT prebuilt Web is not ready. Run pnpm aidt:local build first.");
    }
    stack = await up({ config, webMode: opts.webMode, pullModel: false, allowAlternateOllamaRestart: false });
    if (stopRequested) await stop();
    else {
      phase = "running";
      console.log(`\nAIDT ready: ${stack.urls.web}/aidt`);
      console.log(`Local account: ${stack.login.email}. Get its password using pnpm aidt:local credentials with the same --data-dir.`);
      console.log(`Data: ${lease.dataDir}\nKeep this terminal open. In another terminal: pnpm aidt:local health / stop (same --data-dir).`);
      for (const warning of stack.warnings) console.log(`Capability: ${warning}`);
    }
    await finished;
  } catch (e) {
    if (stack || (buildProcess && buildProcess.child.exitCode === null && buildProcess.child.signalCode === null)) await stop();
    else await release();
    throw e;
  } finally {
    process.removeListener("SIGINT", signal);
    process.removeListener("SIGTERM", signal);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === "help") { console.log(help); return; }
  if (opts.command === "start" || opts.command === "build") { await start(opts); return; }
  if (opts.command === "doctor") {
    const report = runDoctor(opts);
    const nodeSupported = Number(process.versions.node.split(".")[0]) === 22;
    console.log(JSON.stringify({ ...report, ok: report.ok && nodeSupported, nodeVersion: process.versions.node, nodeSupported }, null, 2));
    process.exitCode = report.ok && nodeSupported ? 0 : 1;
    return;
  }
  if (opts.command === "credentials") {
    // Explicit private-terminal action, never included in status/health or run metadata.
    const secrets = JSON.parse(readFileSync(join(opts.dataDir, "secrets.json"), "utf8")) as { adminPassword?: string };
    if (!secrets.adminPassword) throw new Error("No local account yet. Start AIDT first.");
    console.log(`Local login: ${LOCAL_ADMIN_EMAIL}\nPassword: ${secrets.adminPassword}\nKeep this information private.`);
    return;
  }
  if (opts.command === "status" || opts.command === "health") {
    const report = await inspectControl(opts.dataDir);
    console.log(JSON.stringify(report, null, 2));
    const healthy = report.state === "responding" && (report.details as { healthy?: boolean })?.healthy === true;
    process.exitCode = opts.command === "health" ? (healthy ? 0 : 1) : (report.state === "unreachable" ? 1 : 0);
    return;
  }
  if (opts.command === "stop") {
    const initial = await inspectControl(opts.dataDir);
    if (initial.state === "stopped") { console.log("AIDT is already stopped. Saved data retained."); return; }
    if (initial.state !== "responding") throw new Error("Owner unreachable; no process was stopped or data removed. Inspect the original start terminal.");
    const receipt = await requestControl(opts.dataDir, "stop") as { accepted?: boolean; error?: string };
    if (!receipt.accepted) throw new Error(receipt.error ?? "Native shutdown was not accepted; owner retained.");
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 250));
      const result = await inspectControl(opts.dataDir);
      if (result.state === "stopped") { console.log("AIDT stopped. Saved data retained."); return; }
      if ((result.details as { phase?: string })?.phase === "stop-failed") throw new Error("Native shutdown failed; owner retained. Inspect the original start terminal.");
    }
    throw new Error("Stop is not confirmed. Inspect the original start terminal; data was retained.");
  }
  throw new Error(`Unknown command ${opts.command}.\n${help}`);
}

void main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
