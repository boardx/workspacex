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
  apiEnv, asrEnv, asrGatewayEnv, deepAgentEnv, ollamaEnv, paths, sandboxEnv, webEnv,
  DB_APP_ROLE, DB_OWNER_ROLE, LOCAL_ADMIN_EMAIL, type LocalConfig,
} from "./config";
import { capabilityNotices, localCapabilities, type CapabilityStatus } from "./capabilities";
import { findOllama } from "./doctor";
import { ensureDatabaseExists, startPgliteServer, type PgliteHandle } from "./pglite-server";
import { startManaged, portInUse, waitForHttp, waitForHttpOrExit, runToCompletion, type Managed } from "./processes";
import { runMigrations, runOwnerSeeds, readSeedState } from "./seeds";
import { probeChatModel, probeEmbeddingModel } from "./model-preflight";
import { checkWebBuild } from "./web-build";

export interface UpOptions {
  readonly config: LocalConfig;
  readonly log?: (line: string) => void;
  /** `dev` = `next dev` (no build step, slow first paint); `start` = `next start` on a prior `next build`. */
  readonly webMode?: "dev" | "start" | "none";
  readonly bundleBinDir?: string;
  /** Skip pulling the model even if Ollama is up (tests, offline). */
  readonly pullModel?: boolean;
  /** Skip the real model round-trip (tests, offline). Default is to probe. */
  readonly probeModels?: boolean;
  /** Called when a service dies AFTER the stack came up. See the note at the end of `up`. */
  readonly onServiceExit?: (info: { name: string; code: number | null; recentOutput: string }) => void;
}

export interface RunningStack {
  /** 本次启动下每条能力的实际状态（capabilities.ts 是唯一事实源）。 */
  readonly capabilities: readonly CapabilityStatus[];
  readonly urls: { web: string; api: string; ollama: string | null; deepAgent: string | null; asr: string | null };
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
  let stopping = false;
  const stopAll = async (): Promise<void> => {
    stopping = true;
    for (const m of [...managed].reverse()) await m.stop();
    await pg?.stop();
  };
  // If the supervisor itself dies (uncaught error, SIGKILL is the one thing we cannot catch),
  // the children must not outlive it: an orphaned sandbox/API keeps its port and the next
  // start fails with EADDRINUSE. `exit` is synchronous, so only signal here, no awaiting.
  const killChildrenOnExit = (): void => {
    for (const m of managed) if (m.child.exitCode === null) m.child.kill("SIGTERM");
  };
  process.once("exit", killChildrenOnExit);

  for (const d of [paths.objects(c), paths.logs(c), paths.sandboxIn(c), paths.sandboxOut(c), paths.models(c)]) {
    mkdirSync(d, { recursive: true });
  }

  // ⚠ Before anything starts. A port already taken otherwise shows up as "not ready after
  //   180000ms" three minutes into the boot, which reads exactly like a slow machine --
  //   and the second start after a hard kill is the common case, not the exotic one.
  //   Ollama is excluded on purpose: a user's own `ollama serve` is reused, not a conflict.
  await assertPortsFree(c, opts.webMode ?? "dev");

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
        await waitForHttpOrExit(`${ollamaUrl}/api/tags`, { timeoutMs: 30_000 }, managed[managed.length - 1]!);
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
    }
    // ⚠ 「没找到 Ollama」这句话不在这里说。缺件清单只有一份（capabilities.ts），
    //   在 up() 结束时统一产出——否则同一件事会在 doctor 与这里各写一遍，
    //   且两份的措辞迟早不一样。

    // 「标签在列表里」≠「模型能回话」。见 model-preflight.ts 的文件头：能过 /api/tags
    // 却调不动的情形不少，而它们全都要等用户发出第一条消息才暴露。
    // 跳过探测时（测试/离线）退回「找到了二进制」这条较弱的证据，而不是谎报不可用。
    let chatModelAnswers = ollamaBin !== null;
    if (ollamaUrl !== null && opts.probeModels !== false) {
      const modelBase = `${ollamaUrl}/v1`;
      log(`[model] 正在验证 ${c.chatModel} 能否回话（首次加载权重可能要一分钟）`);
      const chat = await probeChatModel({ baseUrl: modelBase, apiKey: "ollama-local", model: c.chatModel });
      chatModelAnswers = chat.ok;
      if (chat.ok) log(`[model] ${c.chatModel} 就绪，首个 token 往返 ${chat.elapsedMs} ms`);
      else warnings.push(`${chat.detail ?? ""}——聊天暂时不可用，其余功能不受影响`);

      const embed = await probeEmbeddingModel({ baseUrl: modelBase, apiKey: "ollama-local", model: c.embeddingModel });
      if (!embed.ok) warnings.push(`${embed.detail ?? ""}——检索与记忆会退化，聊天不受影响`);
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
    await waitForHttpOrExit(`http://127.0.0.1:${c.ports.sandbox}/`, { timeoutMs: 60_000 }, managed[managed.length - 1]!);

    // ── local ASR gateway (sherpa-onnx streaming), only when the model is on disk ──
    let asrUrl: string | null = null;
    if (existsSync(join(paths.asrModelDir(c), "tokens.txt"))) {
      asrUrl = `ws://127.0.0.1:${c.ports.asr}`;
      managed.push(startManaged({
        name: "asr-gateway",
        command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
        args: ["src/main.ts"],
        cwd: join(c.repoRoot, "apps", "local-asr-gateway"),
        env: asrGatewayEnv(c),
        logDir: paths.logs(c),
      }, log));
      await waitForHttpOrExit(`http://127.0.0.1:${c.ports.asr}/healthz`, { timeoutMs: 60_000 }, managed[managed.length - 1]!);
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
    await waitForHttpOrExit(`${apiUrl}/healthz`, { timeoutMs: 180_000 }, managed[managed.length - 1]!);

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
      await waitForHttpOrExit(`${deepAgentUrl}/healthz`, { timeoutMs: 120_000 }, managed[managed.length - 1]!);
    }

    // ── Web ───────────────────────────────────────────────────────────────────
    const webMode = opts.webMode ?? "dev";
    const webUrl = `http://127.0.0.1:${c.ports.web}`;
    if (webMode !== "none") {
      if (webMode === "start") {
        // `next start` 跑的是构建期就把 API 地址内联进去的产物；端口一换，页面照样打开、
        // 一个报错也没有，而每个请求都打向旧地址。见 web-build.ts 的文件头。
        const check = checkWebBuild(join(c.repoRoot, "apps", "web"), webEnv(c).NEXT_PUBLIC_API_URL!);
        if (!check.usable) throw new Error(`无法用已构建的 Web 产物启动：\n  ${check.reason ?? ""}`);
      }
      // pnpm does not hoist: `next` lives in apps/web's own node_modules/.bin, not the root's.
      managed.push(startManaged({
        name: "web",
        command: join(c.repoRoot, "apps", "web", "node_modules", ".bin", "next"),
        args: [webMode, "-p", String(c.ports.web), "-H", "127.0.0.1"],
        cwd: join(c.repoRoot, "apps", "web"),
        env: webEnv(c),
        logDir: paths.logs(c),
      }, log));
      await waitForHttpOrExit(webUrl, { timeoutMs: 300_000 }, managed[managed.length - 1]!);
    }

    const state = readSeedState(c);
    if (!state.provisioned) throw new Error("seed state has no provisioned user after seeding");

    // Until now a crash was fatal (readiness fails). From now on the stack is "up", and a
    // service that dies afterwards would simply stop answering -- the user would meet it as
    // a hung chat box. Say it, loudly, on the one channel the shell and the CLI share.
    for (const m of managed) {
      void m.exited.then((code) => {
        if (stopping) return;
        const why = m.recentOutput().trim();
        log(`[${m.name}] ⚠ 进程已退出（code ${String(code)}），依赖它的能力现在不可用` +
          (why === "" ? "" : `\n--- ${m.name} 最后的输出 ---\n${why}`));
        opts.onServiceExit?.({ name: m.name, code, recentOutput: why });
      });
    }
    // ⚠ 传的是「模型真的回了话」，不是「找到了 Ollama 二进制」。后者是 doctor 在没起栈时
    //   能拿到的最好证据；到了这里我们有更强的证据，就该用更强的那个。
    const capabilities = localCapabilities(c, { chatModel: chatModelAnswers });
    return {
      capabilities,
      urls: { web: webUrl, api: apiUrl, ollama: ollamaUrl, deepAgent: deepAgentUrl, asr: asrUrl },
      login: { email: LOCAL_ADMIN_EMAIL, password: c.secrets.adminPassword },
      // 本次启动里真出了问题的事（拉模型失败之类）＋ 缺件/缺能力的统一清单。
      warnings: [...warnings, ...capabilityNotices(capabilities)],
      stop: stopAll,
    };
  } catch (e) {
    await stopAll();
    throw e;
  }
}

/**
 * Every loopback port this run intends to BIND must be free.
 *
 * ⚠ Ollama is deliberately absent: `up` reuses an already-running `ollama serve` rather than
 *   treating it as a conflict, so a busy 11434 is the normal case, not a failure.
 * ⚠ PostgreSQL is checked here too AND again inside `startPgliteServer`; that second check
 *   is not redundant -- it is the one that protects a caller who does not go through `up`.
 */
async function assertPortsFree(c: LocalConfig, webMode: "dev" | "start" | "none"): Promise<void> {
  const wanted: { name: string; port: number }[] = [
    { name: "PostgreSQL (PGlite)", port: c.ports.postgres },
    { name: "API", port: c.ports.api },
    { name: "Skill 沙箱", port: c.ports.sandbox },
  ];
  if (webMode !== "none") wanted.push({ name: "Web", port: c.ports.web });
  const taken = (await Promise.all(wanted.map(async (w) => ({ ...w, busy: await portInUse(w.port) }))))
    .filter((w) => w.busy);
  if (taken.length === 0) return;
  throw new Error(
    `以下端口已被占用，无法启动：\n${taken.map((t) => `  ${t.port}  ${t.name}`).join("\n")}\n` +
      "多半是上一个 WorkspaceX Local 还在跑（在它的终端里 Ctrl-C），" +
      `或者别的程序占了这些端口（可用 --ports ${taken.map((t) => `${portFlagName(t.name)}=<新端口>`).join(",")} 换开）。`,
  );
}

function portFlagName(serviceName: string): string {
  return serviceName.startsWith("API") ? "api"
    : serviceName.startsWith("Web") ? "web"
    : serviceName.startsWith("Skill") ? "sandbox"
    : "postgres";
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
