/**
 * 待审改动的领域模型（F29 / `uc-2-3` R3 步骤 2-4 / 契约 `templates.ChangeRequest`）。
 *
 * ## 提交 ≠ 生效（I-10 / V3）
 *
 * 「生成挂在蓝本上的待审改动」这句话的全部份量在于：**这个模块不写蓝本的当前内容，
 * 也不产生新版本**。`PendingChangeRecord` 是一条独立记录，`status` 从 `"pending"` 起步；
 * 只有 `mergePendingChangeUseCase`（见同目录 application 层）在维护者合并时才会让它
 * 的内容影响到蓝本**草稿**——而那也不是"改当前发布内容"，发布仍要走 `publishBlueprintVersion`
 * 的门槛（见 `publish-blueprint-version.ts`）。
 *
 * ## 为什么不重名 `ChangeRequest`
 *
 * 契约的 `templates.ChangeRequest` 已经是这条记录的四要素形状（来源项目/提出人/时间/理由 +
 * 原值/新值）。`PendingChangeRecord` 是它 **+ `status`**（生命周期字段，契约的 `ChangeRequest`
 * 本身不含它——它是 `listPendingChanges` 响应里一整条记录的字段，不是这一形状本身的）。
 * 用不同的名字，同 `design-facet-table.ts` 的 `DesignFacetRow` 对 `DesignFacetDefinition`
 * 的处理方式一致：契约类型只被 import 一次、扩展一次，不被重新声明。
 */
import type { z } from "zod";
import { templates } from "@repo/contracts";
import type { Deviation } from "./deviation-diff";

export type PendingChangeStatus = "pending" | "merged" | "rejected";

/** 契约四要素形状 + 生命周期状态。派生，不重写。 */
export interface PendingChangeRecord extends z.infer<typeof templates.ChangeRequest> {
  readonly status: PendingChangeStatus;
}

/** 每条勾选提交的选择：要沉淀哪一项 + 为什么（R3 步骤 2，理由必填）。 */
export interface ChangeRequestSelection {
  readonly designFacetKey: string;
  readonly rationale: string;
}

/** 理由必填未通过时抛出的领域错误，被 application 层翻译成契约码 `RATIONALE_REQUIRED`。 */
export class RationaleRequiredError extends Error {
  constructor() {
    super("every selected deviation must carry a non-empty rationale");
    this.name = "RationaleRequiredError";
  }
}

/**
 * 理由必填（[设计] R7「没有『为什么』的偏离不允许提交」）。
 *
 * ⚠ `.trim().length === 0`，不是单纯 `=== ""`：纯空白字符串在语义上等同于没写理由，
 * 让它混进去会让「必填」这条门槛可以被一个空格绕过。
 */
export function assertRationalesPresent(selections: readonly ChangeRequestSelection[]): void {
  if (selections.some((s) => s.rationale.trim().length === 0)) {
    throw new RationaleRequiredError();
  }
}

export interface BuildPendingChangeRequestsParams {
  readonly blueprintId: string;
  readonly baseVersionId: string;
  readonly sourceProjectId: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly selections: readonly ChangeRequestSelection[];
  /** 本场当前的全量偏离清单——只有出现在这里面的 key 才有原值/新值可沉淀 */
  readonly deviations: readonly Deviation[];
  readonly idFactory: () => string;
}

/**
 * 由勾选 + 偏离清单生成待审改动记录。
 *
 * ⚠ 只有 `selections` 中能在 `deviations` 里找到同名 `designFacetKey` 的项才会产出记录——
 * 未勾选的偏离项不产生任何蓝本侧记录（R3 步骤 2 逐字），勾选了但已不在当前偏离清单里的项
 * （理论上不该发生：调用方应从同一次 `computeDeviations` 结果里勾选）同样**不**凭空捏造
 * 一条记录（A3 的同一立场：没有数据就不产出）。
 *
 * ⚠ 理由校验先于生成——调用方应先捕获 `RationaleRequiredError` 翻译成契约码，
 * 本函数不知道契约码是什么（同 `apply-blueprint-init.ts` 纯函数不知道 HTTP 状态码的分层）。
 */
export function buildPendingChangeRequests(
  params: BuildPendingChangeRequestsParams,
): PendingChangeRecord[] {
  assertRationalesPresent(params.selections);
  const byKey = new Map(params.deviations.map((d) => [d.designFacetKey, d] as const));

  const records: PendingChangeRecord[] = [];
  for (const selection of params.selections) {
    const deviation = byKey.get(selection.designFacetKey);
    if (!deviation) continue;
    records.push({
      changeRequestId: params.idFactory(),
      blueprintId: params.blueprintId,
      designFacetKey: deviation.designFacetKey,
      beforeValue: deviation.beforeValue,
      afterValue: deviation.afterValue,
      sourceProjectId: params.sourceProjectId,
      proposedBy: params.proposedBy,
      proposedAt: params.proposedAt,
      rationale: selection.rationale,
      baseVersionId: params.baseVersionId,
      status: "pending",
    });
  }
  return records;
}

/**
 * 只有蓝本维护者能合并（A1 / V5）。
 *
 * ⚠ `isMaintainer` 由调用方解析后传入，本函数不自己判定「谁是维护者」——
 * 「蓝本维护者」的判据本身是 D-1 未裁（`KNOWN_CONTRACT_GAPS.T2` 逐字：
 * 「裁定前不得写死」）。这里只落"知道了答案之后该怎么做"这一半，
 * 同 `apply-blueprint.ts` 对 `actorOrgRole` 的处理方式（外部解析、内部只消费）。
 */
export function canMergePendingChange(isMaintainer: boolean): boolean {
  return isMaintainer;
}

/**
 * 同一 `designFacetKey` 上的其它待审记录（不含自己），仅取仍为 `pending` 的（I-12 / V6）。
 *
 * ⚠ 不做任何排序或择一——调用方（`listPendingChanges` 的响应装配）原样并排展示，
 * 这里只负责"找出同伙"，不负责"选出赢家"：赢家从不存在，输家也不存在。
 */
export function siblingsOnSameKey(
  target: Pick<PendingChangeRecord, "changeRequestId" | "designFacetKey">,
  all: readonly PendingChangeRecord[],
): PendingChangeRecord[] {
  return all.filter(
    (r) =>
      r.designFacetKey === target.designFacetKey &&
      r.changeRequestId !== target.changeRequestId &&
      r.status === "pending",
  );
}
