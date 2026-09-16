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
import { platform } from "node:os";
import {
  apiEnv, deepAgentEnv, ollamaEnv, paths, sandboxEnv, webEnv, DB_APP_ROLE, DB_OWNER_ROLE, type LocalConfig,
} from "./config";
import { findOllama } from "./doctor";
import { ensureDatabaseExists, startPgliteServer, type PgliteHandle } from "./pglite-server";
import { startManaged, waitForHttp, runToCompletion, type Managed } from "./processes";
import { runMigrations, runOwnerSeeds, readSeedState } from "./seeds";

export interface UpOptions {
  readonly config: LocalConfig;
  readonly log?: (line: string) => void;
  /** `dev` = `next dev` (no build step, slow first paint); `start` = `next start` on a prior `next build`. */
  readonly webMode?: "dev" | "start" | "none";
  readonly bundleBinDir?: string;
  /** Skip pulling the model even if Ollama is up (tests, offline). */
  readonly pullModel?: boolean;
}

export interface RunningStack {
  readonly urls: { web: string; api: string; ollama: string | null; deepAgent: string | null };
  readonly login: { email: string; password: string };
  readonly warnings: readonly string[];
  stop(): Promise<void>;
}

export async function up(opts: UpOptions): Promise<RunningStack> {
  const c = opts.config;
  const log = opts.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warnings: string[] = [];
  const managed: Managed[] = [];
  let pg: PgliteHandle | null = null;
  const stopAll = async (): Promise<void> => {
    for (const m of [...managed].reverse()) await m.stop();
    await pg?.stop();
  };

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
      ollamaUrl = `http://127.0.0.1:${c.ports.ollama}`;
      const already = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
      if (!already) {
        managed.push(startManaged({ name: "ollama", command: ollamaBin, args: ["serve"], cwd: c.dataDir, env: ollamaEnv(c), logDir: paths.logs(c) }, log));
        await waitForHttp(`${ollamaUrl}/api/tags`, { timeoutMs: 30_000 });
      } else {
        log("[ollama] already running, reusing");
      }
      if (opts.pullModel !== false) {
        for (const model of [c.chatModel, c.embeddingModel]) {
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

    // ── skill sandbox (L0, loopback child process) ─────────────────────────────
    managed.push(startManaged({
      name: "skill-sandbox",
      command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
      args: ["src/main.ts"],
      cwd: join(c.repoRoot, "apps", "skill-sandbox"),
      env: sandboxEnv(c),
      logDir: paths.logs(c),
    }, log));
    await waitForHttp(`http://127.0.0.1:${c.ports.sandbox}/`, { timeoutMs: 60_000 });

    // ── API ───────────────────────────────────────────────────────────────────
    managed.push(startManaged({
      name: "api",
      command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
      args: ["src/main.ts"],
      cwd: join(c.repoRoot, "apps", "api"),
      env: apiEnv(c),
      logDir: paths.logs(c),
    }, log));
    const apiUrl = `http://127.0.0.1:${c.ports.api}`;
    await waitForHttp(`${apiUrl}/healthz`, { timeoutMs: 180_000 });

    // ── deep agent (python) ───────────────────────────────────────────────────
    let deepAgentUrl: string | null = null;
    const venv = paths.deepAgentVenv(c);
    const py = join(venv, platform() === "win32" ? "Scripts" : "bin", platform() === "win32" ? "uvicorn.exe" : "uvicorn");
    if (existsSync(py)) {
      deepAgentUrl = `http://127.0.0.1:${c.ports.deepAgent}`;
      managed.push(startManaged({
        name: "deep-agent",
        command: py,
        args: ["deep_agent_service.http_app:app", "--host", "127.0.0.1", "--port", String(c.ports.deepAgent), "--workers", "1"],
        cwd: join(c.repoRoot, "apps", "deep-agent-service"),
        env: deepAgentEnv(c),
        logDir: paths.logs(c),
      }, log));
      await waitForHttp(`${deepAgentUrl}/healthz`, { timeoutMs: 120_000 });
    } else {
      warnings.push("deep-agent-service 未安装 Python 运行时（.venv）：聊天可回复，但工具调用 / skill 执行不可用");
    }

    // ── Web ───────────────────────────────────────────────────────────────────
    const webMode = opts.webMode ?? "dev";
    const webUrl = `http://127.0.0.1:${c.ports.web}`;
    if (webMode !== "none") {
      managed.push(startManaged({
        name: "web",
        command: join(c.repoRoot, "node_modules", ".bin", "next"),
        args: [webMode, "-p", String(c.ports.web), "-H", "127.0.0.1"],
        cwd: join(c.repoRoot, "apps", "web"),
        env: webEnv(c),
        logDir: paths.logs(c),
      }, log));
      await waitForHttp(webUrl, { timeoutMs: 300_000 });
    }

    const state = readSeedState(c);
    if (!state.provisioned) throw new Error("seed state has no provisioned user after seeding");
    return {
      urls: { web: webUrl, api: apiUrl, ollama: ollamaUrl, deepAgent: deepAgentUrl },
      login: { email: "me@local.workspacex", password: c.secrets.adminPassword },
      warnings,
      stop: stopAll,
    };
  } catch (e) {
    await stopAll();
    throw e;
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
