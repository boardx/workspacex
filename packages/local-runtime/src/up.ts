/**
 * `up`: the whole local stack on one machine, in dependency order.
 *
 *   PGlite(owner) → migrate + seed → PGlite(app_rw)
 *   → Ollama (if present) → skill sandbox → API → deep-agent (if venv) → Web
 *
 * Each step's readiness is checked before the next starts; a failure stops everything that
 * was started. Missing optional pieces (Ollama, Python venv) are reported loudly but do not
 * abort -- the UI/API surface their own "not configured" states for those capabilities.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, totalmem } from "node:os";
import {
  apiEnv, asrEnv, asrGatewayEnv, deepAgentEnv, ollamaEnv, paths, resolveAsrModelDir, sandboxEnv, sandboxModulesDir, webEnv, DB_APP_ROLE, DB_OWNER_ROLE, type LocalConfig,
  resolveDeepAgentLaunch, preferredChatModel } from "./config";
import { findOllama } from "./doctor";
import { importModels } from "./model-bundle";
import { chooseOllama, ollamaBinaryVersion, runningOllamaVersion } from "./ollama-version";
import { ensureDatabaseExists, startPgliteServer, type PgliteHandle } from "./pglite-server";
import { assertPortFree, stopListenerOnPort, killTree, startManaged, waitForHttp, waitForManaged, runToCompletion, type Managed } from "./processes";
import { runMigrations, runOwnerSeeds, readSeedState } from "./seeds";

export interface UpOptions {
  readonly config: LocalConfig;
  readonly log?: (line: string) => void;
  /** `dev` = `next dev` (no build step, slow first paint); `start` = `next start` on a prior `next build`. */
  readonly webMode?: "dev" | "start" | "none";
  readonly bundleBinDir?: string;
  /** Relocatable Python runtime shipped in the bundle (scripts/local-bundle/bundle-python.sh); preferred over apps/deep-agent-service/.venv. */
  readonly bundlePythonDir?: string;
  /** Ollama models shipped in the bundle (scripts/local-bundle/fetch-models.sh); imported into the store the running Ollama uses. */
  readonly bundleModelsDir?: string;
  /** Streaming ASR model shipped in the bundle (scripts/local-bundle/bundle-asr-model.sh); used in place when the data dir has none. */
  readonly bundleAsrModelsDir?: string;
  /** Skip pulling the model even if Ollama is up (tests, offline). */
  readonly pullModel?: boolean;
}

export interface RunningStack {
  readonly urls: { web: string; api: string; ollama: string | null; deepAgent: string | null; asr: string | null };
  readonly login: { email: string; password: string };
  readonly warnings: readonly string[];
  stop(): Promise<void>;
}

export async function up(opts: UpOptions): Promise<RunningStack> {
  let c = opts.config;
  const log = opts.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warnings: string[] = [];
  const managed: Managed[] = [];
  let pg: PgliteHandle | null = null;
  const stopAll = async (): Promise<void> => {
    for (const m of [...managed].reverse()) await m.stop();
    await pg?.stop();
  };
  // If the supervisor itself dies (uncaught error, SIGKILL is the one thing we cannot catch),
  // the children must not outlive it: an orphaned sandbox/API keeps its port and the next
  // start fails with EADDRINUSE. `exit` is synchronous, so only signal here, no awaiting.
  const killChildrenOnExit = (): void => {
    for (const m of managed) if (m.child.exitCode === null) killTree(m.child, "SIGTERM");
  };
  process.once("exit", killChildrenOnExit);

  for (const d of [paths.objects(c), paths.logs(c), paths.sandboxIn(c), paths.sandboxOut(c), paths.models(c)]) {
    mkdirSync(d, { recursive: true });
  }

  try {
    // ── phase 1: database as owner, migrate + seed ─────────────────────────────
    const created = await ensureDatabaseExists(paths.pgData(c));
    log(`[pglite] database ${created ? "created" : "present"} at ${paths.pgData(c)}`);
    pg = await startPgliteServer({ dataDir: paths.pgData(c), port: c.ports.postgres, username: DB_OWNER_ROLE });
    log(`[pglite] owner phase on 127.0.0.1:${c.ports.postgres}`);
    await runMigrations(c, log);
    await runOwnerSeeds(c, log);
    await pg.stop();
    pg = null;

    // ── phase 2: database as app role, serve ───────────────────────────────────
    pg = await startPgliteServer({ dataDir: paths.pgData(c), port: c.ports.postgres, username: DB_APP_ROLE });
    log(`[pglite] app phase as ${DB_APP_ROLE} on 127.0.0.1:${c.ports.postgres}`);

    // ── Ollama ────────────────────────────────────────────────────────────────
    const ollamaBin = findOllama(opts.bundleBinDir);
    let ollamaUrl: string | null = null;
    if (ollamaBin) {
      const running = await runningOllamaVersion(`http://127.0.0.1:${c.ports.ollama}`);
      const runningOnAlternate = running === null ? null : await runningOllamaVersion(`http://127.0.0.1:${c.ports.ollama + 1}`);
      const choice = chooseOllama({ running, binary: ollamaBinaryVersion(ollamaBin), port: c.ports.ollama, runningOnAlternate });
      log(`[ollama] ${choice.reason}`);
      let already = choice.reuse;
      if (choice.port !== c.ports.ollama) {
        if (choice.reuse) {
          // The alternate port is ours alone: what runs there is an earlier instance of this
          // runtime, possibly started before OLLAMA_CONTEXT_LENGTH / KEEP_ALIVE existed. Restart
          // it so the server settings are the ones this build declares (#3749 B1.1).
          log(`[ollama] restarting our earlier instance on ${choice.port} to apply current server settings`);
          await stopListenerOnPort(choice.port);
          already = false;
        }
        await assertPortFree(choice.port, "ollama");
        c = { ...c, ports: { ...c.ports, ollama: choice.port } };
      }
      ollamaUrl = `http://127.0.0.1:${c.ports.ollama}`;
      // Bundled models go into whichever store the Ollama we are about to talk to serves from:
      // ours (data dir) when we spawn it, the user's own (OLLAMA_MODELS or ~/.ollama/models)
      // when one is already running -- copying into ours would be invisible to that one.
      if (opts.bundleModelsDir && !existsSync(opts.bundleModelsDir)) {
        warnings.push(`随包模型目录不存在，跳过导入：${opts.bundleModelsDir}`);
      } else if (opts.bundleModelsDir) {
        const store = already ? (process.env.OLLAMA_MODELS ?? join(homedir(), ".ollama", "models")) : paths.models(c);
        try {
          const r = importModels(opts.bundleModelsDir, store);
          if (r.imported.length) log(`[ollama] imported bundled model(s) into ${store}: ${r.imported.join(", ")}`);
          else log(`[ollama] bundled model(s) already in ${store}: ${r.skipped.join(", ")}`);
        } catch (e) {
          warnings.push(`随包模型导入失败（将回退到联网拉取）：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!already) {
        managed.push(startManaged({ name: "ollama", command: ollamaBin, args: ["serve"], cwd: c.dataDir, env: ollamaEnv(c), logDir: paths.logs(c) }, log));
        await waitForHttp(`${ollamaUrl}/api/tags`, { timeoutMs: 30_000 });
      } else {
        log("[ollama] already running, reusing");
      }
      if (opts.pullModel !== false) {
        for (const model of [c.chatModel, c.metaModel, c.embeddingModel]) {
          const have = await hasModel(ollamaUrl, model);
          if (have) { log(`[ollama] model present: ${model}`); continue; }
          log(`[ollama] pulling ${model} (first start only; several GB for the chat model)`);
          const r = await runToCompletion({ name: "ollama-pull", command: ollamaBin, args: ["pull", model], cwd: c.dataDir, env: ollamaEnv(c) });
          if (r.code !== 0) warnings.push(`拉取模型 ${model} 失败：${r.stderr.trim().split("\n").pop() ?? ""}`);
        }
      }
    } else {
      warnings.push("未找到 Ollama：API 已启动，但聊天没有可用模型（安装 Ollama 后重启即可）");
    }

    // Every service we spawn must own its port: a stale process there would answer our
    // readiness probe while our child dies on EADDRINUSE.
    for (const [port, what] of [[c.ports.sandbox, "skill-sandbox"], [c.ports.asr, "asr-gateway"], [c.ports.api, "api"], [c.ports.deepAgent, "deep-agent"], [c.ports.web, "web"]] as const) {
      if (what === "web" && (opts.webMode ?? "dev") === "none") continue;
      await assertPortFree(port, what);
    }

    // #3749 B2.3：机器带得动且 9B 已在库里 ⇒ 用 9B；否则保持配置的模型。只换 c，后面的 env 都从 c 派生。
    if (ollamaUrl) {
      const present = await listModels(ollamaUrl);
      const memoryGb = totalmem() / 1024 ** 3;
      const chosen = preferredChatModel({ configured: c.chatModel, memoryGb, present });
      if (chosen !== c.chatModel) {
        log(`[ollama] ${String(Math.round(memoryGb))} GB RAM and ${chosen} present: serving ${chosen} instead of ${c.chatModel}`);
        c = { ...c, chatModel: chosen };
      }
    }

    // ── skill sandbox (L0, loopback child process) ─────────────────────────────
    if (!sandboxModulesDir(c)) {
      warnings.push("skill 沙箱没有预装模块目录：pptx / docx / xlsx / pdf 生成类 skill 会以 MODULE_NOT_FOUND 失败（运行 scripts/local-bundle/prepare-sandbox-modules.sh 后重启）");
    }
    managed.push(startManaged({
      name: "skill-sandbox",
      command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
      args: ["src/main.ts"],
      cwd: join(c.repoRoot, "apps", "skill-sandbox"),
      env: sandboxEnv(c),
      logDir: paths.logs(c),
    }, log));
    await waitForManaged(managed.at(-1)!, `http://127.0.0.1:${c.ports.sandbox}/`, { timeoutMs: 60_000 });

    // ── local ASR gateway (sherpa-onnx streaming), only when the model is on disk ──
    let asrUrl: string | null = null;
    const asrModelDir = resolveAsrModelDir(c, opts.bundleAsrModelsDir);
    if (asrModelDir) {
      asrUrl = `ws://127.0.0.1:${c.ports.asr}`;
      managed.push(startManaged({
        name: "asr-gateway",
        command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
        args: ["src/main.ts"],
        cwd: join(c.repoRoot, "apps", "local-asr-gateway"),
        env: asrGatewayEnv(c, asrModelDir),
        logDir: paths.logs(c),
      }, log));
      await waitForManaged(managed.at(-1)!, `http://127.0.0.1:${c.ports.asr}/healthz`, { timeoutMs: 60_000 });
    } else {
      warnings.push("本地转写模型未下载：录音/访谈的实时转写不可用（运行 scripts/local-bundle/fetch-asr-model.sh 后重启）");
    }

    // ── API ───────────────────────────────────────────────────────────────────
    managed.push(startManaged({
      name: "api",
      command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
      args: ["src/main.ts"],
      cwd: join(c.repoRoot, "apps", "api"),
      env: { ...apiEnv(c), ...(asrUrl ? asrEnv(c) : {}) },
      logDir: paths.logs(c),
    }, log));
    const apiUrl = `http://127.0.0.1:${c.ports.api}`;
    await waitForManaged(managed.at(-1)!, `${apiUrl}/healthz`, { timeoutMs: 180_000 });

    // ── deep agent (python) ───────────────────────────────────────────────────
    let deepAgentUrl: string | null = null;
    const launch = resolveDeepAgentLaunch(c, opts.bundlePythonDir);
    if (launch) {
      deepAgentUrl = `http://127.0.0.1:${c.ports.deepAgent}`;
      log(`[deep-agent] python runtime: ${launch.source} (${launch.command})`);
      managed.push(startManaged({
        name: "deep-agent",
        command: launch.command,
        args: [...launch.args],
        cwd: join(c.repoRoot, "apps", "deep-agent-service"),
        env: launch.env,
        logDir: paths.logs(c),
      }, log));
      await waitForManaged(managed.at(-1)!, `${deepAgentUrl}/healthz`, { timeoutMs: 120_000 });
    } else {
      warnings.push("deep-agent-service 没有 Python 运行时（随包 python/ 或 .venv 都不存在）：聊天可回复，但工具调用 / skill 执行不可用");
    }

    // ── Web ───────────────────────────────────────────────────────────────────
    const webMode = opts.webMode ?? "dev";
    const webUrl = `http://127.0.0.1:${c.ports.web}`;
    if (webMode !== "none") {
      // pnpm does not hoist: `next` lives in apps/web's own node_modules/.bin, not the root's.
      managed.push(startManaged({
        name: "web",
        command: join(c.repoRoot, "apps", "web", "node_modules", ".bin", "next"),
        args: [webMode, "-p", String(c.ports.web), "-H", "127.0.0.1"],
        cwd: join(c.repoRoot, "apps", "web"),
        env: webEnv(c),
        logDir: paths.logs(c),
      }, log));
      await waitForManaged(managed.at(-1)!, webUrl, { timeoutMs: 300_000 });
    }

    const state = readSeedState(c);
    if (!state.provisioned) throw new Error("seed state has no provisioned user after seeding");
    return {
      urls: { web: webUrl, api: apiUrl, ollama: ollamaUrl, deepAgent: deepAgentUrl, asr: asrUrl },
      login: { email: "me@local.workspacex", password: c.secrets.adminPassword },
      warnings,
      stop: stopAll,
    };
  } catch (e) {
    await stopAll();
    throw e;
  }
}

async function listModels(ollamaUrl: string): Promise<readonly string[]> {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

async function hasModel(ollamaUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { models?: { name: string }[] };
    const want = model.includes(":") ? model : `${model}:latest`;
    return (body.models ?? []).some((m) => m.name === want || m.name === model);
  } catch {
    return false;
  }
}
