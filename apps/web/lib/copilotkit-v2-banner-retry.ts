/**
 * 人类 2026-09-16 截图复盘 —— 「一次失败，只给一个恢复入口」的唯一判据。
 *
 * ## 修的是什么
 *
 * 一条**有计划**的 run 失败时，屏幕上同时出现过两个「重试」，语义完全不同：
 *
 *   · 计划面板的「重试该步」（`PlanFailureRecovery` → UC-10 `retryPlanStep(failedStepId)`）
 *     —— 把失败那步及其后续置回 `pending`、**保留已完成步骤**再续跑；
 *   · 失败横幅的「重试」（`copilotkit-v2-panel-body.tsx` 的 `send(lastSentRef)`）
 *     —— 重发上一条用户消息，**整轮从零再来**，已经跑完的步骤白跑。
 *
 * 两者不是两种能力，是同一件事的两种做法。而横幅贴着输入框、是红色的、离视线最近，
 * 用户几乎必然点它——于是「能保住进展」的那条路径恰恰在最需要它的时刻被盖住。
 * 收敛方向与本仓一贯纪律一致：**留下保住进展的那一个**，另一个收起。
 *
 * ## 收起的是「怎么恢复」，不是「出了什么错」
 *
 * 横幅本身照常显示：成因（`describeFailedRunBanner`，`agent_runs.failure_reason` 的
 * 权威读）是计划面板的 `errorCode` 文案给不出的那一半信息。这里只决定**要不要再给
 * 一个语义不同的按钮**。
 *
 * ## fail open
 *
 * `planStepRecoveryOffered` 由计划面板如实回报（它是唯一在读账本的人）。账本还没
 * 追上（轮询最多 3 秒）、或这条失败根本没有计划可恢复时为 `false` ⇒ 横幅照旧给
 * 重试，行为与改动前逐字一致。**绝不会出现两个入口都没有的空窗。**
 */
export function shouldOfferBannerRetry(input: {
  /** 这一轮真的有一条已发出的用户消息可以重发（`lastSentRef.current !== null`）。 */
  readonly hasResendableMessage: boolean;
  /** 已经有一轮在跑——重试入口此刻无意义。 */
  readonly agentIsRunning: boolean;
  /** 计划面板此刻已经给出了步骤级恢复入口（保留进展的那一个）。 */
  readonly planStepRecoveryOffered: boolean;
}): boolean {
  return input.hasResendableMessage && !input.agentIsRunning && !input.planStepRecoveryOffered;
}
