/**
 * 2026-09-22 —— 「计划里每一步都被标成完成了，可是这次执行失败了」这一幕。
 *
 * ## 这不是显示 bug，两句话都是真的
 *
 * 人类那张截图里，三条步骤全是绿勾 + 「3/3 步已标记完成」，同一屏上却写着「这次任务执行失败」。
 * 两者都没说错：步骤状态是**模型自己调 `write_todos` 写下的声明**，而失败是执行器对这一轮
 * 的判定。问题在于界面把「模型说它做完了」渲染得和「东西真的产出来了」一模一样，于是用户
 * 唯一能得到的结论是「这软件自相矛盾」。
 *
 * ## 所以这里补的是一句**解释**，不是改任何一个状态
 *
 * 不去把绿勾改成红叉——那会把模型真的完成了的步骤说成失败，是另一个方向的谎。
 * 也不隐藏失败横幅。只在这两件事同时成立时，明说「这些勾是模型自己打的」。
 *
 * 判据只有一个输入：这一轮的步骤状态。**刻意不读 `errorCode` / `failureReason`**——
 * 那两个回答的是「为什么失败」，这里回答的是「为什么屏幕上看起来自相矛盾」。
 */

export interface PlanStepStatusLike {
  readonly status: string;
}

export const PLAN_ALL_DONE_BUT_FAILED_NOTE =
  "计划里的每一步都被标成「完成」了——那些勾是模型自己打的，代表它认为该做的动作做完了，"
  + "不代表产物真的生成并保存下来了。这一轮最终没有产出可用结果，所以仍然算失败。";

/**
 * 这一轮该不该多说那一句。`null` = 不该（不是空字符串：空字符串会被渲染成一行空白）。
 *
 * 三条边界都有意义：
 *   · run 没失败 ⇒ 不说（成功时这句话只会让人怀疑自己的产物）
 *   · 一步都没有 ⇒ 不说（模型连 `write_todos` 都没调过，屏幕上没有任何勾，没有矛盾可解释）
 *   · 还有步骤没完成 ⇒ 不说（那一幕本来就自洽：失败在某一步上，界面已经指出是哪一步）
 */
export function planAllDoneButFailedNote(
  steps: readonly PlanStepStatusLike[],
  runFailed: boolean,
): string | null {
  if (!runFailed || steps.length === 0) return null;
  return steps.every((s) => s.status === "completed") ? PLAN_ALL_DONE_BUT_FAILED_NOTE : null;
}
