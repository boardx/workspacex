/**
 * WF03 —— Workflow 运行时的生产合成：PG 端口 + 代码图注册表（含演示 Workflow）+ 唯一 checkpointer 工厂。
 * CT06：给了 `content`（Skill 执行器 + 通知中心）时，W029 的占位图换成真正接线的 Problem-to-PRD 图
 * （Skill 阶段执行、PRD 经 effect-gateway `artifact.write` 发布、`notify.inapp` 通知发起人）。
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type pg from "pg";
import type { DatabasePort } from "../../application/ports/database.port";
import { ComposedEffectPermissionRecheck } from "../../application/workflow/effect-permission-recheck";
import { EffectGateway, type EffectReconcilePort } from "../../application/workflow/effect-gateway";
import type { NotificationPublisher } from "../../application/notifications/notification-center";
import type { ContentSkillRunnerPort } from "../../application/work-content/content-skill-runner";
import { prdPublishedNotifier, publishPrdArtifact } from "../../application/work-content/prd-publication";
import type { RunHooks } from "../../application/workflow/run-instance";
import type { SkillVersionResolverPort } from "../../application/workflow/workflow-ports";
import { WorkflowRuntimeService } from "../../application/workflow/workflow-runtime-service";
import { demoApprovalWorkflowGraph } from "./demo-approval-workflow-graph";
import { demoWorkflowGraph } from "./demo-workflow-graph";
import { PgEffectCapabilityAuthority } from "./pg-effect-capability-authority";
import { productWorkflowGraphs } from "./product-workflow-graphs";
import { problemToPrdGraph } from "./problem-to-prd-graph";
import { PgWorkflowAccess } from "./pg-workflow-access";
import { PgWorkflowDefinitionRepository } from "./pg-workflow-definition-repository";
import { PgWorkflowExpiredLeaseScanner } from "./pg-workflow-expired-lease-scanner";
import { PgWorkflowEventStore, PgWorkflowStageOutputStore } from "./pg-workflow-event-store";
import { PgWorkflowInstanceRepository } from "./pg-workflow-instance-repository";
import { PgWorkflowLeaseStore } from "./pg-workflow-lease-store";
import { PgWorkflowReceiptStore } from "./pg-workflow-receipt-store";
import { PgWorkflowTriggerStore } from "./pg-workflow-trigger-store";
import { createWorkflowCheckpointerFactory } from "./workflow-checkpointer-factory";
import { LangGraphWorkflowDriver, WorkflowGraphRegistry, type LinearWorkflowGraph } from "./workflow-graph-registry";

/**
 * Skill 版本解析：按 stableId 发布的 Skill 目录属于 work-skill-meta 束（尚未落库）。在它落地前，
 * 任何引用 Skill 的 Definition 在 start 时都诚实地得到 skill_version_unresolved（E5），不编造版本。
 */
export const UNRESOLVED_SKILL_VERSIONS: SkillVersionResolverPort = { resolve: async () => null };

export function defaultWorkflowGraphs(): LinearWorkflowGraph[] {
  return [demoWorkflowGraph(), demoApprovalWorkflowGraph(), ...productWorkflowGraphs()];
}

export interface WorkflowRuntimeOptions {
  graphs?: LinearWorkflowGraph[];
  skills?: SkillVersionResolverPort;
  holder?: string;
  leaseTtlMs?: number;
  replayWindow?: number;
  hooks?: RunHooks;
  onRunError?(instanceId: string, error: unknown): void;
  /** 生产入口的过期 lease 扫描间隔；默认 leaseTtlMs/2；0 关闭。 */
  takeoverIntervalMs?: number;
  /** WF04：按能力分类注册的只读对账实现（E1）；未注册的分类崩溃恢复时一律 unresolved。 */
  effectReconcilers?: Record<string, EffectReconcilePort>;
  /** CT06：内容线执行接线（缺省 = 只注册 CT05 的占位图，Skill 不执行、不发布）。 */
  content?: { skills: ContentSkillRunnerPort; notifications: NotificationPublisher };
}

/** 按能力分类分派对账实现；未注册的分类视为「查不到结论」（E1 → unresolved）。 */
class DispatchingEffectReconciler implements EffectReconcilePort {
  constructor(private readonly byCategory: Record<string, EffectReconcilePort>) {}
  reconcile(input: Parameters<EffectReconcilePort["reconcile"]>[0]): ReturnType<EffectReconcilePort["reconcile"]> {
    const impl = this.byCategory[input.capabilityCategory];
    return impl ? impl.reconcile(input) : Promise.resolve(null);
  }
}

export function createWorkflowRuntime(db: DatabasePort, pool: pg.Pool, opts: WorkflowRuntimeOptions = {}) {
  const access = new PgWorkflowAccess(db);
  const receipts = new PgWorkflowReceiptStore(db);
  const leases = new PgWorkflowLeaseStore(db);
  const events = new PgWorkflowEventStore(db);
  const instances = new PgWorkflowInstanceRepository(db);
  const outputs = new PgWorkflowStageOutputStore(db);
  let graphs = opts.graphs ?? defaultWorkflowGraphs();
  if (opts.content) {
    const prd = problemToPrdGraph({
      skills: opts.content.skills,
      outputs,
      instances,
      effects: () => effectGateway,
      publishArtifact: publishPrdArtifact,
      notify: prdPublishedNotifier(opts.content.notifications),
    });
    graphs = [...graphs.filter((g) => g.graphRef !== prd.graphRef), prd];
  }
  const registry = new WorkflowGraphRegistry(graphs);
  const effectGateway = new EffectGateway({
    leases,
    receipts,
    events,
    instances,
    permission: new ComposedEffectPermissionRecheck(access, new PgEffectCapabilityAuthority(db)),
    reconcile: opts.effectReconcilers ? new DispatchingEffectReconciler(opts.effectReconcilers) : undefined,
  });
  const service = new WorkflowRuntimeService({
    definitions: new PgWorkflowDefinitionRepository(db),
    instances,
    skills: opts.skills ?? UNRESOLVED_SKILL_VERSIONS,
    receipts,
    leases,
    events,
    outputs,
    access,
    expiredLeases: new PgWorkflowExpiredLeaseScanner(db),
    driver: new LangGraphWorkflowDriver(registry, createWorkflowCheckpointerFactory(pool)),
    triggers: new PgWorkflowTriggerStore(db),
    newId: () => randomUUID(),
    holder: opts.holder ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
    leaseTtlMs: opts.leaseTtlMs ?? 60_000,
    replayWindow: opts.replayWindow ?? 1000,
    hooks: opts.hooks,
    onRunError: opts.onRunError,
    // WF04（review #2）：runInstance 崩溃恢复路径靠这个字段接住 EffectInFlightError 并 reconcile()——
    // 不再是只有单测直接 `new EffectGateway(...)` 才会调用到的孤立代码。
    effectGateway,
  });
  return { service, registry, effectGateway };
}

/**
 * 生产入口：独立的 checkpoint 连接池（全部 graphRef 共用，I-9「共享连接池」），关停时先等后台推进结束再关池。
 * 返回的 service 带 `onModuleDestroy`，由 Nest 生命周期调用。
 */
export function createProductionWorkflowRuntime(db: DatabasePort, poolFactory: () => pg.Pool, opts: WorkflowRuntimeOptions = {}) {
  const pool = poolFactory();
  const { service } = createWorkflowRuntime(db, pool, opts);
  const every = opts.takeoverIntervalMs ?? Math.floor((opts.leaseTtlMs ?? 60_000) / 2);
  let scanning = false;
  const timer = every > 0
    ? setInterval(() => {
        if (scanning) return;
        scanning = true;
        service.takeOverExpired()
          .catch((e: unknown) => opts.onRunError?.("(expired-lease-scan)", e))
          .finally(() => { scanning = false; });
      }, every)
    : null;
  timer?.unref();
  return Object.assign(service, {
    async onModuleDestroy() {
      if (timer) clearInterval(timer);
      await service.drain();
      await pool.end();
    },
  });
}
