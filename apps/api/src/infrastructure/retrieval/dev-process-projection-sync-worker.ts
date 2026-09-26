/**
 * D12 —— 把 `scripts/sync-dev-process-projection.ts`（开发过程投影同步）挂进 API 的周期调度。
 * 骨架同 `telemetry/telemetry-report-worker.ts`（`setInterval(...).unref()` + 防重入）。
 *
 * **默认关**：`WSX_DEV_PROJECTION_SYNC_ORG` 未设 ⇒ 不启动计时器，启动时记一次日志。
 * 投影的权威源是仓库（git 历史 + phases/ 的 feature_list.json），只有带完整仓库 checkout 的平台
 * 实例才该打开它——哪个实例 / 哪个组织是权威，是部署决策，不在代码里猜。
 *
 * - `WSX_DEV_PROJECTION_SYNC_ORG`：写入的组织 id（如 `org-platform`）。未设 / 空 ⇒ 关。
 * - `WSX_DEV_PROJECTION_SYNC_INTERVAL_SECONDS`：周期，默认 3600，最小 60。
 *
 * 幂等：`applyProjection` 用内容哈希边 id + 删除仓库里已消失的边，重跑结果不变。
 * 周期内任何失败只记日志，不抛出（不影响实例其他功能）。
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";

export const DEV_PROJECTION_SYNC_ORG_ENV = "WSX_DEV_PROJECTION_SYNC_ORG";
export const DEV_PROJECTION_SYNC_INTERVAL_ENV = "WSX_DEV_PROJECTION_SYNC_INTERVAL_SECONDS";
export const DEV_PROJECTION_SYNC_CONFIG = Symbol("DevProjectionSyncConfig");
export const DEV_PROJECTION_SYNC_RUNNER = Symbol("DevProjectionSyncRunner");
const TRACE_ID = "dev-process-projection-sync";

export interface DevProjectionSyncConfig {
  /** null ⇒ 关闭 */
  readonly orgId: string | null;
  readonly intervalSeconds: number;
}

export function readDevProjectionSyncConfig(env: NodeJS.ProcessEnv = process.env): DevProjectionSyncConfig {
  const org = (env[DEV_PROJECTION_SYNC_ORG_ENV] ?? "").trim();
  const n = Number((env[DEV_PROJECTION_SYNC_INTERVAL_ENV] ?? "").trim());
  return {
    orgId: org === "" ? null : org,
    intervalSeconds: Number.isFinite(n) && n >= 60 ? Math.floor(n) : 3600,
  };
}

export type ProjectionSyncRunner = (orgId: string) => Promise<{ edges: number; upserted: number; removed: number }>;

/** 默认 runner：懒加载脚本（git / harness 依赖只在打开时才碰），独立 pg 连接。 */
export const scriptProjectionSyncRunner: ProjectionSyncRunner = async (orgId) => {
  const [{ buildRepoEdgeSet, applyProjection }, pg, { migrationConfig }] = await Promise.all([
    import("../../../scripts/sync-dev-process-projection"),
    import("pg"),
    import("../db/pg-config"),
  ]);
  const edges = buildRepoEdgeSet(orgId);
  const client = new pg.default.Client(migrationConfig());
  await client.connect();
  try {
    return { edges: edges.length, ...(await applyProjection(client, orgId, edges)) };
  } finally {
    await client.end();
  }
};

/** 跑一轮；失败只记日志，永不抛出。 */
export async function runProjectionSyncCycle(orgId: string, runner: ProjectionSyncRunner, logger: LoggerPort): Promise<void> {
  try {
    const r = await runner(orgId);
    logger.info("dev-process projection synced", { traceId: TRACE_ID, orgId, ...r });
  } catch (err) {
    logger.error("dev-process projection sync failed", { traceId: TRACE_ID, orgId, err });
  }
}

@Injectable()
export class DevProcessProjectionSyncWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(DEV_PROJECTION_SYNC_CONFIG) private readonly config: DevProjectionSyncConfig,
    @Inject(DEV_PROJECTION_SYNC_RUNNER) private readonly runner: ProjectionSyncRunner,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    if (!this.config.orgId) {
      this.logger.info(`dev-process projection sync disabled (${DEV_PROJECTION_SYNC_ORG_ENV} unset)`, { traceId: TRACE_ID });
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.config.intervalSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 公开给测试；防重入。 */
  async tick(): Promise<void> {
    if (this.running || !this.config.orgId) return;
    this.running = true;
    try {
      await runProjectionSyncCycle(this.config.orgId, this.runner, this.logger);
    } finally {
      this.running = false;
    }
  }
}
