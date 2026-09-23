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
import { humanBytes, humanEta } from "./model-import";
import { PortsInUseError } from "./startup-failure";
import { chooseOllama, ollamaBinaryVersion, runningOllamaVersion } from "./ollama-version";
import { ensureDatabaseExists, startPgliteServer, type PgliteHandle } from "./pglite-server";
import {
  assertPortFree, stopListenerOnPort, killTree, startManaged, portInUse, type SpawnSpec,
  waitForHttp, waitForHttpOrExit, runToCompletion, type Managed,
} from "./processes";
import { runMigrations, runOwnerSeeds, readSeedState } from "./seeds";
import { pullModelWithProgress } from "./pull-progress";
import { probeChatModel, probeEmbeddingModel } from "./model-preflight";
import { checkWebBuild } from "./web-build";
import { createBackup, type CreateBackupResult } from "./backup";
import { superviseManaged, type ServiceHealth, type Supervised } from "./supervisor";
import { describeServiceFailure, SERVICE_IMPACT } from "./supervisor-policy";
import {
  decideUnload, explainBudget, idleMsFromExpiry, memoryBudgetBytes, parsePs, RECENTLY_USED_MS,
} from "./model-memory-budget";
import { totalmem as osTotalMem } from "node:os";

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
  /**
   * 栈起来之后某个服务的健康状态变了（挂了 / 正在拉起 / 拉不起来）。
   * 带的是**说给用户听的那两句**，不是 exit code——外壳直接显示即可，不用自己拼。
   */
  readonly onServiceHealth?: (h: ServiceHealth) => void;
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
  /** 本地各服务此刻的健康状态——外壳据此决定要不要把「有东西坏了」说出来。 */
  health(): readonly ServiceHealth[];
  /**
   * 等那几个「不挡首屏」的服务也就绪。界面不需要它，**但测量与自动化需要**：
   * 否则一条 e2e 会在沙箱还没起来的时候就去跑技能。
   */
  whenFullyReady(): Promise<void>;
  stop(): Promise<void>;
}

export async function up(opts: UpOptions): Promise<RunningStack> {
  let c = opts.config;
  const log = opts.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warnings: string[] = [];
  const managed: Managed[] = [];
  /** 每个子进程的启动规格——重启时要用同一份，不能现编。 */
  const specs: SpawnSpec[] = [];
  const supervised: Supervised[] = [];
  /**
   * 不挡首屏的就绪等待（#3872 R7）。
   *
   * 实测 15 次真实启动：到「加载界面」的中位耗时 6.8 s，其中**语音转写 1.8 s（27%）**、
   * **技能沙箱 1.2 s（17%）**——两者加起来占 44%，而用户在开头几秒都用不到它们
   * （录音要先导航过去，技能要先发一条会用到它的消息）。评分卡维度 1 的 9 分判据
   * 写的就是「重资源懒加载在首屏之后」。
   *
   * ⚠ 延后不等于不管：失败要走健康通道说出来，而不是被吞掉。原先它们是 `await`，
   *   失败会让整个 `up()` 抛错；现在失败变成一条具名的健康事件。
   */
  const deferredReady: Array<{ name: string; wait: Promise<void> }> = [];
  const healthById = new Map<string, ServiceHealth>();
  /** 起一个被记录在案的子进程；规格留着，重启时要用同一份。 */
  const spawn = (spec: SpawnSpec): Managed => {
    specs.push(spec);
    const m = startManaged(spec, log);
    managed.push(m);
    return m;
  };
  let pg: PgliteHandle | null = null;
  let stopping = false;
  let memoryWatchTimer: ReturnType<typeof setInterval> | null = null;
  const stopAll = async (): Promise<void> => {
    stopping = true;
    if (memoryWatchTimer !== null) { clearInterval(memoryWatchTimer); memoryWatchTimer = null; }
    // 先停监督者：它一停就不再把退出当崩溃，否则我们自己关应用的时候它会挨个把子进程拉起来。
    for (const s of [...supervised].reverse()) await s.stop();
    for (const m of [...managed].reverse()) if (m.child.exitCode === null) await m.stop();
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
          /*
            首次启动要搬 7.5 GB。原来这里是一句同步拷贝，期间一个字都不说——
            评分卡「首次运行」9 分的第一条判据就是「全程确定性百分比 + 剩余时间」。
            现在按字节报进度，桌面壳把它显示在启动页上（#3872 维度 2）。
          */
          const r = await importModels(opts.bundleModelsDir, store, {
            onProgress: (p) => {
              const pct = p.bytesTotal === 0 ? 100 : Math.floor((p.bytesDone / p.bytesTotal) * 100);
              log(`[ollama] 导入随包模型 ${p.model} ${pct}% （${humanBytes(p.bytesDone)} / ${humanBytes(p.bytesTotal)}，${humanEta(p.etaSeconds)}）`);
            },
          });
          if (r.imported.length) log(`[ollama] imported bundled model(s) into ${store}: ${r.imported.join(", ")}`);
          else log(`[ollama] bundled model(s) already in ${store}: ${r.skipped.join(", ")}`);
        } catch (e) {
          warnings.push(`随包模型导入失败（将回退到联网拉取）：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!already) {
        spawn({ name: "ollama", command: ollamaBin, args: ["serve"], cwd: c.dataDir, env: ollamaEnv(c), logDir: paths.logs(c) });
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
    spawn({
      name: "skill-sandbox",
      command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
      args: ["src/main.ts"],
      cwd: join(c.repoRoot, "apps", "skill-sandbox"),
      env: sandboxEnv(c),
      logDir: paths.logs(c),
    });
    deferredReady.push({
      name: "skill-sandbox",
      wait: waitForHttpOrExit(`http://127.0.0.1:${c.ports.sandbox}/`, { timeoutMs: 60_000 }, managed[managed.length - 1]!),
    });

    // ── local ASR gateway (sherpa-onnx streaming), only when the model is on disk ──
    let asrUrl: string | null = null;
    const asrModelDir = resolveAsrModelDir(c, opts.bundleAsrModelsDir);
    if (asrModelDir) {
      asrUrl = `ws://127.0.0.1:${c.ports.asr}`;
      spawn({
        name: "asr-gateway",
        command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
        args: ["src/main.ts"],
        cwd: join(c.repoRoot, "apps", "local-asr-gateway"),
        env: asrGatewayEnv(c, asrModelDir),
        logDir: paths.logs(c),
      });
      deferredReady.push({
        name: "asr-gateway",
        wait: waitForHttpOrExit(`http://127.0.0.1:${c.ports.asr}/healthz`, { timeoutMs: 60_000 }, managed[managed.length - 1]!),
      });
    }

    // ── API ───────────────────────────────────────────────────────────────────
    spawn({
      name: "api",
      command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
      args: ["src/main.ts"],
      cwd: join(c.repoRoot, "apps", "api"),
      env: { ...apiEnv(c), ...(asrUrl ? asrEnv(c) : {}) },
      logDir: paths.logs(c),
    });
    const apiUrl = `http://127.0.0.1:${c.ports.api}`;
    await waitForHttpOrExit(`${apiUrl}/healthz`, { timeoutMs: 180_000 }, managed[managed.length - 1]!);

    // ── deep agent (python) ───────────────────────────────────────────────────
    let deepAgentUrl: string | null = null;
    const launch = resolveDeepAgentLaunch(c, opts.bundlePythonDir);
    if (launch) {
      deepAgentUrl = `http://127.0.0.1:${c.ports.deepAgent}`;
      log(`[deep-agent] python runtime: ${launch.source} (${launch.command})`);
      spawn({
        name: "deep-agent",
        command: launch.command,
        args: [...launch.args],
        cwd: join(c.repoRoot, "apps", "deep-agent-service"),
        env: launch.env,
        logDir: paths.logs(c),
      });
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
      spawn({
        name: "web",
        command: join(c.repoRoot, "apps", "web", "node_modules", ".bin", "next"),
        args: [webMode, "-p", String(c.ports.web), "-H", "127.0.0.1"],
        cwd: join(c.repoRoot, "apps", "web"),
        env: webEnv(c),
        logDir: paths.logs(c),
      });
      await waitForHttpOrExit(webUrl, { timeoutMs: 300_000 }, managed[managed.length - 1]!);
    }

    const state = readSeedState(c);
    if (!state.provisioned) throw new Error("seed state has no provisioned user after seeding");

    // 起来之后再崩的服务由监督接管（见本函数末尾接上监督的那一段）。
    // ⚠ 这里**不要**再单独挂一份 `m.exited` 监听：那会和监督各说各话，
    //   而同一件事实声明在两处是本仓的头号病。
    // ⚠ 传的是「模型真的回了话」，不是「找到了 Ollama 二进制」。后者是 doctor 在没起栈时
    //   能拿到的最好证据；到了这里我们有更强的证据，就该用更强的那个。
    const capabilities = localCapabilities(c, {
      chatModel: chatModelAnswers,
      // 随包 python / 随包转写模型的部署里，「有没有」不等于 `.venv` 或数据目录里有没有——
      // 用这次启动真正解析到的东西回答。
      toolsAndSkills: launch !== null,
      liveTranscription: asrModelDir !== null,
    });
    /*
      全部就绪之后才接上监督（#3872 R2）。

      在这之前，任何一个本地服务挂掉都既不会被拉起、也不会告诉任何人——只往日志写一行，
      用户看到的是界面永远停在「正在思考」。这是离线应用十大缺陷里的第 3 条。

      为什么放在就绪之后而不是一开始：启动阶段的失败有它自己的诊断路径
      （`waitForHttpOrExit` 会带着子进程最后的输出报错），那条路径一字未动；
      监督管的是「起来之后又倒下」。
    */
    for (let i = 0; i < managed.length; i += 1) {
      const m = managed[i]!;
      const spec = specs[i]!;
      if (m.child.exitCode !== null) continue;   // 启动阶段就已经死了的，不进监督
      supervised.push(superviseManaged({
        spec, log, initial: m,
        onHealth: (h) => {
          healthById.set(h.name, h);
          if (h.state !== "running" && h.message !== null) {
            log(`[${h.name}] ${h.message.title}：${h.message.body.replace(/\n/g, " ")}`);
          }
          opts.onServiceHealth?.(h);
        },
      }));
    }

    /*
      给模型常驻内存上一个会话内的闸（#3872 R2）。

      实测：运行器每次请求涨约 70 MB 且不回落，在一台连续使用的 16 GB 机器上量到 9.7 GB。
      这是 Ollama 自己的行为，我们改不了；能做的是在它涨过头之前把模型卸掉，
      下一次提问付一次冷加载（实测 2.1–2.4 s）就回到干净状态。

      R1 的 30 分钟保活给的是**空闲**上界，这里给的是**会话内**上界，管的不是同一段时间。

      「正在生成时绝不卸」靠 Ollama 自己报的到期时间倒推空闲多久——那是我们已经拿到的数据，
      不用去探进程 CPU，也就不用去猜运行器的 pid。解析不出来时当成「可能正忙」。
    */
    if (ollamaUrl !== null) {
      const keepAliveMs = 30 * 60_000;              // 与 config.ts 的 OLLAMA_KEEP_ALIVE 对应
      let freshBytes: number | null = null;
      let lastUnloadAt: number | null = null;
      let budgetExplained = false;
      const tick = async (): Promise<void> => {
        if (stopping) return;
        try {
          const res = await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(4000) });
          const loaded = parsePs(await res.json());
          const model = loaded.find((x) => x.name === c.chatModel) ?? loaded[0];
          if (model === undefined) { freshBytes = null; return; }
          if (freshBytes === null || model.sizeBytes < freshBytes) freshBytes = model.sizeBytes;
          const budget = memoryBudgetBytes({ totalBytes: osTotalMem(), freshBytes });
          if (!budgetExplained) {
            log(`[ollama] ${explainBudget({ totalBytes: osTotalMem(), freshBytes })}`);
            budgetExplained = true;
          }
          const idle = idleMsFromExpiry(model.expiresAt, keepAliveMs, Date.now());
          const d = decideUnload({
            currentBytes: model.sizeBytes,
            budgetBytes: budget,
            busy: idle === null || idle < RECENTLY_USED_MS,
            now: Date.now(),
            lastUnloadAt,
          });
          if (d.action !== "unload") return;
          log(`[ollama] ${d.reason}`);
          await fetch(`${ollamaUrl}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: model.name, keep_alive: 0 }),
            signal: AbortSignal.timeout(20_000),
          }).catch(() => undefined);
          lastUnloadAt = Date.now();
          freshBytes = null;                         // 下次加载后重新观察「刚加载完是多少」
        } catch {
          // 探测失败不影响任何东西：下一轮再看。这条路径绝不能让应用崩。
        }
      };
      const timer = setInterval(() => { void tick(); }, 60_000);
      timer.unref?.();
      memoryWatchTimer = timer;
    }

    /*
      延后就绪的那几个：不挡首屏，但**必须有人盯着**。
      失败走的是和崩溃同一条健康通道，说人话、带影响，而不是在日志里躺着。
    */
    for (const d of deferredReady) {
      void d.wait.then(
        () => log(`[${d.name}] 已就绪（没有挡住界面）`),
        (e: unknown) => {
          // 我们自己在关应用时，这些等待必然会失败（进程被停了）。那不是故障，
          // 报出去只会在每次退出时弹一个假警报——与监督那边「我们自己停的不当崩溃」同一条纪律。
          if (stopping) return;
          const why = e instanceof Error ? e.message : String(e);
          log(`[${d.name}] 起不来：${why}`);
          const msg = describeServiceFailure(d.name, { action: "give-up", reason: why }, SERVICE_IMPACT[d.name] ?? "");
          const h: ServiceHealth = { name: d.name, state: "failed", message: { title: msg.title, body: msg.body }, exits: 0 };
          healthById.set(d.name, h);
          opts.onServiceHealth?.(h);
        },
      );
    }

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
      health: () => supervised.map((s) => s.health()),
      whenFullyReady: async () => { await Promise.allSettled(deferredReady.map((d) => d.wait)); },
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
  const probe = (globalThis as { __wsxPortInUse?: (p: number) => boolean }).__wsxPortInUse
    ?? ((p: number) => portInUse(p));
  const taken = (await Promise.all(wanted.map(async (w) => ({ ...w, busy: await probe(w.port) }))))
    .filter((w) => w.busy);
  if (taken.length === 0) return;
  // 结构化地抛：桌面壳要据此给出「收回并重试」，而**文案随时会改**（见
  // startup-failure.ts 的 PortsInUseError：R10 正是因为解析文案而整条路成了死代码）。
  throw new PortsInUseError(
    `以下端口已被占用，无法启动：\n${taken.map((t) => `  ${t.port}  ${t.name}`).join("\n")}\n` +
      "多半是上一个 WorkspaceX Local 还在跑（在它的终端里 Ctrl-C），" +
      `或者别的程序占了这些端口（可用 --ports ${taken.map((t) => `${portFlagName(t.name)}=<新端口>`).join(",")} 换开）。`,
    taken.map((t) => ({ port: t.port, name: t.name })),
  );
}

/**
 * 测试入口：用假的端口探测跑一遍**真正的** `assertPortsFree`，把它抛的东西还回去。
 *
 * 存在的理由见 `test/startup-failure.test.ts` 末节：手抄的错误消息会过期，
 * 而过期的夹具会让一条死代码全程绿灯。这里让产线代码自己抛，分诊去认它。
 */
export async function assertPortsFreeForTest(
  ports: { postgres: number; api: number; sandbox: number; web: number },
  busy: (port: number) => boolean,
): Promise<unknown> {
  const real = portInUse;
  try {
    (globalThis as { __wsxPortInUse?: (p: number) => boolean }).__wsxPortInUse = busy;
    await assertPortsFree({ ports } as unknown as LocalConfig, "start");
    return null;
  } catch (e) {
    return e;
  } finally {
    delete (globalThis as { __wsxPortInUse?: unknown }).__wsxPortInUse;
    void real;
  }
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
