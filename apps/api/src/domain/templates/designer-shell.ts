/**
 * 蓝本设计器**外壳**的领域派生（F18 / `uc-2-1` R3 §3.0 + R8）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。外壳要显示的每一个数字都在这里算出来，
 * 界面只负责把它们摆进句子里。
 *
 * ## 这里刻意**没有**那句版本语义提示
 *
 * 「改动生成 v5，已开过的项目锁在自己的版本上」是**界面文案**（R8「必须原样呈现」清单），
 * 它属于渲染层。本文件给的是这句话里的**变量**（下一版号、已发布版号、用过 N 次），
 * 而不是句子本身——把成句的中文放进领域层，等于让同一句话在后端和前端各存一份，
 * 而本仓已九次因「同一事实声明在两处」漂移。
 * ⇒ 分工是可断言的：**数字错了后端测试红**（本文件的测试），
 *   **句子少了一半前端测试红**（`blueprint-designer-shell.test.tsx` 逐字断言那半句）。
 *
 * ## 这里刻意**不**做的事
 *
 * · **不判定「能不能发布」**：三道门里只有必填那道属 F17（`publish-gate.ts`），
 *   试跑判据是 D-6 未裁（`KNOWN_CONTRACT_GAPS.T7`：现按「创建即算」会让门槛形同虚设），
 *   降级 Skill 那道连错误码都没有（T1）。本文件只给按钮**标签上的版本号**，
 *   一个名叫 `deriveDesignerActions` 而顺手判了发布权的函数，读起来像覆盖，而它没有。
 * · **不数配置项**：目录与分母全部来自 `design-facet-table`，本文件一个 key 都不列。
 */

import {
  DESIGN_FACET_DEFINITIONS,
  requiredDesignFacetKeys,
  type DesignFacetRow,
} from "./design-facet-table";
import {
  displayVersionNumber,
  nextVersionNumber,
  type BlueprintState,
  type BlueprintVersion,
} from "./blueprint-version";

/** 外壳顶部版本条要用到的**全部变量**。⚠ 没有成句的文案，见文件头 */
export interface VersionBarFacts {
  readonly state: BlueprintState;
  /** 已发布版号；草稿态为 null（uc-2-4 R7：**不是 0**，「没有版本号」不是「第 0 版」） */
  readonly publishedVersionNumber: number | null;
  /** 「改动生成 v?」里的那个号 = 历史最大号 + 1（I-3，不是「已发布数 + 1」） */
  readonly nextVersionNumber: number;
  /** 「用过 N 次」。⚠ 试跑不计入（I-22），故它由 `countAppliedProjects` 得出而不是数全部绑定 */
  readonly appliedProjectCount: number;
}

/**
 * 一次绑定。`trial-run` 是**试跑实例**，`project` 是正式套用。
 *
 * ⚠ 两者刻意是同一张表上的两个值而不是两张表：I-22 要守的是
 * 「试跑**不计入**用过次数」，而一个根本不记录试跑的模型使这条不变量无从违反，
 * 也就无从证明——`countAppliedProjects` 的反证用例正需要一条试跑绑定才写得出来。
 */
export interface BlueprintBinding {
  readonly kind: "project" | "trial-run";
}

/** I-22：只有正式套用计数。⚠ 不是 `bindings.length` */
export function countAppliedProjects(bindings: readonly BlueprintBinding[]): number {
  return bindings.filter((b) => b.kind === "project").length;
}

export function deriveVersionBar(
  blueprint: { readonly state: BlueprintState; readonly bindings: readonly BlueprintBinding[] },
  history: readonly BlueprintVersion[],
  currentVersion: BlueprintVersion | null,
): VersionBarFacts {
  return {
    state: blueprint.state,
    publishedVersionNumber: displayVersionNumber(blueprint.state, currentVersion),
    nextVersionNumber: nextVersionNumber(history),
    appliedProjectCount: countAppliedProjects(blueprint.bindings),
  };
}

/**
 * 三个动作（R3 §3.0，顺序即原型顺序）。
 *
 * `publish` 带的 `versionNumber` 就是版本条里的 `nextVersionNumber` —— **同一个数**，
 * 不是各算一次：按钮上写 v5 而提示句写 v6 的那一天，用户没法知道该信哪个。
 */
export const DESIGNER_ACTION_IDS = ["preview-participant-view", "trial-run", "publish"] as const;
export type DesignerActionId = (typeof DESIGNER_ACTION_IDS)[number];

export interface DesignerAction {
  readonly id: DesignerActionId;
  /** 仅 `publish` 非 null：按钮上要显示的版本号 */
  readonly versionNumber: number | null;
}

export function deriveDesignerActions(facts: VersionBarFacts): readonly DesignerAction[] {
  return DESIGNER_ACTION_IDS.map((id) => ({
    id,
    versionNumber: id === "publish" ? facts.nextVersionNumber : null,
  }));
}

/**
 * 完成度可点击 ⇒ 直达**第一个未完成的必填项**（R8 推荐交互）。
 *
 * ⚠ 今天恒返回 null，因为表里 `required` 全 false（**数据缺口 D-2**，不是没有实现）。
 * 界面据此显示「无未完成必填项」而不是一个点不动的死链接——
 * 「没有可跳的目标」与「跳转坏了」在界面上必须可分辨。
 * 一旦人类给出必填清单，改表即生效，本函数与界面一行都不用改。
 */
export function firstIncompleteRequiredFacet(
  completedKeys: Iterable<string>,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): string | null {
  const done = new Set(completedKeys);
  return requiredDesignFacetKeys(table).find((key) => !done.has(key)) ?? null;
}
