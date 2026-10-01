/**
 * WF05 —— UC-WR-11 approveGate / UC-WR-12 denyGate（requirements 02 R3 第 6/7 步；R4 A4/A5/E13；domain I-17）。
 *
 * 判定顺序（每一步失败都落进 receipt，同 requestId 重试得到同一个响应，A1）：
 *   1. 形状：deny 缺理由 → 422 deny_reason_required；其它形状错误 → 400。
 *   2. 调用者须是本组织成员（否则 404，不暴露实例存在）；实例 / 门不存在 → 404 / 409 gate_not_open。
 *   3. 资格（E13）：非指定审批人 → 403 not_designated_approver；发起人默认不能自批 → 403 self_approval_forbidden。
 *   4. 门已决定 → 409 gate_already_decided（带 decidedGate，A5）。
 *   5. expectedStateVersion 过期 → 409 state_version_conflict（带 latestProjection，E3）。
 *   6. 实例不在 awaiting_gate_decision → 409 gate_not_open。
 *   7. 以 expectedStateVersion 为 CAS 追加 `gate_decided`（锁实例行）。两人同时审批：后到者 CAS 落空，
 *      重读后看到门已决定 → gate_already_decided。库里唯一索引兜底 I-17。
 * approve 之后：实例回 running，取 lease 交给 worker；worker 从 checkpoint 重进门阶段，阶段内的副作用
 *   照常经 effect-gateway 重查权限（R3-5/I-13），失败 → blocked_permission（E4）。
 * deny：不交给 worker 执行门阶段——该阶段不会产生 effect receipt（I-17）；onDenyStageId 前向 → 实例继续
 *   running，worker 把门阶段到目标之间的阶段记 skipped；null（或回退，需 WF08 的新 attempt）→ 实例 rejected。
 */
import { workflowRuntime, type WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import { deriveGates, forwardDenyTarget, gateEligibility, gateView, humanGateOf, type WorkflowGateView } from "./human-gate-state";
import { fingerprint, idempotent, latestProjectionFor, WorkflowCommandShapeError, type InstanceCommandDeps } from "./instance-commands";
import { loadVisibleProjection, resolveActor } from "./instance-projection";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowActor, WorkflowLease, WorkflowReceiptKey } from "./workflow-ports";

export interface GateDecisionResponse {
  gate: WorkflowGateView;
  status: WorkflowInstanceStatus;
  stateVersion: number;
}

type Op = "approve" | "deny";

interface GateCommand {
  orgId: string;
  userId: string;
  instanceId: string;
  gateId: string;
  body: unknown;
}

function parseGateBody(op: Op, cmd: GateCommand) {
  const raw = cmd.body && typeof cmd.body === "object" ? (cmd.body as Record<string, unknown>) : {};
  const input = { ...raw, instanceId: cmd.instanceId, gateId: cmd.gateId };
  if (op === "deny") {
    const reason = raw.reason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new WorkflowUseCaseError("deny_reason_required", "deny requires a non-empty reason");
    }
    const parsed = workflowRuntime.denyGate.in.safeParse(input);
    if (!parsed.success) throw new WorkflowCommandShapeError(parsed.error.issues);
    return parsed.data;
  }
  const parsed = workflowRuntime.approveGate.in.safeParse(input);
  if (!parsed.success) throw new WorkflowCommandShapeError(parsed.error.issues);
  return { ...parsed.data, reason: null as string | null };
}

/** 读实例快照 + 冻结定义 + 该门；按判定顺序 2–4 抛错。 */
async function loadGate(deps: InstanceCommandDeps, cmd: GateCommand, actor: WorkflowActor) {
  const snap = await deps.events.loadSnapshot(cmd.orgId, cmd.instanceId);
  if (!snap) throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  const definition = await deps.definitions.findVersion(cmd.orgId, snap.instance.workflowKey, snap.instance.definitionVersion);
  if (!definition) throw new WorkflowUseCaseError("workflow_not_found", "pinned definition version missing");
  const gate = deriveGates(snap.events).get(cmd.gateId);
  const gateDef = gate ? humanGateOf(definition, gate.stageId) : null;
  if (!gate || !gateDef) throw new WorkflowUseCaseError("gate_not_open", "gate is not open");
  const eligibility = gateEligibility(gateDef, actor, snap.instance.initiatorUserId);
  if (!eligibility.ok) throw new WorkflowUseCaseError(eligibility.code, eligibility.code);
  return { snap, definition, gate };
}

async function decide(deps: InstanceCommandDeps, op: Op, cmd: GateCommand): Promise<GateDecisionResponse> {
  const body = parseGateBody(op, cmd);
  const key: WorkflowReceiptKey = {
    orgId: cmd.orgId,
    scope: "command",
    requestKey: `${op}:${cmd.userId}:${cmd.instanceId}:${cmd.gateId}:${body.requestId}`,
    fingerprint: fingerprint({
      op,
      instanceId: cmd.instanceId,
      gateId: cmd.gateId,
      v: body.expectedStateVersion,
      reason: body.reason,
      by: cmd.userId,
    }),
  };
  let lease: WorkflowLease | null = null;
  const { response, fresh } = await idempotent<GateDecisionResponse>(
    deps,
    key,
    async () => {
      const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
      const { snap, definition, gate } = await loadGate(deps, cmd, actor);
      const alreadyDecided = async () => {
        const latest = await loadGate(deps, cmd, actor);
        return new WorkflowUseCaseError("gate_already_decided", "gate already decided", {
          decidedGate: gateView(latest.gate, latest.definition, actor, latest.snap.instance),
        });
      };
      const stale = async () =>
        new WorkflowUseCaseError("state_version_conflict", "state version is stale", {
          latestProjection: await loadVisibleProjection(deps, cmd.orgId, cmd.instanceId, actor),
        });
      if (gate.decision) throw await alreadyDecided();
      if (snap.instance.stateVersion !== body.expectedStateVersion) throw await stale();
      if (snap.instance.status !== "awaiting_gate_decision") throw new WorkflowUseCaseError("gate_not_open", "gate is not open");

      const denyTarget = op === "deny" ? forwardDenyTarget(definition, gate.stageId) : null;
      const nextStatus: WorkflowInstanceStatus = op === "approve" || denyTarget ? "running" : "rejected";
      const appended = await deps.events.append(
        cmd.orgId,
        cmd.instanceId,
        {
          type: "gate_decided",
          stageId: gate.stageId,
          reasonCode: op === "deny" ? "gate_denied" : null,
          data: {
            gateId: gate.gateId,
            attempt: gate.attempt,
            decision: op === "approve" ? "approved" : "denied",
            decidedBy: actor.userId,
            reason: body.reason,
            onDenyStageId: denyTarget,
            requestId: body.requestId,
          },
        },
        {
          expectedStateVersion: body.expectedStateVersion,
          status: nextStatus,
          reasonCode: nextStatus === "rejected" ? "gate_denied" : null,
        },
      ).catch((e: unknown) => {
        // 唯一索引（I-17 库内兜底）撞上：另一决定已在并发事务里落库。
        if ((e as { code?: unknown } | null)?.code === "23505") return { ok: false as const, conflict: "state_version_conflict" as const };
        throw e;
      });
      if (!appended.ok) {
        if (appended.conflict === "workflow_not_found") throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
        const latest = await loadGate(deps, cmd, actor);
        if (latest.gate.decision) throw await alreadyDecided();
        throw await stale();
      }
      if (nextStatus === "running") lease = await acquireForResume(deps, cmd);
      const after = await loadGate(deps, cmd, actor);
      return {
        response: {
          gate: gateView(after.gate, after.definition, actor, after.snap.instance),
          status: appended.status,
          stateVersion: appended.stateVersion,
        },
        instanceId: cmd.instanceId,
      };
    },
    latestProjectionFor(deps, cmd),
  );
  if (fresh && lease) deps.dispatcher.dispatch(lease);
  return response;
}

/**
 * 门打开时 worker 先写 gate_opened 再释放 lease，审批可能挤进这两步之间：短暂重试 lease_conflict。
 * 仍拿不到（另一 worker 持有）则不派发——实例已是 running，lease 过期后由过期扫描接管（R3）。
 */
async function acquireForResume(deps: InstanceCommandDeps, cmd: GateCommand): Promise<WorkflowLease | null> {
  for (let i = 0; i < 20; i++) {
    try {
      return await deps.leases.acquire({ orgId: cmd.orgId, instanceId: cmd.instanceId, holder: deps.holder, ttlMs: deps.leaseTtlMs });
    } catch (e) {
      if (!(e instanceof WorkflowUseCaseError && e.code === "lease_conflict")) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return null;
}

export function approveGate(deps: InstanceCommandDeps, cmd: GateCommand): Promise<GateDecisionResponse> {
  return decide(deps, "approve", cmd);
}

export function denyGate(deps: InstanceCommandDeps, cmd: GateCommand): Promise<GateDecisionResponse> {
  return decide(deps, "deny", cmd);
}
