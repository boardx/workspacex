/**
 * `PublishAsset` (F137) -- `uc-23-4` R3 第五步 / R7 规则 1-2 / R9, domain I-5 / I-10 /
 * `PublishAsset`'s own contract comment.
 *
 * ## 三条独立的禁用条件 -- 缺一条就漏一条路径
 *
 * `GATE_NOT_PASSED`（I-5，`AssetGateStatusPort`，六道关本体见该端口文件头）·
 * `GOVERNANCE_INCOMPLETE`（I-10，治理记录从未配置过）·
 * `PREFLIGHT_HAS_BLOCKING_ITEM`（发布前检查仍有红色未完成项）。三者在本文件里是**三个
 * 独立的 if，各自可单独触发、各自返回各自的码**，不折叠成一个「不满足发布条件」。
 *
 * ⚠ **`GOVERNANCE_INCOMPLETE` 与 `PREFLIGHT_HAS_BLOCKING_ITEM` 在今天的数据形状上会重叠**
 * （F136 的发布前检查清单**完全**由治理四字段派生，`uc-23-5` 的试跑发现被 Q-0 推迟到
 * phase-2，尚未接入清单）——一个从未配置过治理的资产，`assetGovernanceMissingFields` 与
 * `assetPreflightItems` 会同时判它「不完整」。为了让这两条码仍然各自可独立触发（而不是
 * 「反正会一起红，无所谓判哪个」），本文件把它们钉在两个不同的判据上：
 *   1. `GOVERNANCE_INCOMPLETE` 只问「这个资产**从未**被治理过」（`governance.get()`
 *      返回 `null`，与 `GetAssetGovernance` 的 `null` 语义同一个判据，见 `ports.ts`）。
 *      正常写入路径下（`setAssetGovernance`）不可能留下一条"存在但不完整"的记录——
 *      写入前已经做过完整性检查——所以这条码对应的正是"没写过"这一种情形。
 *   2. `PREFLIGHT_HAS_BLOCKING_ITEM` 则对**已存在**的记录重新跑一遍 `assetPreflightItems`。
 *      正常流程下它此时必然全绿（同上），但这条检查不是摆设：F136 的清单是**派生视图**，
 *      未来 `uc-23-5` 试跑发现接入后，一条已配置齐全的治理记录仍可能带一条红色项——
 *      那正是这第二条 if 存在的理由，此刻先把判据钉在正确的输入（已持久化的记录）上，
 *      而不是等到 phase-2 接入试跑时才发现两条码从来没有分开过。
 * 这也是为什么 `publish-three-independent-blockers.test.ts` 能为 `GOVERNANCE_INCOMPLETE`
 * 单独构造反例（从未配置）、为 `PREFLIGHT_HAS_BLOCKING_ITEM` 单独构造反例（绕过
 * `setAssetGovernance`，直接用 repository 双份一条"存在但字段被清空"的记录，模拟未来
 * 试跑红项接入后的形状）——两者互不依赖。
 *
 * ## 审计（R9 / E6）
 *
 * 发布成功写 `asset-published`；`GATE_NOT_PASSED` 的拒绝也写审计（`unauthorized-attempt`，
 * 与 `reveal-contact.ts` 同一先例："被拒的尝试也要留痕"）——`uc-23-4` E6 逐字要求
 * "必须拒绝并写审计"，而不只是发布成功才留痕。`GOVERNANCE_INCOMPLETE` /
 * `PREFLIGHT_HAS_BLOCKING_ITEM` 的拒绝不在这里另写审计：两者都是调用方自己此前未完成的
 * 配置动作（不是一次越权尝试），F136/F134 各自的写路径已经是完整性判定的唯一来源。
 *
 * ## `reviewDueAt`（不变量）
 *
 * 委托给 `domain/asset/asset-review-clock.ts`（该文件头解释了为什么这不是 Q-7 的第二次
 * "30 天" 声明）。
 *
 * ⚠ `mode: "staged"`（灰度）语义待 Q-3：本用例接受该参数但**不基于它做任何分支**，
 * 直接发布与灰度发布走同一条发布逻辑——定义两者的差异就是替人类裁 Q-3。
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { assetPreflightItems } from "../../domain/asset/asset-preflight";
import { GOVERNANCE_FIELDS, type AssetGovernanceDraft } from "../../domain/asset/asset-governance";
import { deriveReviewDueAt } from "../../domain/asset/asset-review-clock";
import type { OrgId } from "../../domain/org-id";
import type { Clock } from "../auth/ports";
import type { IdentityRepository } from "../identity/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { AssetGateStatusPort, AssetGovernanceRepository } from "./ports";
import { AssetOrgScopeDeniedError } from "./get-asset-directory";
import { GovernanceIncompleteError } from "./set-asset-governance";

export type PublishAssetResult = z.infer<typeof C.operations.publishAsset.out>;

/** I-5: a landing-gate verdict for this asset is currently blocking. */
export class GateNotPassedError extends Error {
  readonly code = "GATE_NOT_PASSED" as const;
  constructor() {
    super("GATE_NOT_PASSED");
  }
}

/** The third independent blocker: the derived preflight checklist still has a red item. */
export class PreflightHasBlockingItemError extends Error {
  readonly code = "PREFLIGHT_HAS_BLOCKING_ITEM" as const;
  constructor(readonly blockingCount: number) {
    super(`PREFLIGHT_HAS_BLOCKING_ITEM: ${blockingCount}`);
  }
}

export interface PublishAssetDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly governance: AssetGovernanceRepository;
  readonly gates: AssetGateStatusPort;
  readonly provenance: ProvenanceWriter;
  readonly clock: Clock;
}

export interface PublishAssetInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
  readonly mode: z.infer<typeof C.PublishMode>;
}

export async function publishAsset(
  deps: PublishAssetDeps,
  input: PublishAssetInput,
): Promise<PublishAssetResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  // ① GATE_NOT_PASSED (I-5) -- checked first because, per E6, a blocked-gate publish attempt
  // must ALSO be denied even if governance/preflight would otherwise be clean; it is refused
  // and audited regardless of the other two conditions' state.
  if (await deps.gates.hasBlockingGate(input.assetKind, input.assetId)) {
    await deps.provenance.append({
      orgId: input.orgId,
      type: "unauthorized-attempt",
      actorId: input.userId,
      target: { kind: "asset", id: input.assetId },
      detail: { action: "asset.publishAsset", reasonCode: "GATE_NOT_PASSED", assetKind: input.assetKind },
    });
    throw new GateNotPassedError();
  }

  // ② GOVERNANCE_INCOMPLETE (I-10) -- "never configured", see file header on why this is the
  // narrower judgement rather than re-running the missing-fields check on a record that, by
  // construction of the only write path (`setAssetGovernance`), cannot exist half-filled.
  const record = await deps.governance.get(input.assetKind, input.assetId);
  if (record === null) throw new GovernanceIncompleteError([...GOVERNANCE_FIELDS]);

  // ③ PREFLIGHT_HAS_BLOCKING_ITEM -- re-derived from whatever IS persisted, independent of ②'s
  // null check (see file header).
  const draft: AssetGovernanceDraft = {
    visibility: record.visibility,
    teamIds: [...record.teamIds],
    editableBy: [...record.editableBy],
    ownerId: record.ownerId,
    reviewCycle: record.reviewCycle,
  };
  const items = assetPreflightItems(draft);
  const blockingCount = items.filter((item) => item.blocking && !item.passed).length;
  if (blockingCount > 0) throw new PreflightHasBlockingItemError(blockingCount);

  const publishedAt = deps.clock.now().toISOString();
  const reviewDueAt = deriveReviewDueAt(publishedAt, record.reviewCycle);

  const auditEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: "asset-published",
    actorId: input.userId,
    target: { kind: "asset", id: input.assetId },
    detail: {
      assetKind: input.assetKind,
      visibility: record.visibility,
      mode: input.mode,
      publishedAt,
      reviewDueAt,
    },
  });

  return { publishedAt, publishedBy: input.userId, reviewDueAt, auditEventId };
}
