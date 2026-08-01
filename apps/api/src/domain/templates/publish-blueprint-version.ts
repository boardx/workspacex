/**
 * 发布门槛的**组合面**与版本生成的**事务面**（F22 / `uc-2-1` AC3a+AC3b / I-3 / I-6 / I-7 / E6）。
 *
 * ## 为什么组合门槛住在这个新文件，而不是塞进 `publish-gate.ts` 或 `trial-run-gate.ts`
 *
 * `publish-gate.ts`（F17）与 `trial-run-gate.ts`（F21）的头注都已经写明：**各自只判一面**，
 * 且都明确交代「F22 落地时把两道门 `&&` 起来」。任何一道门单独变化都不该碰另一道的代码或
 * 测试——组合逻辑因此**必须**是第三个文件，否则给其中一个文件加组合逻辑，就等于让一个
 * 名叫「必填面」或「试跑面」的函数顺手覆盖了另一件事。
 *
 * ## 判定顺序：必填面先判
 *
 * 契约 `publishBlueprintVersion.err` 把 `REQUIRED_CONFIG_INCOMPLETE` 列在
 * `TRIAL_RUN_REQUIRED` 之前；`evaluatePublishGate` 沿用这个顺序——两道门都会阻断时，
 * 报错**恒定**指向必填面，不随调用方而漂移。
 *
 * ## 版本生成为什么在这里而不是 `blueprint-version.ts`
 *
 * `blueprint-version.ts`（F17）只落**版本号本身**的性质（I-3：单调递增/不复用/不缺号）。
 * 「发布一次产生哪些记录」——新版本 + 旧版归档**必须同时产生**（E6）——是发布这个
 * *用例* 的形状，不是版本号这个 *值* 的性质，所以它落在本文件而不是那个更底层的文件。
 * `publishNewVersion` 是纯函数：它一次性返回「新版本」与「被它顶替的旧版本」这一对，
 * 调用方不存在只拿到其中一个的路径——这就是本文件对「同事务」能给出的全部保证
 * （没有仓储层，落库时的真实原子性是外层持久化的事，见 `blueprint-version.ts` 头注同款免责）。
 *
 * ## I-3「失败不占号」在这里如何成立
 *
 * `publishNewVersion` 只在门槛通过之后才被调用（见 `application/templates/publish-blueprint-version.ts`）。
 * 门槛不通过时调用方直接抛错、根本不调用 `nextVersionNumber`，`history` 也不会追加新记录——
 * 所以下一次成功发布拿到的号，与「上次没有发生过那次被拒的尝试」时完全相同。
 */

import {
  evaluateRequiredFacetGate,
  type RequiredFacetGateVerdict,
} from "./publish-gate";
import { evaluateTrialRunGate } from "./trial-run-gate";
import type { BlueprintBinding } from "./designer-shell";
import { DESIGN_FACET_DEFINITIONS, type DesignFacetRow } from "./design-facet-table";
import { nextVersionNumber, type BlueprintVersion } from "./blueprint-version";

/** 组合门槛的失败面。⚠ 与契约 `publishBlueprintVersion.err` 的两个成员逐字对应 */
export type PublishGateReasonCode = "REQUIRED_CONFIG_INCOMPLETE" | "TRIAL_RUN_REQUIRED";

export interface PublishGateVerdict {
  readonly blocked: boolean;
  /** blocked=false 时恒 null。两道门都拦时恒为 `REQUIRED_CONFIG_INCOMPLETE`（判定顺序见头注） */
  readonly reasonCode: PublishGateReasonCode | null;
  /** 仅 `REQUIRED_CONFIG_INCOMPLETE` 时非空——契约要求该错误 detail 带 `missingKeys[]` */
  readonly missingKeys: readonly string[];
}

/**
 * 「必填的设计配置项已完成 ∧ 已试跑过一场」——两道并列门槛的 `&&`。
 *
 * ⚠ 这不是重新判定，是**编排**：真正的判定语句仍然分别活在
 * `evaluateRequiredFacetGate`（I-6）与 `evaluateTrialRunGate`（AC3a）里，
 * 本函数只决定「先问哪个、都不满足时报哪个」。
 */
export function evaluatePublishGate(
  completedKeys: Iterable<string>,
  bindings: readonly BlueprintBinding[],
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): PublishGateVerdict {
  const requiredVerdict: RequiredFacetGateVerdict = evaluateRequiredFacetGate(completedKeys, table);
  if (requiredVerdict.blocked) {
    return {
      blocked: true,
      reasonCode: "REQUIRED_CONFIG_INCOMPLETE",
      missingKeys: requiredVerdict.missingKeys,
    };
  }

  const trialVerdict = evaluateTrialRunGate(bindings);
  if (trialVerdict.blocked) {
    return { blocked: true, reasonCode: "TRIAL_RUN_REQUIRED", missingKeys: [] };
  }

  return { blocked: false, reasonCode: null, missingKeys: [] };
}

export interface PublishNewVersionInput {
  readonly blueprintId: string;
  /** 全部历史版本（含已归档的），用来算下一个号（I-3：历史最大号 + 1） */
  readonly history: readonly BlueprintVersion[];
  /** 当前版本；首次发布为 null —— 此时 `archivedVersion` 恒 null 才合法（契约注释） */
  readonly currentVersion: BlueprintVersion | null;
  /** 冻结快照：写入后不再改（I-2） */
  readonly content: Readonly<Record<string, unknown>>;
  readonly changedDesignFacetKeys: readonly string[];
  readonly newVersionId: string;
}

export interface PublishNewVersionResult {
  readonly newVersion: BlueprintVersion;
  /** 与 `newVersion` **同一次调用**产生——不存在只拿到其中一个的路径（见头注「同事务」） */
  readonly archivedVersion: BlueprintVersion | null;
}

/**
 * 生成 v(n+1) 与旧版归档——**一次调用产生一对，不是两次调用各产生一个**（E6）。
 *
 * ⚠ 只应在 `evaluatePublishGate(...).blocked === false` 之后调用；本函数自己不重复判门槛，
 * 那会让「谁负责阻断」出现两份权威。
 */
export function publishNewVersion(input: PublishNewVersionInput): PublishNewVersionResult {
  const versionNumber = nextVersionNumber(input.history);
  const newVersion: BlueprintVersion = {
    id: input.newVersionId,
    blueprintId: input.blueprintId,
    versionNumber,
    content: input.content,
    changedDesignFacetKeys: input.changedDesignFacetKeys,
    rolledBackFrom: null,
    state: "published",
  };
  const archivedVersion: BlueprintVersion | null = input.currentVersion
    ? { ...input.currentVersion, state: "archived" }
    : null;
  return { newVersion, archivedVersion };
}
