/**
 * `routeModelCall` — 机密硬路由的**唯一执行点**（F51 / UC-20.3, I-10…I-13, D-U1）。
 *
 * 纯函数：没有时钟、没有 I/O、没有数据库。这一层只回答一个问题——「给定候选池、
 * 本轮是否含机密、以及调用方想用哪个模型，这次调用最终选谁，或者为什么必须拒绝」。
 * 谁来判定「本轮是否含机密」（读 Context Pack 各 item 的 `artifactVersionId` 机密标记，
 * I-13 / X-7）与谁来把决策写进 `provenance_events`（I-44）都是应用层
 * （`apps/api/src/application/model/route-model-call.ts`）的事，不在这里做。
 *
 * ## 为什么复用 `selectable.ts`，不重新判定"已启用"或"机密可选"
 *
 * `selectableModels`（F50）已经是"已启用集合"与"机密只收 self-hosted"的唯一实现，
 * `model-strategy.ts`（F20）已经复用它一次；本文件是第三处复用，而不是第三份判据。
 * 三处若各写一份，迟早会在某次改动里读到不同的答案——这正是本仓九次同一事实两处声明
 * 事故的形状。⇒ 本文件只组合 `selectableModels` 的输出，不重新判定"什么算已启用"
 * "什么算机密可选"。
 *
 * ## 判定顺序本身是契约（usecases.md 逐条）
 *
 * 1. 机密性判定由调用方给出（`containsConfidential: boolean | "unknown"`）；
 *    `"unknown"`（标记缺失或冲突）⇒ **从严按含机密处理**（I-12）。
 * 2. 若显式指定了 `requestedModelId`：
 *    a. 该模型不在池中，或不处于`已启用` ⇒ `MODEL_NOT_SELECTABLE`
 *       （**先查启用**，`model-strategy.ts` 头部注释同一条判定顺序理由：
 *       一个"没启用的云端模型"不能被误报成路由违规）。
 *    b. 该模型是被成员停用拖垮的组合 ⇒ `COMPOSITE_MEMBER_DISABLED`（I-5）。
 *    c. 含机密但该模型不是 `self-hosted` ⇒ `CONFIDENTIAL_ROUTE_VIOLATION`
 *       ——这正是"直接指定闭源模型"的绕过尝试，`bypassAttempt: true`（I-10）。
 *    d. 否则选中它。
 * 3. 未显式指定：从候选集合（含机密 ⇒ `已启用 ∩ self-hosted`；否则 ⇒ `已启用`）里
 *    自动选第一个；候选为空 ⇒ 含机密 `NO_LOCAL_MODEL_AVAILABLE`（I-11，**绝不回落闭源**），
 *    不含机密 `MODEL_NOT_SELECTABLE`（没有任何已启用模型可选）。
 * 4. 含机密 ⇒ **禁止降级**：`degradedTo` 恒为 `null`（本文件不做降级选型，
 *    该职责属配额降级路径 `quota-policy.ts`，两者结论必须一致但判定各自独立）。
 *
 * ⚠ 拒绝也是"选出的结果"之一，不是异常——应用层据 `RouteVerdict.ok === false`
 *   写入 `RoutingDecision`（含拒绝，I-44/契约第 6 步），`bypassAttempt === true`
 *   的那一类额外计入越权拦截计数（契约第 7 步）。
 */
import { compositeBlock } from "./composite";
import { selectableModels, type SelectableCandidateRow } from "./selectable";

/** 材料级机密标记的判定结果。`"unknown"` = 标记缺失或冲突，从严按 `true` 处理（I-12）。 */
export type ConfidentialitySignal = boolean | "unknown";

/** 落地判定：`"unknown"` 从严归为含机密。 */
export function resolveContainsConfidential(signal: ConfidentialitySignal): boolean {
  return signal !== false;
}

export type RouteRejectionCode =
  | "NO_LOCAL_MODEL_AVAILABLE"
  | "CONFIDENTIAL_ROUTE_VIOLATION"
  | "MODEL_NOT_SELECTABLE"
  | "COMPOSITE_MEMBER_DISABLED";

export interface RouteVerdictOk {
  readonly ok: true;
  readonly selectedModelId: string;
  /** 含机密时恒为 null——本文件不做降级选型（见文件头 4） */
  readonly degradedTo: null;
  readonly containsConfidential: boolean;
  readonly candidateModelIds: readonly string[];
}

export interface RouteVerdictRejected {
  readonly ok: false;
  readonly code: RouteRejectionCode;
  readonly containsConfidential: boolean;
  readonly candidateModelIds: readonly string[];
  readonly requestedModelId: string | null;
  /**
   * true ⇒ 这是一次"绕过路由"的尝试（直接指定不合规的闭源模型），
   * 要计入越权拦截计数；false ⇒ 只是候选集为空这类正常拒绝，不计拦截。
   */
  readonly bypassAttempt: boolean;
  /** 组合被哪些成员拖垮——仅 `COMPOSITE_MEMBER_DISABLED` 时非空 */
  readonly blockedByMemberIds: readonly string[];
}

export type RouteVerdict = RouteVerdictOk | RouteVerdictRejected;

function rejected(
  input: Pick<RouteVerdictRejected, "code" | "bypassAttempt"> & {
    readonly requestedModelId?: string | null;
    readonly blockedByMemberIds?: readonly string[];
  },
  containsConfidential: boolean,
  candidateModelIds: readonly string[],
): RouteVerdictRejected {
  return {
    ok: false,
    code: input.code,
    containsConfidential,
    candidateModelIds,
    requestedModelId: input.requestedModelId ?? null,
    bypassAttempt: input.bypassAttempt,
    blockedByMemberIds: input.blockedByMemberIds ?? [],
  };
}

/**
 * 机密硬路由的核心决策（无 I/O）。
 *
 * ⚠ R5：**无角色豁免**——这个函数的签名里没有任何"谁在调用"的参数，
 *   因为路由结果不因调用者是谁而改变（组织管理员也不能为某次调用开绿灯）。
 * ⚠ R9：判定同步完成——这是纯函数，本身就不可能跨调用产生副作用或缓存漂移。
 */
export function decideModelRoute(input: {
  readonly pool: readonly SelectableCandidateRow[];
  readonly requestedModelId: string | null;
  readonly confidentiality: ConfidentialitySignal;
}): RouteVerdict {
  const containsConfidential = resolveContainsConfidential(input.confidentiality);
  const purpose = containsConfidential ? "confidential" : null;
  const candidates = selectableModels(input.pool, purpose);
  const candidateModelIds = candidates.map((c) => c.modelId);

  if (input.requestedModelId !== null) {
    const requested = input.pool.find((row) => row.modelId === input.requestedModelId);

    // a. 先查"已启用"——不存在或状态不是已启用，一律 MODEL_NOT_SELECTABLE，
    //    不误报成机密路由违规（model-strategy.ts 同一条判定顺序理由）。
    if (!requested || requested.status !== "已启用") {
      return rejected(
        { code: "MODEL_NOT_SELECTABLE", bypassAttempt: false, requestedModelId: input.requestedModelId },
        containsConfidential,
        candidateModelIds,
      );
    }

    // b. 组合被成员拖垮——不降级为单模型静默运行（I-5）。
    if (requested.shape === "composite") {
      const block = compositeBlock(requested.members);
      if (block !== null) {
        return rejected(
          {
            code: "COMPOSITE_MEMBER_DISABLED",
            bypassAttempt: false,
            requestedModelId: input.requestedModelId,
            blockedByMemberIds: block.memberIds,
          },
          containsConfidential,
          candidateModelIds,
        );
      }
    }

    // c. 含机密但指定的不是 self-hosted —— 这是"绕过"，不是普通的"没启用"。
    if (containsConfidential && requested.kind !== "self-hosted") {
      return rejected(
        { code: "CONFIDENTIAL_ROUTE_VIOLATION", bypassAttempt: true, requestedModelId: input.requestedModelId },
        containsConfidential,
        candidateModelIds,
      );
    }

    // d. 到这里，requested 一定在候选集合里（已启用 ∧ 组合未被拖垮 ∧ 机密时为 self-hosted）。
    return {
      ok: true,
      selectedModelId: input.requestedModelId,
      degradedTo: null,
      containsConfidential,
      candidateModelIds,
    };
  }

  // 未显式指定：自动从候选集合里选第一个。
  if (candidateModelIds.length === 0) {
    return rejected(
      {
        code: containsConfidential ? "NO_LOCAL_MODEL_AVAILABLE" : "MODEL_NOT_SELECTABLE",
        bypassAttempt: false,
        requestedModelId: null,
      },
      containsConfidential,
      candidateModelIds,
    );
  }

  return {
    ok: true,
    selectedModelId: candidateModelIds[0]!,
    degradedTo: null,
    containsConfidential,
    candidateModelIds,
  };
}

/**
 * 系统提示层的硬约束段（第二道防线，`assembleSystemPrompt` 用例的核心内容）。
 *
 * ⚠ 两道防线缺一不可：服务端路由（`decideModelRoute`）是第一道，本函数产出的文本是
 *   第二道——提示可被模型忽略，**不能只有这一道**，但它必须逐字存在，好让"AI 读到了
 *   什么"里的只读审查能看到系统真的告诉过模型这条约束。
 * ⚠ 原文必须逐字包含"客户机密材料只能由本地模型处理"（uc-20-3 R3 步骤 3 逐字）。
 */
export const HARD_CONSTRAINT_SECTION_HEADING = "# 硬约束" as const;

export const CONFIDENTIAL_HARD_CONSTRAINT_TEXT =
  "客户机密材料只能由本地模型处理" as const;

export function assembleHardConstraintSection(extra: readonly string[] = []): string {
  const lines = [CONFIDENTIAL_HARD_CONSTRAINT_TEXT, ...extra];
  return `${HARD_CONSTRAINT_SECTION_HEADING}\n${lines.join("\n")}`;
}
