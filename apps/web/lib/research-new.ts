/**
 * F144 · 新建深度研究：**入口可见性**与**提交前校验**的纯逻辑
 * （`24-research/uc-24-1` R3 / R5 / E2 / E5 · 契约束 `research`）
 *
 * ## 为什么单独一个模块而不是写在组件里
 * 「观察者看不到入口」这条要断的是 **DOM 里根本没有那个节点**（N-10 / uc-24-1 E5 逐字
 * 「入口按钮**不渲染**，不是渲染后禁用」）。把判定写在组件内部的 `className` 或
 * `disabled` 上，测试就只能断样式——**灰按钮在 API 层挡不住任何东西**。
 * 判定抽成一个纯函数后，组件只剩下「假 ⇒ `return null`」一行，断言才打得到「节点不存在」。
 *
 * ## 这里**没有**什么
 * · **没有** `canStartResearch` 的第二份角色表。角色与「能不能写」的单一事实源是
 *   `lib/mock/project.ts` 的 `ROLE_CAN_WRITE`（四视角投影），本文件从它派生。
 *   写第二份 `{ observer: false }` 就是本仓已踩过五次的「同一事实声明在两处」。
 * · **没有**七项配置的默认值。它们的单一事实源是 `lib/mock/research-studio.ts`
 *   的 `RS_CONFIG_DEFAULT`（`uc-24-1` R3 表逐项机械抽取，R7.5「不得自行改向」）。
 * · **没有**「可判定性打分」。`uc-24-1` E2 逐字：系统**不做**语义判定，只做非空校验。
 * · **没有** `sourcePrefs` 的 `.min(1)`。来源全不选的语义是 **Q-5 未裁**，
 *   契约 `ResearchConfig.sourcePrefs` 刻意没有 `.min(1)`，本文件不替它裁。
 */
import { ROLE_CAN_WRITE, type ProjectRole } from "@/lib/mock/project";
import type { RsConfig } from "@/lib/mock/research-studio";

/**
 * 三处入口（`uc-24-1` R2 触发条件 / R8 前端入口）。
 *
 * ⚠ 三条都**逐字**取自原型，字节出处写在这里而不是散在组件里：
 *   · `studio`  研究 Studio 列表页  `＋ 新建研究`      `[原型 @16,780,654B]`（`res.newLabel`）
 *   · `project` 项目内深度研究标签  `＋ 新建深度研究`  `[原型 @15,326,428B]`
 *   · `live`    现场深度研究        `＋ 发起研究`      `[原型 @15,494,388B]`
 */
export const RESEARCH_ENTRY_POINTS = [
  { at: "studio", label: "＋ 新建研究", where: "研究 Studio 列表页" },
  { at: "project", label: "＋ 新建深度研究", where: "项目内「深度研究」标签" },
  { at: "live", label: "＋ 发起研究", where: "现场「深度研究 · 现场」" },
] as const;

export type ResearchEntryAt = (typeof RESEARCH_ENTRY_POINTS)[number]["at"];

/** 入口节点的 `data-testid` —— 三处共用同一构造，测试与实现不各写一份。 */
export function researchEntryTestId(at: ResearchEntryAt): string {
  return `rs-entry-${at}`;
}

/**
 * 谁能发起深度研究（`uc-24-1` R5）。
 *
 * 引导师 / 组长 / 组员 **可以**（组员的范围限本组，是 `groupRef` 的事，不是可见性的事）；
 * **观察者不能**——原型逐字「观察者只读：不能发言、**不能触发 agent**」`[原型 @15,415,445B]`，
 * 小组能力面 `actions` 在 `roleNow === "obs"` 时**返回空数组** `[原型 @16,943,050B]`。
 *
 * ⚠ 派生自 `ROLE_CAN_WRITE`，**不是**在这里再写一次 `observer: false`。
 * ⚠⚠ 这是**界面投影，不是权限实现**。真实权限在服务端（契约 `createResearch.err` 的
 *   `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT`）。前端隐藏即安全是被禁的（UC-0.3 R5）。
 */
export function canStartResearch(role: ProjectRole): boolean {
  return ROLE_CAN_WRITE[role];
}

/**
 * 提交前校验（`uc-24-1` E2）。
 *
 * 只有一条：`question` 非空。契约面的对应表达是 `ResearchConfig.question` 的 `.min(1)`
 * ——**不是**一个域错误码（`createResearch.err` 里刻意没有 `VALIDATION_FAILED`）。
 *
 * ⚠ `scene` **不校验**：R3 表里它是长文本，UC 没有要求非空，不替它加。
 * ⚠ `sources` 空数组 **不拦**（Q-5 未裁），由预览句显式提示「未选来源」。
 */
export interface ResearchConfigErrors {
  question?: string;
}

export function validateResearchConfig(c: RsConfig): ResearchConfigErrors {
  const errors: ResearchConfigErrors = {};
  if (c.question.trim() === "") errors.question = "要回答的问题必填；系统只做非空校验，不做语义可判定性判定。";
  return errors;
}

export function isResearchConfigValid(c: RsConfig): boolean {
  return Object.keys(validateResearchConfig(c)).length === 0;
}
