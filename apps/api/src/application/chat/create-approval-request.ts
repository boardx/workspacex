/**
 * `createApprovalRequest`（F112 · uc-8-2 · 批准闸门第一步：暂停 + 六项披露）。
 *
 * ## 错误码映射——契约只给了四个，本用例把哪些情形塞进哪一个
 *
 * `createApprovalRequest.err` = `["MODEL_POLICY_VIOLATION", "REGISTRY_UNAVAILABLE",
 * "BUDGET_EXHAUSTED", "RISK_TABLE_MISSING"]`。契约没有「模型 id 不存在」这一档，
 * 本用例把它并入 `REGISTRY_UNAVAILABLE`——理由与契约注释一致（"REGISTRY_UNAVAILABLE
 * ⇒ 不出卡，不得回落到硬编码价目"）：registry 供不出这个 id 的价目与 hosting，
 * 后果与 registry 本身不可用一样——卡片没有可信数据源。这是一个**已登记的判断调用**，
 * 不是契约的字面意思，PR 说明里已同样标注。
 *
 * `BUDGET_EXHAUSTED` / `RISK_TABLE_MISSING` 在本实现中**结构性不可达**：前者需要一个
 * 「本轮预算上限」输入，契约 `in` 没有这个字段；后者需要「高影响动作判定表」，
 * `design-signoff.md` 第 ③ 节明写这张表**缺失**（uc-8-2 R10 [待确认]）。两者留在
 * `err` 声明里是因为契约如此，本文件不生造一个从不触发的分支去"用上"它们。
 *
 * ## I-32 判据取哪个口径 —— 见 `domain/chat/approval-gate.ts` 文件头
 *
 * 本用例调用 `modelPolicyViolation`，不重复判定逻辑。
 *
 * ## callChain 的已知简化
 *
 * 契约 `createApprovalRequest.in` 只有 `{threadId, agentId, action, dataScope,
 * proposedModels, estimatedTokens}`，**没有携带调用方链信息**——O-36「agent 互调深度
 * 上限 2」需要知道"谁调用了谁"，而这个信息目前无处可来（跨分片依赖，编排层尚未
 * 提供）。本实现的 `callChain` 恒为 `[agentId]`，满足 I-28「非空」但语义单薄；
 * 这是已登记的已知简化，不是完整实现。
 */
import type { OrgId } from "../../domain/org-id";
import {
  budgetFromRegistry,
  modelPolicyViolation,
  sixFieldsDisclosed,
  type ApprovalDataScopeT,
  type ApprovalModelRow,
} from "../../domain/chat/approval-gate";
import type { ChatRepository } from "./ports";
import type { ApprovalModelRegistryReader } from "./approval-model-registry";
import type { ProvenanceWriter } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";
import type { Clock } from "../auth/ports";

/** 三出口恒定——契约 `ApprovalExit` 三值封闭，这里不是硬编码业务数据，是契约本身。 */
const EXITS = ["approve", "reparam", "decline"] as const;

/** O-36：默认超时。**数值不写进契约**，此处取非现场档（24h）为统一默认——
 *  在场/非现场的判别（F110 `AgentPresence`）目前没有接入本用例，见下方文件级登记。
 *  ⚠ 这是一个占位值，design-signoff.md 明确标注三个 O-36 数值尚未定稿，
 *  任何断言都不应依赖这个具体分钟数本身，只应依赖「存在且为未来时刻」。
 */
const DEFAULT_TIMEOUT_MINUTES = 24 * 60;

/** 批准后转后台的默认预计回归分钟数——同上，占位值，见 design-signoff.md [待确认]。 */
export const DEFAULT_ETA_MINUTES = 15;

export class RegistryUnavailableError extends Error {
  constructor() {
    super("registry_unavailable");
  }
}

export class ModelPolicyViolationError extends Error {
  constructor(readonly detail: string) {
    super("model_policy_violation");
  }
}

export interface CreateApprovalRequestDeps {
  readonly chat: ChatRepository;
  readonly registry: ApprovalModelRegistryReader;
  readonly provenance: ProvenanceWriter;
  readonly ids: IdFactory;
  readonly clock: Clock;
}

export interface CreateApprovalRequestInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly agentId: string;
  readonly action: string;
  readonly dataScope: readonly ApprovalDataScopeT[];
  readonly proposedModels: readonly string[];
  readonly estimatedTokens: number;
}

export interface CreateApprovalRequestResult {
  readonly requestId: string;
  readonly status: "paused";
  readonly callChain: readonly string[];
  readonly models: readonly string[];
  readonly budget: { readonly tokens: number; readonly amount: number; readonly currency: string };
  readonly dataScope: readonly ApprovalDataScopeT[];
  readonly exits: readonly ("approve" | "reparam" | "decline")[];
  readonly expiresAt: string;
  readonly backgroundHint: string;
}

export async function createApprovalRequest(
  deps: CreateApprovalRequestDeps,
  input: CreateApprovalRequestInput,
): Promise<CreateApprovalRequestResult> {
  const rows = await deps.registry.findModels(input.orgId, input.proposedModels);
  const byId = new Map(rows.map((r) => [r.modelId, r] as const));
  const models: ApprovalModelRow[] = [];
  for (const id of input.proposedModels) {
    const row = byId.get(id);
    // registry 供不出这个 id 的数据 ⇒ REGISTRY_UNAVAILABLE（见文件头映射说明）。
    if (row === undefined) throw new RegistryUnavailableError();
    models.push(row);
  }
  if (models.length === 0) throw new RegistryUnavailableError();

  const violation = modelPolicyViolation(input.dataScope, models);
  if (violation !== null) throw new ModelPolicyViolationError(violation);

  const budget = budgetFromRegistry(input.estimatedTokens, models);
  const callChain = [input.agentId];
  const requestId = deps.ids.next("appr");
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + DEFAULT_TIMEOUT_MINUTES * 60_000).toISOString();
  const backgroundHint = `批准后转后台任务，预计 ${DEFAULT_ETA_MINUTES} 分钟内回归`;

  const card = {
    title: input.action,
    callChain,
    models: models.map((m) => ({ modelId: m.modelId })),
    budget,
    dataScope: input.dataScope,
    exits: EXITS,
  };
  // I-28 的机械体现：六项披露任一为空，这里就先拒绝，不落库半张卡。
  if (!sixFieldsDisclosed(card)) throw new RegistryUnavailableError();

  await deps.chat.createApprovalRequest(input.orgId, {
    id: requestId,
    threadId: input.threadId,
    agentId: input.agentId,
    action: input.action,
    callChain,
    proposedModels: input.proposedModels,
    dataScope: input.dataScope,
    estimatedTokens: input.estimatedTokens,
    expiresAt,
  });

  // I-27 的落痕面：写审计不代表目标动作已执行——这条事件记的是「一次高影响动作被
  // 拦下并生成了批准卡」，不是「动作已完成」。target 借用 `thread`（同 F111 借法）。
  await deps.provenance.append({
    orgId: input.orgId,
    type: "approval-requested",
    actorId: input.agentId,
    target: { kind: "thread", id: input.threadId },
    detail: { requestId, action: input.action, models: input.proposedModels },
  });

  return {
    requestId,
    status: "paused",
    callChain,
    models: input.proposedModels,
    budget,
    dataScope: input.dataScope,
    exits: EXITS,
    expiresAt,
    backgroundHint,
  };
}
