/**
 * WF03 —— Workflow 运行时的生产合成：PG 端口 + 代码图注册表（含演示 Workflow）+ 唯一 checkpointer 工厂。
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type pg from "pg";
import type { DatabasePort } from "../../application/ports/database.port";
import type { RunHooks } from "../../application/workflow/run-instance";
import type { SkillVersionResolverPort } from "../../application/workflow/workflow-ports";
import { WorkflowRuntimeService } from "../../application/workflow/workflow-runtime-service";
import { demoWorkflowGraph } from "./demo-workflow-graph";
import { PgWorkflowAccess } from "./pg-workflow-access";
import { PgWorkflowDefinitionRepository } from "./pg-workflow-definition-repository";
import { PgWorkflowEventStore, PgWorkflowStageOutputStore } from "./pg-workflow-event-store";
import { PgWorkflowInstanceRepository } from "./pg-workflow-instance-repository";
import { PgWorkflowLeaseStore } from "./pg-workflow-lease-store";
import { PgWorkflowReceiptStore } from "./pg-workflow-receipt-store";
import { createWorkflowCheckpointerFactory } from "./workflow-checkpointer-factory";
import { LangGraphWorkflowDriver, WorkflowGraphRegistry, type LinearWorkflowGraph } from "./workflow-graph-registry";

/**
 * Skill 版本解析：按 stableId 发布的 Skill 目录属于 work-skill-meta 束（尚未落库）。在它落地前，
 * 任何引用 Skill 的 Definition 在 start 时都诚实地得到 skill_version_unresolved（E5），不编造版本。
 */
export const UNRESOLVED_SKILL_VERSIONS: SkillVersionResolverPort = { resolve: async () => null };

export function defaultWorkflowGraphs(): LinearWorkflowGraph[] {
  return [demoWorkflowGraph()];
}

export interface WorkflowRuntimeOptions {
  graphs?: LinearWorkflowGraph[];
  skills?: SkillVersionResolverPort;
  holder?: string;
  leaseTtlMs?: number;
  replayWindow?: number;
  hooks?: RunHooks;
  onRunError?(instanceId: string, error: unknown): void;
}

export function createWorkflowRuntime(db: DatabasePort, pool: pg.Pool, opts: WorkflowRuntimeOptions = {}) {
  const registry = new WorkflowGraphRegistry(opts.graphs ?? defaultWorkflowGraphs());
  const service = new WorkflowRuntimeService({
    definitions: new PgWorkflowDefinitionRepository(db),
    instances: new PgWorkflowInstanceRepository(db),
    skills: opts.skills ?? UNRESOLVED_SKILL_VERSIONS,
    receipts: new PgWorkflowReceiptStore(db),
    leases: new PgWorkflowLeaseStore(db),
    events: new PgWorkflowEventStore(db),
    outputs: new PgWorkflowStageOutputStore(db),
    access: new PgWorkflowAccess(db),
    driver: new LangGraphWorkflowDriver(registry, createWorkflowCheckpointerFactory(pool)),
    newId: () => randomUUID(),
    holder: opts.holder ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
    leaseTtlMs: opts.leaseTtlMs ?? 60_000,
    replayWindow: opts.replayWindow ?? 1000,
    hooks: opts.hooks,
    onRunError: opts.onRunError,
  });
  return { service, registry };
}

/**
 * 生产入口：独立的 checkpoint 连接池（全部 graphRef 共用，I-9「共享连接池」），关停时先等后台推进结束再关池。
 * 返回的 service 带 `onModuleDestroy`，由 Nest 生命周期调用。
 */
export function createProductionWorkflowRuntime(db: DatabasePort, poolFactory: () => pg.Pool, opts: WorkflowRuntimeOptions = {}) {
  const pool = poolFactory();
  const { service } = createWorkflowRuntime(db, pool, opts);
  return Object.assign(service, {
    async onModuleDestroy() {
      await service.drain();
      await pool.end();
    },
  });
}
