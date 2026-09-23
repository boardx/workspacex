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
  apiEnv, asrEnv, asrGatewayEnv, deepAgentEnv, ollamaEnv, paths, resolveAsrModelDir, sandboxEnv,
  sandboxModulesDir, webEnv, DB_APP_ROLE, DB_OWNER_ROLE, LOCAL_ADMIN_EMAIL, type LocalConfig,
  resolveDeepAgentLaunch, preferredChatModel, preferredMetaModel, MLX_SUFFIX,
} from "./config";
import { capabilityNotices, localCapabilities, type CapabilityStatus } from "./capabilities";
import { findOllama } from "./doctor";
import { importModels } from "./model-bundle";
import { chooseOllama, ollamaBinaryVersion, runningOllamaVersion } from "./ollama-version";
import { ensureDatabaseExists, startPgliteServer, type PgliteHandle } from "./pglite-server";
import {
  assertPortFree, stopListenerOnPort, killTree, startManaged, portInUse,
  waitForHttp, waitForHttpOrExit, runToCompletion, type Managed,
} from "./processes";
import { runMigrations, runOwnerSeeds, readSeedState } from "./seeds";
import { pullModelWithProgress } from "./pull-progress";
import { probeChatModel, probeEmbeddingModel } from "./model-preflight";
import { checkWebBuild } from "./web-build";
import { createBackup, type CreateBackupResult } from "./backup";

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
  /**
   * 把用户的不可再生数据备份到 `destRoot` 下的一个带时间戳的目录里，并**立刻重读校验**。
   * 不包含模型（可重新获取，约 10 GB）和日志。见 `backup.ts` 的头注。
   */
  backup(destRoot: string, appVersion: string): Promise<CreateBackupResult>;
  stop(): Promise<void>;
}

export async function up(opts: UpOptions): Promise<RunningStack> {
  let c = opts.config;
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
    for (const m of managed) if (m.child.exitCode === null) killTree(m.child, "SIGTERM");
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
        await waitForHttpOrExit(`${ollamaUrl}/api/tags`, { timeoutMs: 30_000 }, managed[managed.length - 1]!);
      } else {
        log("[ollama] already running, reusing");
      }
      if (opts.pullModel !== false) {
        // The meta model is an OPTIMISATION, never a download: `preferredMetaModel` falls back
        // to the chat model when it is absent, and on a 16 GB machine that fallback is the
        // faster choice anyway. It was in this list while it was still bundled; after it was
        // dropped from the Mac bundle (#3749 R10) every first start pulled 2.6 GB over the
        // network to get something the machine would then decline to use (实测 2026-09-22,
        // 用户的首次启动卡在「检查本地模型」7 分钟).
        for (const model of [c.chatModel, c.embeddingModel]) {
          const have = await hasModel(ollamaUrl, model);
          if (have) { log(`[ollama] model present: ${model}`); continue; }
          log(`[ollama] pulling ${model} (first start only; several GB for the chat model)`);
          // 走流式的 `POST /api/pull` 而不是 `ollama pull` 子进程：CLI 的输出是给终端看的
          // （回车重绘同一行），解析不稳当，而且 `runToCompletion` 要等它整个结束才有输出——
          // 于是启动屏在下载这三个多 GB 的几分钟里一动不动（2026-09-22 用户实测的那一幕）。
          const r = await pullModelWithProgress(ollamaUrl, model, log);
          if (!r.ok) warnings.push(`拉取模型 ${model} 失败：${r.detail}`);
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
      // #3749 R9：MLX 构建更快，但「库里有这个标签」不等于「这台机器能跑它」。预热就是
      // 那次验证：预热不过就换回非 MLX 版，宁可慢也不能让用户的第一条消息撞上起不来的运行器。
      if (chosen.endsWith(MLX_SUFFIX)) {
        const fallback = chosen.slice(0, -MLX_SUFFIX.length);
        if (await warmModel(ollamaUrl, chosen) === null) {
          if (present.includes(fallback)) {
            log(`[ollama] ${chosen} failed to load on this machine; falling back to ${fallback}`);
            c = { ...c, chatModel: fallback };
          } else {
            warnings.push(`随包的 ${chosen} 在这台机器上加载失败，且库里没有非 MLX 版可回落`);
          }
        } else {
          log(`[ollama] ${chosen} loaded (MLX runner)`);
        }
      }
      const meta = preferredMetaModel({ configured: c.metaModel, chatModel: c.chatModel, memoryGb, present });
      if (meta !== c.metaModel) {
        log(`[ollama] meta tasks on ${meta} (${String(Math.round(memoryGb))} GB RAM: the ${c.metaModel} would swap in and out with the chat model)`);
        c = { ...c, metaModel: meta };
      }
    }

    // #3749 R1：把聊天模型预加载进显存。冷加载实测 11.7 s（4B，Apple Silicon），而用户的第一条
    // 消息正好付这笔钱；`keep_alive` 只防卸载，防不了首次加载。不 await——启动不因此变慢，
    // 模型在用户还在看启动页时就位；失败只是没预热，不影响任何功能。
    if (ollamaUrl) {
      const url = ollamaUrl;
      if (!c.chatModel.endsWith(MLX_SUFFIX)) {
        void warmModel(url, c.chatModel).then((ms) => {
          if (ms !== null) log(`[ollama] ${c.chatModel} warmed in ${String(Math.round(ms / 100) / 10)}s`);
        });
      }
      if (c.metaModel !== c.chatModel) void warmModel(url, c.metaModel);
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
    await waitForHttpOrExit(`http://127.0.0.1:${c.ports.sandbox}/`, { timeoutMs: 60_000 }, managed[managed.length - 1]!);

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
    const capabilities = localCapabilities(c, {
      chatModel: chatModelAnswers,
      // 随包 python / 随包转写模型的部署里，「有没有」不等于 `.venv` 或数据目录里有没有——
      // 用这次启动真正解析到的东西回答。
      toolsAndSkills: launch !== null,
      liveTranscription: asrModelDir !== null,
    });
    return {
      capabilities,
      urls: { web: webUrl, api: apiUrl, ollama: ollamaUrl, deepAgent: deepAgentUrl, asr: asrUrl },
      login: { email: LOCAL_ADMIN_EMAIL, password: c.secrets.adminPassword },
      // 本次启动里真出了问题的事（拉模型失败之类）＋ 缺件/缺能力的统一清单。
      warnings: [...warnings, ...capabilityNotices(capabilities)],
      async backup(destRoot: string, appVersion: string) {
        if (pg === null) return { ok: false as const, reason: "数据库还没起来，稍后再试" };
        return createBackup({
          destRoot,
          appVersion,
          dumpDatabase: () => pg!.dumpDatabase(),
          countRows: (t) => pg!.countRows(t),
          objectsDir: paths.objects(c),
          log,
        });
      },
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

/**
 * One-token completion so llama.cpp maps the weights before a human is waiting on them.
 * Returns the load time, or null when it failed (a warmup is never a startup failure).
 */
async function warmModel(ollamaUrl: string, model: string): Promise<number | null> {
  const started = Date.now();
  try {
    const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(180_000),
    });
    return res.ok ? Date.now() - started : null;
  } catch {
    return null;
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
