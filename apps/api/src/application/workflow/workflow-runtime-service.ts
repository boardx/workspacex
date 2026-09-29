/**
 * WF03 —— Workflow 运行时门面：把 start / cancel / resume / projection / SSE 读侧与后台 worker 绑到同一组端口上。
 * interface 层（controller）只依赖本类（经 DI token），不 import infrastructure。
 */
import type { WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";
import type { EffectGateway } from "./effect-gateway";
import { openEventStream, type WorkflowEventCursor } from "./event-stream";
import { cancelInstance, resumeInstance, startInstance, type InstanceCommandDeps, type StartInstanceResponse, type StateResponse } from "./instance-commands";
import { getInstanceProjection } from "./instance-projection";
import { runInstance, type RunHooks, type WorkflowGraphDriver } from "./run-instance";
import type { WorkflowLease } from "./workflow-ports";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowExpiredLeaseScanner, WorkflowStageOutputStore } from "./workflow-runtime-ports";

export const WORKFLOW_RUNTIME_SERVICE = Symbol("WORKFLOW_RUNTIME_SERVICE");

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
}

export class WorkflowRuntimeService {
  private readonly running = new Set<Promise<unknown>>();
  private readonly commandDeps: InstanceCommandDeps;

  constructor(private readonly deps: WorkflowRuntimeServiceDeps) {
    this.commandDeps = { ...deps, dispatcher: { dispatch: (lease) => this.dispatch(lease) } };
  }

  start(orgId: string, userId: string, pathKey: string, body: unknown): Promise<StartInstanceResponse> {
    return startInstance(this.commandDeps, { orgId, userId, pathKey, body });
  }

  cancel(orgId: string, userId: string, instanceId: string, body: unknown): Promise<StateResponse> {
    return cancelInstance(this.commandDeps, { orgId, userId, instanceId, body });
  }

  resume(orgId: string, userId: string, instanceId: string, body: unknown): Promise<StateResponse> {
    return resumeInstance(this.commandDeps, { orgId, userId, instanceId, body });
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
