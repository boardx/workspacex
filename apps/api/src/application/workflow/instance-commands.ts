/**
 * WF03 —— UC-WR-3 start / UC-WR-7 cancel / UC-WR-8 resume（requirements 02 R3 第 2、10 步；R4 A1/E2/E3/E5/E6）。
 *
 * start：receipt.begin（同 requestId 同指纹 → 首次稳定响应，A1）→ 准入（E6）→ 输入校验 → 冻结版本建实例
 *   （实例与 seq=1 的 instance_started 事件同事务）→ lease(epoch=1) → receipt.finalize → 交给 worker。
 * cancel：可见性 → expectedStateVersion（过期 → 409 state_version_conflict + latestProjection，E3）→
 *   置 cancelling 并记 cancel_requested；worker 在下一个阶段边界把它落成 cancelled。
 * resume：receipt → 可见性 → 版本校验 → lease epoch CAS（E2，lease_conflict）→ 交给 worker。
 * 三个命令共用 idempotent()：业务拒绝也落定为稳定响应（A1），并发同 requestId 等首个落定后重放。
 */
import { createHash } from "node:crypto";
import {
  workflowRuntime,
  type WorkflowInstanceStatus,
  type PinnedSkillVersion,
} from "@repo/contracts/workflow-runtime";
import { validateTriggerInput } from "../../domain/workflow/trigger-input";
import { createPinnedInstance } from "./pin-workflow-instance";
import {
  isTerminal,
  loadVisibleProjection,
  resolveActor,
} from "./instance-projection";
import { WorkflowUseCaseError } from "./workflow-errors";
import type {
  SkillVersionResolverPort,
  WorkflowDefinitionRepository,
  WorkflowInstanceRepository,
  WorkflowLease,
  WorkflowLeaseStore,
  WorkflowReceiptKey,
  WorkflowReceiptStore,
} from "./workflow-ports";
import type {
  WorkflowAccessPort,
  WorkflowEventStore,
  WorkflowRunDispatcher,
} from "./workflow-runtime-ports";

export interface InstanceCommandDeps {
  definitions: WorkflowDefinitionRepository;
  instances: WorkflowInstanceRepository;
  skills: SkillVersionResolverPort;
  receipts: WorkflowReceiptStore;
  leases: WorkflowLeaseStore;
  events: WorkflowEventStore;
  access: WorkflowAccessPort;
  dispatcher: WorkflowRunDispatcher;
  newId(): string;
  /** 本进程 worker 的 lease 持有者标识。 */
  holder: string;
  leaseTtlMs: number;
  /** 并发同 requestId 时等待首个请求 finalize 的上限。 */
  inFlightWaitMs?: number;
}

export interface StartInstanceResponse {
  instanceId: string;
  status: WorkflowInstanceStatus;
  stateVersion: number;
  definitionVersion: number;
  pinnedSkills: PinnedSkillVersion[];
}

export interface StateResponse {
  instanceId: string;
  status: WorkflowInstanceStatus;
  stateVersion: number;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** begin；若另一请求正持有同 key（in_flight），等它 finalize 后返回其稳定响应。 */
async function beginOrReplay(
  deps: InstanceCommandDeps,
  key: WorkflowReceiptKey,
): Promise<{ replay: unknown } | null> {
  const deadline = Date.now() + (deps.inFlightWaitMs ?? 10_000);
  for (;;) {
    const r = await deps.receipts.begin(key);
    if (r.kind === "begun") return null;
    if (r.kind === "replay") return { replay: r.stableResponse };
    if (Date.now() > deadline)
      throw new Error(`workflow command ${key.requestKey} is still in flight`);
    await sleep(50);
  }
}

/** receipt 里记录的「首次稳定响应是业务拒绝」（A1：同 requestId 重试得到同一个 4xx）。 */
interface StoredRejection {
  workflowRejection: {
    code: WorkflowUseCaseError["code"];
    message: string;
    details: WorkflowUseCaseError["details"];
  };
}

function isStoredRejection(v: unknown): v is StoredRejection {
  return !!v && typeof v === "object" && "workflowRejection" in v;
}

/** 重放 409 时重新读取最新投影（对当前用户可见性照常校验）。 */
type RejectionRefresher = () => ReturnType<typeof loadVisibleProjection>;

export function latestProjectionFor(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; instanceId: string },
): RejectionRefresher {
  return async () => {
    const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
    return loadVisibleProjection(deps, cmd.orgId, cmd.instanceId, actor);
  };
}

function replayed<T>(stable: unknown): T {
  if (isStoredRejection(stable)) {
    const r = stable.workflowRejection;
    throw new WorkflowUseCaseError(r.code, r.message, r.details);
  }
  return stable as T;
}

/**
 * A1 幂等外壳：begin（in_flight 等待后重放）→ 执行 → finalize。业务拒绝（WorkflowUseCaseError）也 finalize
 * 成稳定响应，否则 receipt 永远停在 begun，重试会空转成 500。非业务异常（DB 断连等）不落定，保持 begun。
 */
export async function idempotent<T>(
  deps: InstanceCommandDeps,
  key: WorkflowReceiptKey,
  run: () => Promise<{ response: T; instanceId: string | null }>,
  refreshRejection?: RejectionRefresher,
): Promise<{ response: T; fresh: boolean }> {
  const prior = await beginOrReplay(deps, key);
  if (prior) {
    const stable = prior.replay;
    // 409 的 code 稳定（A1），但 latestProjection 必须是「现在」的投影（R4 A1/E3）：重放时重新读取。
    if (
      refreshRejection &&
      isStoredRejection(stable) &&
      stable.workflowRejection.details &&
      "latestProjection" in stable.workflowRejection.details
    ) {
      const r = stable.workflowRejection;
      throw new WorkflowUseCaseError(r.code, r.message, {
        ...r.details,
        latestProjection: await refreshRejection(),
      });
    }
    return { response: replayed<T>(stable), fresh: false };
  }
  let outcome: { response: T; instanceId: string | null };
  try {
    outcome = await run();
  } catch (e) {
    if (!(e instanceof WorkflowUseCaseError)) throw e;
    const rejection: StoredRejection = {
      workflowRejection: {
        code: e.code,
        message: e.message,
        details: e.details,
      },
    };
    replayed(
      await deps.receipts.finalize(key, {
        stableResponse: rejection,
        checkpointId: null,
        instanceId: null,
      }),
    );
    throw e;
  }
  const stable = await deps.receipts.finalize(key, {
    stableResponse: outcome.response,
    checkpointId: null,
    instanceId: outcome.instanceId,
  });
  return { response: replayed<T>(stable), fresh: true };
}

/** start 的准入 + 版本解析 + 冻结落实例核心（WF01/WF03 步骤 2/4/5/6）；HTTP start 与 WF06 触发器共用。 */
interface StartCoreArgs {
  orgId: string;
  actorUserId: string;
  key: string;
  version?: number;
  agentId: string;
  input: Record<string, unknown>;
  triggerKind: "manual" | "schedule" | "webhook";
}

async function runStartCore(
  deps: InstanceCommandDeps,
  args: StartCoreArgs,
  setLease: (l: WorkflowLease) => void,
): Promise<{ response: StartInstanceResponse; instanceId: string | null }> {
  if (!(await deps.definitions.definitionExists(args.orgId, args.key))) {
    throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  }
  const agentVersionId = await deps.access.runnableAgentVersion(
    args.orgId,
    args.actorUserId,
    args.agentId,
    args.key,
  );
  if (!agentVersionId)
    throw new WorkflowUseCaseError(
      "workflow_not_allowed",
      "agent not runnable for this workflow",
    );
  // CT06 / E3：受角色白名单约束的 Workflow 不在 Agent 已发布白名单内 → 403 + 可转交提示，不静默降级。
  const allowlistHint = await deps.access.workflowAllowlistRefusal(args.orgId, args.actorUserId, args.agentId, args.key);
  if (allowlistHint)
    throw new WorkflowUseCaseError("workflow_not_allowed", "workflow not in agent allowlist", { allowlistHint });

  const version =
    args.version ??
    (await deps.definitions.latestPublishedVersion(args.orgId, args.key));
  const definition =
    version == null
      ? null
      : await deps.definitions.findVersion(args.orgId, args.key, version);
  if (!definition || definition.status !== "published") {
    throw new WorkflowUseCaseError(
      "workflow_version_not_published",
      "workflow version not published",
    );
  }
  const inputIssues = validateTriggerInput(definition.inputSchema, args.input);
  if (inputIssues.length > 0)
    throw new WorkflowUseCaseError(
      "trigger_input_invalid",
      "trigger input invalid",
      { issues: inputIssues },
    );

  const instance = await createPinnedInstance(
    { ...deps, instances: withTriggerInput(deps.instances, args.input) },
    {
      orgId: args.orgId,
      key: args.key,
      version: definition.version,
      agentId: args.agentId,
      agentVersionId,
      initiatorUserId: args.actorUserId,
      triggerKind: args.triggerKind,
    },
  );
  const lease = await deps.leases.acquire({
    orgId: args.orgId,
    instanceId: instance.instanceId,
    holder: deps.holder,
    ttlMs: deps.leaseTtlMs,
  });
  setLease(lease);
  const response: StartInstanceResponse = {
    instanceId: instance.instanceId,
    status: instance.status,
    stateVersion: instance.stateVersion,
    definitionVersion: instance.definitionVersion,
    pinnedSkills: instance.pinnedSkills.map((p) => ({ ...p })),
  };
  return { response, instanceId: instance.instanceId };
}

export async function startInstance(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; pathKey: string; body: unknown },
): Promise<StartInstanceResponse> {
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
  const raw =
    cmd.body && typeof cmd.body === "object"
      ? (cmd.body as Record<string, unknown>)
      : {};
  const parsed = workflowRuntime.startInstance.in.safeParse({
    ...raw,
    key: cmd.pathKey,
  });
  if (!parsed.success) {
    throw new WorkflowUseCaseError(
      "trigger_input_invalid",
      "start request invalid",
      { issues: parsed.error.issues },
    );
  }
  const body = parsed.data;
  const key: WorkflowReceiptKey = {
    orgId: cmd.orgId,
    scope: "command",
    requestKey: `start:${body.requestId}`,
    fingerprint: fingerprint({
      op: "start",
      key: body.key,
      version: body.version ?? null,
      agentId: body.agentId,
      input: body.input,
      by: actor.userId,
    }),
  };
  let lease: WorkflowLease | null = null;
  const { response, fresh } = await idempotent<StartInstanceResponse>(
    deps,
    key,
    () =>
      runStartCore(
        deps,
        {
          orgId: cmd.orgId,
          actorUserId: actor.userId,
          key: body.key,
          version: body.version,
          agentId: body.agentId,
          input: body.input,
          triggerKind: "manual",
        },
        (l) => {
          lease = l;
        },
      ),
  );
  if (fresh && lease) deps.dispatcher.dispatch(lease);
  return response;
}

/**
 * WF06 —— pg-boss 定时唤醒 / webhook 触发共用的 start 入口：requestKey 由调用方给出（作业 id / Idempotency-Key），
 * 运行身份 = 触发器 owner（`triggerKind` 为 `schedule`/`webhook`）。幂等外壳与 HTTP start 完全一致（I-6）。
 */
export async function startInstanceFromTrigger(
  deps: InstanceCommandDeps,
  cmd: {
    orgId: string;
    actorUserId: string;
    key: string;
    version?: number;
    agentId: string;
    input: Record<string, unknown>;
    triggerKind: "schedule" | "webhook";
    requestKey: string;
  },
): Promise<StartInstanceResponse> {
  const key: WorkflowReceiptKey = {
    orgId: cmd.orgId,
    scope: "command",
    requestKey: `${cmd.triggerKind}:${cmd.requestKey}`,
    fingerprint: fingerprint({
      op: cmd.triggerKind,
      key: cmd.key,
      version: cmd.version ?? null,
      agentId: cmd.agentId,
      input: cmd.input,
      by: cmd.actorUserId,
    }),
  };
  let lease: WorkflowLease | null = null;
  const { response, fresh } = await idempotent<StartInstanceResponse>(
    deps,
    key,
    () =>
      runStartCore(
        deps,
        {
          orgId: cmd.orgId,
          actorUserId: cmd.actorUserId,
          key: cmd.key,
          version: cmd.version,
          agentId: cmd.agentId,
          input: cmd.input,
          triggerKind: cmd.triggerKind,
        },
        (l) => {
          lease = l;
        },
      ),
  );
  if (fresh && lease) deps.dispatcher.dispatch(lease);
  return response;
}

/** 实例仓库的 create 会同事务写 instance_started 事件；trigger 输入随事件落库（worker 从这里读回）。 */
function withTriggerInput(
  repo: WorkflowInstanceRepository,
  input: Record<string, unknown>,
): WorkflowInstanceRepository {
  return {
    create: (instance) => repo.create(instance, { triggerInput: input }),
    find: (orgId, id) => repo.find(orgId, id),
  };
}

async function guardedTransition(
  deps: InstanceCommandDeps,
  cmd: {
    orgId: string;
    userId: string;
    instanceId: string;
    expectedStateVersion: number;
  },
) {
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
  const projection = await loadVisibleProjection(
    deps,
    cmd.orgId,
    cmd.instanceId,
    actor,
  );
  const conflict = async (
    code: "state_version_conflict" | "instance_terminal",
  ) => {
    const latestProjection = await loadVisibleProjection(
      deps,
      cmd.orgId,
      cmd.instanceId,
      actor,
    );
    return new WorkflowUseCaseError(
      code,
      code === "instance_terminal"
        ? "instance is terminal"
        : "state version is stale",
      { latestProjection },
    );
  };
  if (projection.stateVersion !== cmd.expectedStateVersion)
    throw await conflict("state_version_conflict");
  if (isTerminal(projection.status)) throw await conflict("instance_terminal");
  return { actor, projection, conflict };
}

function parseCommand(
  op: "cancelInstance" | "resumeInstance",
  instanceId: string,
  body: unknown,
) {
  const raw =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const parsed = workflowRuntime[op].in.safeParse({ ...raw, instanceId });
  // 契约 err 表不含 400 类码；形状错误按「看不到这个请求要找的东西」处理为 422 trigger_input_invalid 不合适，
  // 统一抛普通 Error 由 interface 层映射为 400。
  if (!parsed.success) throw new WorkflowCommandShapeError(parsed.error.issues);
  return parsed.data;
}

export class WorkflowCommandShapeError extends Error {
  constructor(readonly issues: unknown[]) {
    super("workflow command body invalid");
    this.name = "WorkflowCommandShapeError";
  }
}

export async function cancelInstance(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; instanceId: string; body: unknown },
): Promise<StateResponse> {
  const body = parseCommand("cancelInstance", cmd.instanceId, cmd.body);
  const key: WorkflowReceiptKey = {
    orgId: cmd.orgId,
    scope: "command",
    // requestKey 按用户划分：别人的 requestId 不会让不可见用户看到 409 而非 404。
    requestKey: `cancel:${cmd.userId}:${body.instanceId}:${body.requestId}`,
    fingerprint: fingerprint({
      op: "cancel",
      instanceId: body.instanceId,
      v: body.expectedStateVersion,
      by: cmd.userId,
    }),
  };
  const { response } = await idempotent<StateResponse>(deps, key, async () => {
    const { conflict } = await guardedTransition(deps, {
      ...cmd,
      expectedStateVersion: body.expectedStateVersion,
    });
    const appended = await deps.events.append(
      cmd.orgId,
      cmd.instanceId,
      {
        type: "cancel_requested",
        stageId: null,
        reasonCode: "cancel_requested",
        data: { requestedBy: cmd.userId },
      },
      {
        expectedStateVersion: body.expectedStateVersion,
        status: "cancelling",
        reasonCode: "cancel_requested",
      },
    );
    if (!appended.ok) {
      if (appended.conflict === "workflow_not_found")
        throw new WorkflowUseCaseError(
          "workflow_not_found",
          "workflow not found",
        );
      throw await conflict(appended.conflict);
    }
    return {
      response: {
        instanceId: cmd.instanceId,
        status: appended.status,
        stateVersion: appended.stateVersion,
      },
      instanceId: cmd.instanceId,
    };
  }, latestProjectionFor(deps, cmd));
  return response;
}

export async function resumeInstance(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; instanceId: string; body: unknown },
): Promise<StateResponse> {
  const body = parseCommand("resumeInstance", cmd.instanceId, cmd.body);
  const key: WorkflowReceiptKey = {
    orgId: cmd.orgId,
    scope: "command",
    // requestKey 按用户划分：别人的 requestId 不会让不可见用户看到 409 而非 404。
    requestKey: `resume:${cmd.userId}:${body.instanceId}:${body.requestId}`,
    fingerprint: fingerprint({
      op: "resume",
      instanceId: body.instanceId,
      v: body.expectedStateVersion,
      by: cmd.userId,
    }),
  };
  let lease: WorkflowLease | null = null;
  const { response, fresh } = await idempotent<StateResponse>(
    deps,
    key,
    async () => {
      // 版本校验与 lease CAS 是两步：校验后被他人抢到 lease 时 acquire 抛 lease_conflict（E2），不会双跑；
      // 该拒绝同样落进 receipt，同 requestId 重试得到同一个 409。
      const { projection } = await guardedTransition(deps, {
        ...cmd,
        expectedStateVersion: body.expectedStateVersion,
      });
      lease = await deps.leases.acquire({
        orgId: cmd.orgId,
        instanceId: cmd.instanceId,
        holder: deps.holder,
        ttlMs: deps.leaseTtlMs,
      });
      return {
        response: {
          instanceId: cmd.instanceId,
          status: projection.status,
          stateVersion: projection.stateVersion,
        },
        instanceId: cmd.instanceId,
      };
    },
    latestProjectionFor(deps, cmd),
  );
  if (fresh && lease) deps.dispatcher.dispatch(lease);
  return response;
}
