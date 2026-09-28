/**
 * WF03 —— Workflow 运行时门面：把 start / cancel / resume / projection / SSE 读侧与后台 worker 绑到同一组端口上。
 * interface 层（controller）只依赖本类（经 DI token），不 import infrastructure。
 */
import type { WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";
import { openEventStream, type WorkflowEventCursor } from "./event-stream";
import { cancelInstance, resumeInstance, startInstance, type InstanceCommandDeps, type StartInstanceResponse, type StateResponse } from "./instance-commands";
import { getInstanceProjection } from "./instance-projection";
import { runInstance, type RunHooks, type WorkflowGraphDriver } from "./run-instance";
import type { WorkflowLease } from "./workflow-ports";
import type { WorkflowStageOutputStore } from "./workflow-runtime-ports";

export const WORKFLOW_RUNTIME_SERVICE = Symbol("WORKFLOW_RUNTIME_SERVICE");

export interface WorkflowRuntimeServiceDeps extends Omit<InstanceCommandDeps, "dispatcher"> {
  outputs: WorkflowStageOutputStore;
  driver: WorkflowGraphDriver;
  /** 断线重连时可逐条补发的最大差距；超出先发 snapshot。 */
  replayWindow: number;
  onRunError?(instanceId: string, error: unknown): void;
  hooks?: RunHooks;
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

  /** 等待本进程内所有后台推进结束（关停 / 测试）。 */
  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }
}
