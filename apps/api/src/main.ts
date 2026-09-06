/**
 * Process entry point (the other half of the composition root). See the note at the top of
 * `kernel.module.ts` about why the composition root belongs to no layer.
 */
import "reflect-metadata";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { KernelModule } from "./kernel.module";
import { traceMiddleware } from "./interface/middleware/trace";
import { attachAsrGateway } from "./interface/ws/asr-stream.gateway";
import { attachAsrDraftGateway } from "./interface/ws/asr-draft.gateway";
import { attachPersonalRealtimeAsrGateway } from "./interface/ws/personal-realtime-asr.gateway";
import { attachAgentRunEventsGateway, checkRunVisibleViaReadAgentRun } from "./interface/ws/agent-run-events.gateway";
import { ASR_PROVIDER } from "./application/recording/asr-ports";
import { PRINCIPAL_RESOLVER_PORT } from "./application/ports/principal-resolver.port";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY } from "./application/identity/ports";
import { CHAT_REPOSITORY } from "./application/chat/ports";
import { AGENT_RUN_STORE, RUN_EVENT_BUS } from "./application/agent-run/ports";
import {
  RECORDING_ID_GENERATOR,
  RECORDING_UNIT_OF_WORK,
  TRANSCRIPTION_POLICY_PROVIDER,
} from "./application/recording/session-lifecycle-ports";
import { PERSONAL_TRANSCRIPTION_REPOSITORY } from "./application/recording/personal-transcription-ports";
import { ASR_USAGE_METER, REALTIME_ASR_TICKET_STORE } from "./application/recording/personal-realtime-asr";
import { ensurePlatformSkillCatalogSeeded } from "./infrastructure/skill/ensure-platform-skill-catalog";
import { DATABASE_PORT } from "./application/ports/database.port";
import { sweepExpiredErrorLogs } from "./infrastructure/logging/pg-error-log-writer";
import { sweepOrphanedRuns } from "./infrastructure/agent-run/sweep-orphaned-runs";

/** issue #2860 —— 幽灵 run 周期回收间隔；阈值本身在 `DEFAULT_STALE_RUNNING_THRESHOLD_MS`。 */
const ORPHANED_RUN_SWEEP_INTERVAL_MS = 60_000;

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(KernelModule, {
    logger: process.env.KERNEL_QUIET === "1" ? false : ["error", "warn"],
    /**
     * #548 —— Nest 的默认值是 `abortOnError: true`，而那个 `abort` 是字面意义的
     * `process.abort()`（`@nestjs/core/nest-factory.js:118`）：**进程原地消失，不打印
     * 任何异常信息**。
     *
     * ⚠ 这不是理论上的顾虑，是实测账单。#548 给 `kernel.module` 加了一个会在缺
     *   `MODEL_CREDENTIAL_KEY` 时抛错的 provider 工厂；于是每一个 `createApp()` 的测试
     *   文件都在 `NestFactory.create` 里 `process.abort()`，vitest 侧看到的全部证据是
     *   64 条 `Error: Worker exited unexpectedly`（tinypool 的 onUnexpectedExit），
     *   **一个字都不提是哪个 provider、缺哪个变量**。CI 上表现为「跑了 5 分钟后
     *   @repo/api#test exited (1)，0 个断言失败」——一个查起来极贵的形态。
     *
     * `false` 之后：初始化异常被 rethrow 给调用方。启动**仍然失败**（这是 cipher
     *   要的语义，见 `aes-credential-cipher.ts` 文件头），只是带着消息和栈失败：
     *   进程入口这里是一个 unhandled rejection（非零退出 + 完整报错），
     *   测试里是一条能 `await expect(...).rejects` 的普通异常。
     *   反证见 `tests/capability/model/kernel-boot-fails-loudly.test.ts`。
     */
    abortOnError: false,
  });
  // Must sit outermost, ahead of the Guard: rejected requests need a traceId too
  // (see middleware/trace.ts).
  app.use(traceMiddleware);
  return app;
}

/**
 * Only listen when this file IS the process entry.
 *
 * It cannot be gated on an env var: ESM imports are hoisted, so a test that imports
 * `createApp` from here would have already started a listener before it got a chance to
 * set the variable -- leaving a stray server bound to the default port for the rest of
 * the run. Comparing against argv[1] has no such ordering hazard.
 */
function isProcessEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/**
 * 本地开发便利：把仓库根目录的 `.env.local` 灌进 `process.env`。
 *
 * ⚠ 只在**非生产**且**真是进程入口**时做——见 `isProcessEntry()` 头注同一条纪律：
 *   生产环境的机密来自 `deploy.env`（systemd `EnvironmentFile`，见
 *   `.harness/scripts/vm/provision.sh`），不该也不能依赖仓库里的这个文件；
 *   测试里 `await import("../../src/main")` 拿到 `createApp` 时这段也不该跑——
 *   一个开发者本机的 `.env.local` 不该悄悄改变测试期望看到的环境变量。
 * ⚠ 文件不存在是**最常见的正常状态**（多数贡献者不需要 GitHub issue token 之类的
 *   可选子系统），`process.loadEnvFile` 找不到文件会抛，这里吞掉、不打日志噪音——
 *   同 `lazyGithubIssueConfig` 头注"可选子系统缺配置不该拖垮启动"那条理由。
 * ⚠ `process.loadEnvFile` 不会覆盖已经存在的 `process.env[key]`——shell 里手动
 *   `export` 过的值，或部署环境本来就设置的值，优先级仍然更高。
 */
function loadLocalEnvFileForDev(): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env.local", import.meta.url)));
  } catch {
    // 没有这个文件 / 解析失败——都不是需要打断启动的事，见函数头注。
  }
}

/**
 * #466 —— the WS surface, attached to the SAME http server the controllers run on.
 *
 * ## Why it is wired here and not as a Nest "gateway"
 *
 * `@nestjs/websockets` would add a second HTTP-adjacent framework to the composition (and a
 * second dependency, and a second lifecycle) for one route. `ws` with `noServer: true`
 * hooked onto the Express server's `upgrade` event IS the whole mechanism, and it keeps the
 * one thing that matters: the handshake authenticates through the same
 * `PrincipalResolverPort` instance every HTTP request does, so there is no second answer to
 * "who is this".
 *
 * ⚠ Attached after `listen()`, not inside `createApp()`: many kernel test files build an app
 *   without ever listening, and hanging a socket server off a server that never binds leaves
 *   a listener nobody closes.
 */
export function attachStreamingSurfaces(app: NestExpressApplication): void {
  attachAsrGateway(app.getHttpServer(), {
    principals: app.get(PRINCIPAL_RESOLVER_PORT),
    identities: app.get(IDENTITY_REPOSITORY),
    uow: app.get(RECORDING_UNIT_OF_WORK),
    policies: app.get(TRANSCRIPTION_POLICY_PROVIDER),
    ids: app.get(RECORDING_ID_GENERATOR),
    asr: app.get(ASR_PROVIDER),
  });
  // issue #726 —— composer 麦克风的草稿 ASR 面，复用同一个 `ASR_PROVIDER`，不落库。
  // 见 `interface/ws/asr-draft.gateway.ts` 头注：为什么它不是给 streamAsr 加个可选 sessionId。
  attachAsrDraftGateway(app.getHttpServer(), {
    principals: app.get(PRINCIPAL_RESOLVER_PORT),
    asr: app.get(ASR_PROVIDER),
  });
  attachPersonalRealtimeAsrGateway(app.getHttpServer(), {
    tickets: app.get(REALTIME_ASR_TICKET_STORE),
    repository: app.get(PERSONAL_TRANSCRIPTION_REPOSITORY),
    provider: app.get(ASR_PROVIDER),
    usage: app.get(ASR_USAGE_METER),
    ids: app.get(RECORDING_ID_GENERATOR),
  });
  // Phase 14 F03 (`streaming-transport` 契约束 UC-1) -- `WS /agent-runs/:runId/events`。
  // 与上面三条既有流式面共用同一个 HTTP server 的 `upgrade` 事件，同一个
  // `PRINCIPAL_RESOLVER_PORT`；`RUN_EVENT_BUS` 是与 `AGENT_RUN_EXECUTOR`（publish 侧）
  // 共享的同一个单例（见 `kernel.module.ts` 该 provider 的注册注释）。
  attachAgentRunEventsGateway(app.getHttpServer(), {
    principals: app.get(PRINCIPAL_RESOLVER_PORT),
    checkRunVisible: checkRunVisibleViaReadAgentRun({
      repo: app.get(IDENTITY_REPOSITORY),
      ids: app.get(DECISION_ID_FACTORY),
      chat: app.get(CHAT_REPOSITORY),
      runs: app.get(AGENT_RUN_STORE),
    }),
    events: app.get(RUN_EVENT_BUS),
  });
}

if (isProcessEntry()) {
  loadLocalEnvFileForDev();
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3200);
  await app.listen(port);
  attachStreamingSurfaces(app);
  process.stdout.write(`api listening on ${port}\n`);

  /**
   * issue #2343 —— 平台组织 + 四个官方 skill（pptx/docx/xlsx/pdf-create）的自愈种子，
   * 挂在真实进程入口，不挂在 `createApp()` 本体（那样每一个调 `createApp()` 的测试
   * 文件都会顺带打一次这两个函数，既拖慢测试、又把种子数据种进每一条测试隔离库——
   * `backfill-platform-org.ts` 自己的文件头刚好记录过 2026-08-26 那次同类事故）。
   * `isProcessEntry()` 只在 `workspacex-api` 真的作为独立进程启动时为真，测试里
   * `await import("../../src/main")` 拿到的 `createApp` 不会触发这个分支。
   *
   * 见 `ensure-platform-skill-catalog.ts` 文件头：这是为什么这段自愈逻辑存在的
   * 完整事故复盘（`deploy.sh` 4i/4j 两步依赖的"部署脚本已刷新"这个前提在真实部署里
   * 从未成立过，`pdf-create` 等四个 skill 因此在 devapp 上从未真正落库）。
   *
   * 放在 `app.listen()` 之后：不阻塞服务开始接受流量——两个函数各自只有几条
   * `ON CONFLICT DO NOTHING` 的 INSERT，几毫秒内收敛，早几毫秒还是晚几毫秒
   * 开始接受请求不影响正确性。`ensurePlatformSkillCatalogSeeded` 自己的契约是
   * 「从不 throw」，这里仍然只记日志、不让这段自愈逻辑的失败拖累已经成功启动的
   * 服务——一次数据库抖动不该把「skill 目录暂时没种上」变成「API 打不开」。
   */
  const seed = await ensurePlatformSkillCatalogSeeded();
  if (seed.ok) {
    const { org, skills } = seed.report;
    process.stdout.write(
      `platform skill catalog: org ${org.orgCreated ? "created" : "already existed"}, ` +
      `skills created=[${skills.created.join(",")}] alreadyExisted=[${skills.alreadyExisted.join(",")}]\n`,
    );
  } else {
    console.error("platform skill catalog self-heal failed (will retry on next boot):", seed.error);
  }

  /**
   * `error_logs` retention self-heal (2026-09-01 review finding #2, PR #2444) -- same shape
   * and same placement rationale as the platform-skill seed just above: never throws, runs
   * after `app.listen()` so it cannot delay accepting traffic, and only fires on a real
   * process start (`isProcessEntry()`, not under `await import("../../src/main")` in tests).
   * `pg-error-log-writer.ts`'s file header explains why this is a SECOND independent trigger
   * for the same sweep, not the only one -- a low-write-volume deployment that never restarts
   * is the one gap neither trigger closes; that is documented there, not hidden here.
   */
  const swept = await sweepExpiredErrorLogs(app.get(DATABASE_PORT));
  if (!swept.ok) {
    console.error("error_logs retention sweep failed (will retry on next boot or write cadence):", swept.error);
  }
  // issue #2860 —— 幽灵 run 回收：启动时一次（上一个进程死时正在跑的 run 此刻心跳已停），
  // 之后每分钟一次（本进程活着但某个 run 的执行链意外断掉——理论上 executeQueuedRuns 的
  // finally 会兜住，这一层是保险）。见 `sweep-orphaned-runs.ts` 头注。
  const sweepOrphans = async (): Promise<void> => {
    try {
      await sweepOrphanedRuns(app.get(DATABASE_PORT), { log: (msg, detail) => console.warn(msg, detail ?? "") });
    } catch (e) {
      console.error("orphaned agent run sweep failed:", e);
    }
  };
  await sweepOrphans();
  setInterval(() => void sweepOrphans(), ORPHANED_RUN_SWEEP_INTERVAL_MS).unref();
}
