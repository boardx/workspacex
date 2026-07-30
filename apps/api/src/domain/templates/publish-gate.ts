/**
 * 发布门槛的**必填面**（F17 / I-6，`uc-2-1` AC3b / V6）。
 *
 * 不变量 I-6 逐字：判定语句恒为「**存在 `required = true` 且未完成的配置项 ⇒ 阻断**」，
 * **与具体是哪几项无关**。
 *
 * ## 这条为什么写成「由列驱动」而不是「第 N 项必填」
 *
 * 哪些项必填是**数据缺口 D-2**（O-18 ⑤：「清单本身无依据，仍需人类给出」）。
 * 把清单写进代码，等于替签核人做了决定，而且清单一改就要改代码和测试。
 * 写成读 `required` 列之后：清单怎么定都不改一行代码，
 * 也自然解释了原型里 `15/16` / `12/16` / `9/16` 仍可发布——**那些缺的项 `required = false`**
 * （D-9 / `KNOWN_CONTRACT_GAPS.T3`，这条和解**是推测性的，待人类确认**）。
 *
 * ## 这里刻意**不**做的事
 *
 * · **不做试跑门槛**（AC3a / `TRIAL_RUN_REQUIRED`）：`trialRunDone` 由谁置真是 D-6 未裁，
 *   在这里补一个「创建即算」会让那道门形同虚设（`KNOWN_CONTRACT_GAPS.T7` 逐字）。
 * · **不做「绑定 Skill 已降级未替换 ⇒ 阻断发布」**：原型明写那道门，
 *   而 `usecases.md` 的错误码表里**没有它的名字**（`KNOWN_CONTRACT_GAPS.T1`）。
 *   本文件不发明一个码来顶替。
 * ⇒ 所以本函数叫 `evaluateRequiredFacetGate`，不叫 `canPublish`：
 *   一个名叫「能不能发布」而只查了三道门里一道的函数，读起来像覆盖，而它没有。
 */

import {
  DESIGN_FACET_DEFINITIONS,
  requiredDesignFacetKeys,
  type DesignFacetRow,
} from "./design-facet-table";

export interface RequiredFacetGateVerdict {
  /** true ⇒ 拒绝发布，错误码 `REQUIRED_CONFIG_INCOMPLETE` */
  readonly blocked: boolean;
  /** ⚠ 契约 `REQUIRED_CONFIG_INCOMPLETE` 的 detail 逐字要求带 `missingKeys[]`：错误必须指向具体项 */
  readonly missingKeys: readonly string[];
}

export function evaluateRequiredFacetGate(
  completedKeys: Iterable<string>,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): RequiredFacetGateVerdict {
  const done = new Set(completedKeys);
  const missingKeys = requiredDesignFacetKeys(table).filter((key) => !done.has(key));
  return { blocked: missingKeys.length > 0, missingKeys };
}
