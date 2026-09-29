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
 *
 * WF05 人工门（R3 第 6 步）：阶段定义了 humanGate 且该 (stage, attempt) 的门尚未批准时，worker 在阶段工作
 * **之前**写 `gate_opened`（含副作用预览）并把实例置 awaiting_gate_decision，然后停下、释放 lease——图在该
 * 节点处中断，checkpoint 停在前一阶段（LangGraph 语义上的 interrupt）。approve 后重新取 lease 从 checkpoint
 * 续跑，重进该阶段时看到已批准的门才执行工作；阶段内副作用照常走 effect-gateway 重查权限。
 * 被拒绝（前向 onDenyStageId）越过的阶段只记 skipped，不执行工作、不产生 effect receipt。
 */
import type { PinnedSkillVersion, WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import { EffectInFlightError, EffectPermissionBlockedError, type EffectGateway } from "./effect-gateway";
import { defaultGatePreview, deriveGates, gateIdOf, skippedByDenial, type GateEffectPreview } from "./human-gate-state";
import { isTerminal } from "./instance-projection";
import type { PinnedWorkflowInstance, WorkflowDefinitionRepository, WorkflowInstanceRepository, WorkflowLease, WorkflowLeaseStore } from "./workflow-ports";
import type { WorkflowEventInput, WorkflowEventStore, WorkflowEventType, WorkflowStageOutputStore } from "./workflow-runtime-ports";

export interface StageExecution {
  instanceId: string;
  stageId: string;
  attempt: number;
  input: Record<string, unknown>;
  pinnedSkills: PinnedSkillVersion[];
  /** 本次执行持有的 lease：阶段内调用 effect-gateway 时原样传入（E2）。 */
  lease: WorkflowLease;
  /** WF05：经过人工门时的审批决定（写入副作用 provenance）；无门为 null。 */
  approval: { gateId: string; decidedBy: string } | null;
}

/** 阶段可选的门预览（gate_opened 事件内容）；不得含密钥/凭证（I-15）。 */
export type StageGatePreview = (exec: Omit<StageExecution, "approval">) => GateEffectPreview | Promise<GateEffectPreview>;

export type StageWork = (exec: StageExecution) => Promise<{ label: string; content: Record<string, unknown> }>;
export type StageRunner = (stageId: string, work: StageWork, opts?: { gatePreview?: StageGatePreview }) => Promise<{ outputId: string }>;

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
  /** lease TTL：每个 checkpoint 边界与后台心跳都按它续租（epoch 保持的 CAS），长阶段不会因固定 TTL 失去 lease。 */
  leaseTtlMs?: number;
  /**
   * WF04（review #2）：崩溃恢复的生产入口。某个阶段的 `work()` 内部调用 effect-gateway 时，若命中
   * 未 finalize 的 begin（`EffectInFlightError`），这里统一调用 `reconcile()`——不留给具体某个阶段
   * 的实现各自记得接，也不只在单测里被直接调用。未接（未传本字段）时按原样把 `EffectInFlightError`
   * 冒泡给 `onRunError`，lease 不释放，行为与其他未知错误一致（不是本次修复引入的新退化）。
   */
  effectGateway?: EffectGateway;
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
  const ttlMs = deps.leaseTtlMs;
  /** 续租即断言：被接管/已过期 → WorkflowLeaseLostError。无 TTL 配置时退化为纯断言。 */
  const holdLease = () => (ttlMs ? deps.leases.renew(lease, ttlMs) : deps.leases.assertLease(lease));
  const checkpointBoundary = async () => {
    await holdLease();
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

  const gates = deriveGates(log);
  const skipped = skippedByDenial(definition, gates.values());

  /** WF05：返回审批决定（可继续）；门未开 → 开门并挂起；门未决 → 挂起。 */
  const passGate = async (stageId: string, attempt: number, gatePreview?: StageGatePreview) => {
    const stageDef = definition.stages.find((s) => s.stageId === stageId);
    if (!stageDef?.humanGate) return null;
    const gateId = gateIdOf(stageId, attempt);
    const current = deriveGates(await deps.events.listAfter(orgId, instanceId, 0, 100_000)).get(gateId);
    if (current?.decision === "approved") return { gateId, decidedBy: current.decidedBy ?? "" };
    if (!current) {
      const base = { instanceId, stageId, attempt, input, pinnedSkills: pinnedOf(stageId), lease };
      const effectPreview = gatePreview ? await gatePreview(base) : defaultGatePreview(stageDef);
      await append(
        { type: "gate_opened", stageId, reasonCode: null, data: { gateId, attempt, effectPreview } },
        { status: "awaiting_gate_decision", reasonCode: null },
      );
    }
    throw new StopRun("awaiting_gate_decision");
  };
  const pinnedOf = (stageId: string) => instance.pinnedSkills.filter((p) => p.stageId === stageId).map((p) => ({ ...p }));

  const stage: StageRunner = async (stageId, work, opts) => {
    const attempt = 1;
    await checkpointBoundary();
    if (skipped.has(stageId)) {
      // A4：被拒绝越过的阶段——不执行工作、不产生副作用，只留痕。
      if (!(await logged(stageId, attempt, "stage_succeeded"))) {
        await append({ type: "stage_succeeded", stageId, reasonCode: "gate_denied", data: { attempt, skipped: true } });
      }
      return { outputId: "" };
    }
    const approval = await passGate(stageId, attempt, opts?.gatePreview);
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
        pinnedSkills: pinnedOf(stageId),
        lease,
        approval,
      });
      await holdLease(); // 写业务行前再判一次 epoch（并续租）
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

  // 后台心跳：阶段内的长耗时工作（真实模型延迟）期间按 ttl/3 续租；续租失败即停，下一个边界的断言会抛出。
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  if (ttlMs) {
    heartbeat = setInterval(() => {
      deps.leases.renew(lease, ttlMs).catch(() => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      });
    }, Math.max(1, Math.floor(ttlMs / 3)));
    heartbeat.unref?.();
  }
  try {
    await checkpointBoundary();
    const outcome = await deps.driver.run({ instance, input, stage, allowFreshStart });
    await holdLease();
    if (outcome === "completed") {
      await append({ type: "status_changed", stageId: null, reasonCode: null, data: { status: "succeeded" } }, { status: "succeeded", reasonCode: null });
    } else {
      await append(
        { type: "status_changed", stageId: null, reasonCode: "checkpoint_missing", data: { status: "needs_attention" } },
        { status: "needs_attention", reasonCode: "checkpoint_missing" },
      );
    }
  } catch (e) {
    if (e instanceof EffectInFlightError && deps.effectGateway) {
      // 生产恢复路径（review #2）：不重放调用，统一走 reconcile()（E1）。`reconciled` → receipt 迁
      // 终态，之后接管者重进该 stage 时 begin() 按 replay 处理（见 pg-workflow-receipt-store.ts），
      // 不会再撞同一个 EffectInFlightError；`unresolved`/无 reconciler → reconcile() 内部已经把实例
      // 落成 needs_attention（WORKFLOW_TERMINAL_STATUSES 之一），过期扫描器的查询条件天然不再挑中
      // 它，接管循环到此为止，不会无限重试（不是本次之前那种「每次都从头撞同一个错误」）。
      // lease 有意不释放：`needs_attention`/维持 `running` 都要交给下一次接管者（或人工「从该阶段
      // 重试」）续跑，而不是释放后连 `wf_expired_lease_instances` 都不会再挑到它。
      await deps.effectGateway.reconcile({
        orgId,
        instanceId,
        stageId: e.stageId,
        effectKey: e.effectKey,
        capabilityCategory: e.capabilityCategory,
      });
      return (await deps.instances.find(orgId, instanceId))?.status ?? "running";
    }
    // E4：阶段内副作用被权限重查拦下——effect-gateway 已把实例置 blocked_permission，本次推进到此为止。
    if (!(e instanceof StopRun) && !(e instanceof EffectPermissionBlockedError)) throw e; // 崩溃/意外错误：不释放 lease，由过期后的接管者恢复
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
  await deps.leases.release(lease);
  return (await deps.instances.find(orgId, instanceId))?.status ?? "cancelled";
}
