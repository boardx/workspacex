/**
 * WF03 —— 运行时 worker 推进实例（requirements 02 R3 第 3、4、9、10 步；R4 E2/E10/E11）。
 *
 * 顺序纪律（ADR-118 第 4 条）：每个阶段先把业务产出写进 workflow_stage_outputs、记事件，节点才返回；
 * 图驱动（LangGraph）在节点返回后才写 checkpoint，checkpoint 里只有 outputId 指针。
 * 所以崩溃发生在「产出已写、checkpoint 未推进」之间时，恢复会重进该阶段，命中既有产出行直接复用，
 * 业务工作不重做、事件不重记（按 stage/attempt 查已记事件）。
 *
 * 每个阶段开始前、写业务行前都 assertLease（E2：epoch 被接管后不产生任何写）；
 * 取消在阶段边界生效：cancelling → cancelled（reasonCode cancel_requested）。
 */
import type { PinnedSkillVersion, WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import { isTerminal } from "./instance-projection";
import type { PinnedWorkflowInstance, WorkflowDefinitionRepository, WorkflowInstanceRepository, WorkflowLease, WorkflowLeaseStore } from "./workflow-ports";
import type { WorkflowEventInput, WorkflowEventStore, WorkflowEventType, WorkflowStageOutputStore } from "./workflow-runtime-ports";

export interface StageExecution {
  instanceId: string;
  stageId: string;
  attempt: number;
  input: Record<string, unknown>;
  pinnedSkills: PinnedSkillVersion[];
}

export type StageWork = (exec: StageExecution) => Promise<{ label: string; content: Record<string, unknown> }>;
export type StageRunner = (stageId: string, work: StageWork) => Promise<{ outputId: string }>;

/** 图驱动端口：按实例冻结的 graphRef 执行；有 checkpoint 则从 checkpoint 续跑。 */
export interface WorkflowGraphDriver {
  run(args: {
    instance: PinnedWorkflowInstance;
    input: Record<string, unknown>;
    stage: StageRunner;
    /** false = 已有证据表明曾提交过 checkpoint；此时找不到 checkpoint 必须报 checkpoint_missing（E11）。 */
    allowFreshStart: boolean;
  }): Promise<"completed" | "checkpoint_missing">;
}

/** 故障注入点（崩溃恢复测试用；生产不传）。 */
export interface RunHooks {
  beforeStageWork?(stageId: string): void | Promise<void>;
  afterStageOutput?(stageId: string): void | Promise<void>;
}

export interface RunInstanceDeps {
  definitions: WorkflowDefinitionRepository;
  instances: WorkflowInstanceRepository;
  events: WorkflowEventStore;
  outputs: WorkflowStageOutputStore;
  leases: WorkflowLeaseStore;
  driver: WorkflowGraphDriver;
  newId(): string;
  hooks?: RunHooks;
}

/** 实例已被取消/进入终态：停止推进（不是错误）。 */
class StopRun extends Error {
  constructor(readonly status: WorkflowInstanceStatus) {
    super(`workflow run stopped: ${status}`);
  }
}

export async function runInstance(deps: RunInstanceDeps, lease: WorkflowLease): Promise<WorkflowInstanceStatus> {
  const { orgId, instanceId } = lease;
  const instance = await deps.instances.find(orgId, instanceId);
  if (!instance) throw new Error(`workflow instance ${instanceId} not found`);
  if (isTerminal(instance.status)) {
    await deps.leases.release(lease);
    return instance.status;
  }
  const definition = await deps.definitions.findVersion(orgId, instance.workflowKey, instance.definitionVersion);
  if (!definition) throw new Error(`pinned definition ${instance.graphRef} missing`);
  const log = await deps.events.listAfter(orgId, instanceId, 0, 100_000);
  const started = log.find((e) => e.type === "instance_started");
  const input = (started?.data.input ?? {}) as Record<string, unknown>;
  const firstStage = definition.stages[0]!.stageId;
  const allowFreshStart = !log.some((e) => e.type === "stage_started" && e.stageId !== firstStage);

  const logged = async (stageId: string, attempt: number, type: WorkflowEventType): Promise<boolean> =>
    deps.events.hasStageEvent(orgId, instanceId, type, stageId, attempt);
  const append = async (event: WorkflowEventInput, opts?: Parameters<WorkflowEventStore["append"]>[3]) => {
    const r = await deps.events.append(orgId, instanceId, event, opts);
    if (!r.ok) throw new StopRun((await deps.instances.find(orgId, instanceId))?.status ?? "cancelled");
    return r;
  };
  const checkpointBoundary = async () => {
    await deps.leases.assertLease(lease);
    const current = await deps.instances.find(orgId, instanceId);
    if (!current || isTerminal(current.status)) throw new StopRun(current?.status ?? "cancelled");
    if (current.status === "cancelling") {
      await append(
        { type: "status_changed", stageId: null, reasonCode: "cancel_requested", data: { status: "cancelled" } },
        { status: "cancelled", reasonCode: "cancel_requested" },
      );
      throw new StopRun("cancelled");
    }
  };

  const stage: StageRunner = async (stageId, work) => {
    const attempt = 1;
    await checkpointBoundary();
    if (!(await logged(stageId, attempt, "stage_started"))) {
      await append({ type: "stage_started", stageId, reasonCode: null, data: { attempt } });
    }
    let row = await deps.outputs.find(orgId, instanceId, stageId, attempt);
    if (!row) {
      await deps.hooks?.beforeStageWork?.(stageId);
      const result = await work({
        instanceId,
        stageId,
        attempt,
        input,
        pinnedSkills: instance.pinnedSkills.filter((p) => p.stageId === stageId).map((p) => ({ ...p })),
      });
      await deps.leases.assertLease(lease); // 写业务行前再判一次 epoch
      row = (await deps.outputs.put(orgId, instanceId, { stageId, attempt, outputId: deps.newId(), ...result })).row;
    }
    if (!(await logged(stageId, attempt, "stage_output_written"))) {
      await append({ type: "stage_output_written", stageId, reasonCode: null, data: { attempt, outputId: row.outputId, label: row.label } });
    }
    await deps.hooks?.afterStageOutput?.(stageId);
    if (!(await logged(stageId, attempt, "stage_succeeded"))) {
      await append({ type: "stage_succeeded", stageId, reasonCode: null, data: { attempt, outputId: row.outputId } });
    }
    return { outputId: row.outputId };
  };

  try {
    await checkpointBoundary();
    const outcome = await deps.driver.run({ instance, input, stage, allowFreshStart });
    await deps.leases.assertLease(lease);
    if (outcome === "completed") {
      await append({ type: "status_changed", stageId: null, reasonCode: null, data: { status: "succeeded" } }, { status: "succeeded", reasonCode: null });
    } else {
      await append(
        { type: "status_changed", stageId: null, reasonCode: "checkpoint_missing", data: { status: "needs_attention" } },
        { status: "needs_attention", reasonCode: "checkpoint_missing" },
      );
    }
  } catch (e) {
    if (!(e instanceof StopRun)) throw e; // 崩溃/意外错误：不释放 lease，由过期后的接管者恢复
  }
  await deps.leases.release(lease);
  return (await deps.instances.find(orgId, instanceId))?.status ?? "cancelled";
}
