/**
 * 用例：换时长档位（F19 / `uc-2-1` R3 步骤 1 + AC4）。
 *
 * 只做编排：把领域函数 `planDurationTierChange` 的判定结果映射成契约的错误码。
 * 洋葱：application → domain，没有仓储端口——议程环节表是产品的结构定义，每个组织都
 * 一样（同 F18 的 design-facet 表），存储层「当前档位是什么」由调用方（尚未建的
 * `templates` 控制器，见 F17/F18 同款缺口）读出后传入，本函数不关心它从哪来。
 *
 * ⚠ `TIER_CHANGE_NEEDS_CONFIRMATION` 抛出时把「将被增删的议程环节清单」放进
 * `TemplateOperationError.payload`——契约注释逐字要求这份清单要能带给调用方
 * （A2「已填内容不得静默丢弃」），但把它接进 HTTP 响应体需要 `all-exceptions.filter.ts`
 * 那一类显式豁免（同 `TEAM_IN_USE` 的 `blocked` payload），而 `templates` 束今天还没有
 * 控制器（F17/F18 同款缺口）。`payload` 先留在这里，等控制器落地时再接。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import {
  planDurationTierChange,
  type AgendaSegmentRefLike,
  type PlanDurationTierChangeInput,
} from "../../domain/templates/duration-tier";

export type SetDurationTierInput = z.infer<typeof templates.operations.setDurationTier.in>;
export type SetDurationTierOutput = z.infer<typeof templates.operations.setDurationTier.out>;
export type TemplateErrorCode = z.infer<typeof templates.TemplateError>;

/** 一个类携带契约里的一个错误码，同 `ProjectError` / `OrgAdminError` 的形状。 */
export class TemplateOperationError extends Error {
  readonly reasonCode: TemplateErrorCode;
  /** 见文件头：确认门槛抛出时携带将被增删的清单，供未来的控制器层接入响应体 */
  readonly payload?: { readonly added: readonly AgendaSegmentRefLike[]; readonly removed: readonly AgendaSegmentRefLike[] };

  constructor(
    reasonCode: TemplateErrorCode,
    payload?: { readonly added: readonly AgendaSegmentRefLike[]; readonly removed: readonly AgendaSegmentRefLike[] },
  ) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.payload = payload;
    this.name = "TemplateOperationError";
  }
}

export function setDurationTier(input: PlanDurationTierChangeInput): SetDurationTierOutput {
  const result = planDurationTierChange(input);

  if (result.kind === "custom-tier-undefined") {
    throw new TemplateOperationError("CUSTOM_TIER_RULE_UNDEFINED");
  }
  if (result.kind === "confirmation-required") {
    throw new TemplateOperationError("TIER_CHANGE_NEEDS_CONFIRMATION", {
      added: result.added,
      removed: result.removed,
    });
  }

  return {
    agendaSegmentCount: result.agendaSegmentCount,
    added: [...result.added],
    removed: [...result.removed],
    recoverable: [...result.recoverable],
  };
}
