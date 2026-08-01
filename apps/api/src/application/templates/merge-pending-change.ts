/**
 * 用例：合并一条待审改动（F29 / `uc-2-3` R3 步骤 4 / 契约 `templates.mergePendingChange`）。
 *
 * 洋葱：application → domain，仓储端口见 `merge-pending-change-ports.ts`。
 *
 * ## 只有蓝本维护者能合并（A1 / V5），且非维护者的尝试写审计
 *
 * `isMaintainer` 由调用方（未来的 controller）解析后传入——「蓝本维护者」的判据
 * 本身是 D-1 未裁（`KNOWN_CONTRACT_GAPS.T2` 逐字「裁定前不得写死」），本用例只消费
 * 判定结果，不去猜测"提出回提的引导师本人是不是维护者"这类具体判据。
 *
 * ⚠ **含提出回提的引导师本人在内**——V5 逐字要求这一点，而这里天然满足：
 * `isMaintainer` 是外部对"这个 actor 是不是维护者"的判定，与"这个 actor 是不是
 * 提出人"完全无关的两件事；把提出人排除在维护者之外从来不需要在这里特殊处理，
 * 只要外部判定没有把"是提出人"错当成"是维护者"的证据。
 *
 * 非维护者调用一律拒绝并写审计（`unauthorized-attempt`，同 `provenance.ts` 头注
 * 「被拒绝的动作没有留痕，等于攻击者可以无成本地反复试探」）——`deps.repo.mergeIntoDraft`
 * 在这条路径上**完全不会被调用**，蓝本草稿因此不可能被非维护者的尝试触及。
 *
 * ## 反查四要素（AC1 / V1）
 *
 * `traceable` 的四个字段直接取自待审改动记录本身（来源项目/提出人/时间/理由），
 * 契约把它们标成非 nullable——四者缺一即失败在这里体现为：这四个字段就是
 * `PendingChangeRecord` 早已具备的字段，合并只是把它们原样透传，不重新拼装。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import type { PendingChangeRecord } from "../../domain/templates/pending-change";
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import type { MergePendingChangeRepository } from "./merge-pending-change-ports";

export type MergePendingChangeOutput = z.infer<typeof templates.operations.mergePendingChange.out>;
export type MergePendingChangeErrorCode = z.infer<typeof templates.TemplateError>;

export class MergePendingChangeError extends Error {
  readonly reasonCode: MergePendingChangeErrorCode;
  constructor(reasonCode: MergePendingChangeErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "MergePendingChangeError";
  }
}

export interface MergePendingChangeInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  /** 外部解析结果——见文件头「只有蓝本维护者能合并」一节，本用例不猜判据 */
  readonly isMaintainer: boolean;
  readonly changeRequest: PendingChangeRecord;
}

export interface MergePendingChangeDeps {
  readonly repo: MergePendingChangeRepository;
  readonly provenance: ProvenanceWriter;
}

export async function mergePendingChangeUseCase(
  deps: MergePendingChangeDeps,
  input: MergePendingChangeInput,
): Promise<MergePendingChangeOutput> {
  if (!input.isMaintainer) {
    await deps.provenance.append({
      orgId: input.orgId,
      type: "unauthorized-attempt",
      actorId: input.actorId,
      target: { kind: "capability", id: input.changeRequest.blueprintId },
      detail: {
        action: "mergePendingChange",
        changeRequestId: input.changeRequest.changeRequestId,
        reasonCode: "NOT_BLUEPRINT_MAINTAINER",
      },
    });
    throw new MergePendingChangeError("NOT_BLUEPRINT_MAINTAINER");
  }

  await deps.repo.mergeIntoDraft({
    blueprintId: input.changeRequest.blueprintId,
    changeRequestId: input.changeRequest.changeRequestId,
    designFacetKey: input.changeRequest.designFacetKey,
    afterValue: input.changeRequest.afterValue,
  });

  return {
    blueprintDraftUpdated: true,
    traceable: {
      sourceProjectId: input.changeRequest.sourceProjectId,
      proposedBy: input.changeRequest.proposedBy,
      proposedAt: input.changeRequest.proposedAt,
      rationale: input.changeRequest.rationale,
    },
  };
}
