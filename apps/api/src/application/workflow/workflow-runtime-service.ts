/**
 * WF03 —— Workflow 运行时门面：把 start / cancel / resume / projection / SSE 读侧与后台 worker 绑到同一组端口上。
 * interface 层（controller）只依赖本类（经 DI token），不 import infrastructure。
 */
import type { WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";
import { deliverScheduledWorkflowTrigger, type ScheduledTriggerJob } from "./deliver-scheduled-trigger";
import { triggerWebhook, type TriggerWebhookCommand, type TriggerWebhookResponse } from "./trigger-webhook";
import type { WorkflowTriggerStore } from "./workflow-trigger-ports";
import type { EffectGateway } from "./effect-gateway";
import { openEventStream, type WorkflowEventCursor } from "./event-stream";
import { cancelInstance, resumeInstance, startInstance, type InstanceCommandDeps, type StartInstanceResponse, type StateResponse } from "./instance-commands";
import { approveGate, denyGate, type GateDecisionResponse } from "./gate-commands";
import { getInstanceProjection } from "./instance-projection";
import { runInstance, type RunHooks, type WorkflowGraphDriver } from "./run-instance";
import type { WorkflowLease } from "./workflow-ports";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowExpiredLeaseScanner, WorkflowStageOutputStore } from "./workflow-runtime-ports";

export const WORKFLOW_RUNTIME_SERVICE = Symbol("WORKFLOW_RUNTIME_SERVICE");

/** WF06：未接线 `triggers`（旧调用点/未涉及触发器的测试）时,webhook/定时唤醒一律「触发器不存在」。 */
const NO_TRIGGERS: WorkflowTriggerStore = { find: async () => null };

export interface WorkflowRuntimeServiceDeps extends Omit<InstanceCommandDeps, "dispatcher"> {
  outputs: WorkflowStageOutputStore;
  driver: WorkflowGraphDriver;
  /** 断线重连时可逐条补发的最大差距；超出先发 snapshot。 */
  replayWindow: number;
  onRunError?(instanceId: string, error: unknown): void;
  hooks?: RunHooks;
  /** R3 过期 lease 接管的跨组织扫描；未提供时 takeOverExpired 为空操作。 */
  expiredLeases?: WorkflowExpiredLeaseScanner;
  /** WF04（review #2）：透传给 `runInstance`，让崩溃恢复路径能对 `EffectInFlightError` 做 reconcile()。 */
  effectGateway?: EffectGateway;
  /** WF06：webhook 触发（UC-WR-13）与 pg-boss 定时唤醒（UC-WR-I4）共用的触发器读端口；未提供时两者都「不存在」。 */
  triggers?: WorkflowTriggerStore;
  /** WF06 webhook：当前时间（秒），测试注入。 */
  webhookNow?(): number;
}

export class WorkflowRuntimeService {
  private readonly running = new Set<Promise<unknown>>();
  private readonly commandDeps: InstanceCommandDeps;
  private readonly triggers: WorkflowTriggerStore;

  constructor(private readonly deps: WorkflowRuntimeServiceDeps) {
    this.commandDeps = { ...deps, dispatcher: { dispatch: (lease) => this.dispatch(lease) } };
    this.triggers = deps.triggers ?? NO_TRIGGERS;
  }

  start(orgId: string, userId: string, pathKey: string, body: unknown): Promise<StartInstanceResponse> {
    return startInstance(this.commandDeps, { orgId, userId, pathKey, body });
  }

  /** WF06 UC-WR-13：webhook 触发。签名/窗口失败或触发器不存在 → 抛 WorkflowUseCaseError,不建实例。 */
  webhook(cmd: TriggerWebhookCommand): Promise<TriggerWebhookResponse> {
    return triggerWebhook({ ...this.commandDeps, triggers: this.triggers, now: this.deps.webhookNow }, cmd);
  }

  /** WF06 UC-WR-I4：pg-boss `{kind:'workflow',triggerId}` 到期唤醒;非本函数认领的 payload / 触发器已不存在则安静跳过。 */
  deliverScheduledTrigger(job: ScheduledTriggerJob): Promise<void> {
    return deliverScheduledWorkflowTrigger({ ...this.commandDeps, triggers: this.triggers }, job);
  }

  cancel(orgId: string, userId: string, instanceId: string, body: unknown): Promise<StateResponse> {
    return cancelInstance(this.commandDeps, { orgId, userId, instanceId, body });
  }

  resume(orgId: string, userId: string, instanceId: string, body: unknown): Promise<StateResponse> {
    return resumeInstance(this.commandDeps, { orgId, userId, instanceId, body });
  }

  /** WF05 UC-WR-11。 */
  approveGate(orgId: string, userId: string, instanceId: string, gateId: string, body: unknown): Promise<GateDecisionResponse> {
    return approveGate(this.commandDeps, { orgId, userId, instanceId, gateId, body });
  }

  /** WF05 UC-WR-12。 */
  denyGate(orgId: string, userId: string, instanceId: string, gateId: string, body: unknown): Promise<GateDecisionResponse> {
    return denyGate(this.commandDeps, { orgId, userId, instanceId, gateId, body });
  }

  get(orgId: string, userId: string, instanceId: string): Promise<WorkflowInstanceProjection> {
    return getInstanceProjection(this.deps, { orgId, userId, instanceId });
  }

  stream(orgId: string, userId: string, instanceId: string, lastEventId?: number): Promise<WorkflowEventCursor> {
    return openEventStream(this.deps, { orgId, userId, instanceId, lastEventId, replayWindow: this.deps.replayWindow });
  }

  /** 在本进程后台推进实例；错误交给 onRunError（lease 不释放，过期后可被接管）。 */
  dispatch(lease: WorkflowLease): void {
    const p = runInstance(this.deps, lease).catch((e: unknown) => this.deps.onRunError?.(lease.instanceId, e));
    this.running.add(p);
    void p.finally(() => this.running.delete(p));
  }

  /**
   * R3「进程重启后 lease 过期的实例由 worker 接管 resume」：扫描过期 lease，逐个经 epoch CAS 获取后在本进程推进
   * （从最后 checkpoint 续跑，与 resume API 同一条 runInstance 路径）。输给别的 worker（lease_conflict）
   * 或实例已不在（workflow_not_found）视为正常，跳过。返回本轮接管的实例数。
   */
  async takeOverExpired(limit = 50): Promise<number> {
    const scanner = this.deps.expiredLeases;
    if (!scanner) return 0;
    let taken = 0;
    for (const { orgId, instanceId } of await scanner.expired(limit)) {
      let lease: WorkflowLease;
      try {
        lease = await this.deps.leases.acquire({ orgId, instanceId, holder: this.deps.holder, ttlMs: this.deps.leaseTtlMs });
      } catch (e) {
        if (e instanceof WorkflowUseCaseError && (e.code === "lease_conflict" || e.code === "workflow_not_found")) continue;
        throw e;
      }
      this.dispatch(lease);
      taken++;
    }
    return taken;
  }

  /** 等待本进程内所有后台推进结束（关停 / 测试）。 */
  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }
}
