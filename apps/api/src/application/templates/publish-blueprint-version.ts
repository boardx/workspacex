/**
 * 用例：发布新版本（F22 / 契约 `templates.publishBlueprintVersion`）。
 *
 * 编排：先用组合门槛（`evaluatePublishGate`，F22 把 F17 的必填面与 F21 的试跑面 `&&`
 * 起来）判是否放行，放行后才调用版本生成（`publishNewVersion`）产出新版本与旧版归档。
 * ⚠ 门槛不通过时**不调用** `publishNewVersion`——这正是 I-3「失败不占号」在用例层的落点：
 * 版本号只在真正要生成版本时才被 `nextVersionNumber` 消费。
 *
 * 洋葱：application → domain，没有仓储端口——落库、并发（`VERSION_CHANGED`）与
 * 权限（`ROLE_INSUFFICIENT`/`PERMISSION_REVOKED_MIDWAY`）由调用方（尚未建的
 * `templates` 控制器，见 F17/F18/F19 同款缺口）在洋葱外层处理，本用例只负责
 * 「给定草稿状态与绑定集合，能不能发布、发布后是什么」这一段纯判定。
 */

import { templates } from "@repo/contracts";
import type { z } from "zod";
import {
  evaluatePublishGate,
  publishNewVersion,
  type PublishGateVerdict,
} from "../../domain/templates/publish-blueprint-version";
import type { BlueprintBinding } from "../../domain/templates/designer-shell";
import { DESIGN_FACET_DEFINITIONS, type DesignFacetRow } from "../../domain/templates/design-facet-table";
import type { BlueprintVersion } from "../../domain/templates/blueprint-version";

export type PublishBlueprintVersionOutput = z.infer<typeof templates.operations.publishBlueprintVersion.out>;
export type PublishGateErrorCode = z.infer<typeof templates.TemplateError>;

/**
 * 与 `set-duration-tier.ts` 的 `TemplateOperationError` **刻意不是同一个类**：
 * 那边的 `payload` 形状锁死在 `{ added, removed }`（换档位专属），本用例要带的是
 * `missingKeys`（`REQUIRED_CONFIG_INCOMPLETE` 的 detail 契约要求）——共用一个类
 * 就要么放宽成 `unknown`（丢类型），要么让一个类的字段服务两件不相关的事。
 */
export class PublishBlueprintVersionError extends Error {
  readonly reasonCode: PublishGateErrorCode;
  /** 仅 `REQUIRED_CONFIG_INCOMPLETE` 非空——契约 detail 要求指向具体缺项 */
  readonly missingKeys: readonly string[];

  constructor(reasonCode: PublishGateErrorCode, missingKeys: readonly string[] = []) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.missingKeys = missingKeys;
    this.name = "PublishBlueprintVersionError";
  }
}

export interface PublishBlueprintVersionInput {
  readonly blueprintId: string;
  readonly completedKeys: Iterable<string>;
  readonly bindings: readonly BlueprintBinding[];
  readonly history: readonly BlueprintVersion[];
  readonly currentVersion: BlueprintVersion | null;
  readonly content: Readonly<Record<string, unknown>>;
  readonly changedDesignFacetKeys: readonly string[];
  readonly newVersionId: string;
}

/**
 * ⚠ 抛出的 `PublishBlueprintVersionError` 的 `reasonCode` 恒是契约 `publishBlueprintVersion.err`
 * 的成员之一（`REQUIRED_CONFIG_INCOMPLETE` 或 `TRIAL_RUN_REQUIRED`）；`REQUIRED_CONFIG_INCOMPLETE`
 * 额外携带 `missingKeys`，供控制器接入错误 detail（同 `set-duration-tier.ts` 的 `payload` 惯例）。
 */
export function publishBlueprintVersionUseCase(
  input: PublishBlueprintVersionInput,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): PublishBlueprintVersionOutput {
  const verdict: PublishGateVerdict = evaluatePublishGate(input.completedKeys, input.bindings, table);
  if (verdict.blocked) {
    // reasonCode 非 null 是 verdict.blocked === true 的不变量（见 evaluatePublishGate）
    throw new PublishBlueprintVersionError(verdict.reasonCode!, verdict.missingKeys);
  }

  const { newVersion, archivedVersion } = publishNewVersion({
    blueprintId: input.blueprintId,
    history: input.history,
    currentVersion: input.currentVersion,
    content: input.content,
    changedDesignFacetKeys: input.changedDesignFacetKeys,
    newVersionId: input.newVersionId,
  });

  return {
    versionId: newVersion.id,
    versionNumber: newVersion.versionNumber,
    changedDesignFacetKeys: [...newVersion.changedDesignFacetKeys],
    archivedVersionId: archivedVersion?.id ?? null,
  };
}
