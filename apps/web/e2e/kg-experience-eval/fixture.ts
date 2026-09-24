/**
 * phase-18 F15 记忆体验评测集的账号与栈常量——**唯一事实源**。
 *
 * `playwright.kg-experience-eval.config.ts` 把这些值下发给种子脚本（`apps/api/scripts/seed-kg-experience-eval.ts`）
 * 与 API 进程；评测用例从这里读。两头各写一份字面量，改了一头就会「登录失败」而不是报出真正的原因。
 *
 * 四个账号，各司其职（同一组织、各自的个人对话，互不共享记忆）：
 *   - owner：主用户（P1/P2）。E2–E8 都在他的个人对话里跑，E10 的「开启记忆、有记忆可用」那一侧也是他。
 *   - newbie：E1「新用户什么都不设置」——一个从没聊过的人，记忆从零开始。
 *   - other：E9 的另一个账号（同组织），拿 owner 的记忆链接去看，必须被拒。
 *   - idle：E10「没有记忆」那一侧的对照（从没聊过，召回恒为空）。
 */
export const KG_EVAL = {
  orgId: "org-kg-experience-eval",
  projectId: "project-kg-experience-eval",
  owner: { userId: "user-kg-eval-owner", email: "kg-eval-owner@example.test", password: "Kg-Eval-owner-F15!", name: "王经理" },
  newbie: { userId: "user-kg-eval-newbie", email: "kg-eval-newbie@example.test", password: "Kg-Eval-newbie-F15!", name: "新同事" },
  other: { userId: "user-kg-eval-other", email: "kg-eval-other@example.test", password: "Kg-Eval-other-F15!", name: "隔壁同事" },
  idle: { userId: "user-kg-eval-idle", email: "kg-eval-idle@example.test", password: "Kg-Eval-idle-F15!", name: "对照同事" },
  /** 组织里唯一可运行的 Agent：名字就是产品默认 Agent 的名字，用户不用挑（零设置，E1）。 */
  agentId: "agent-kg-eval-default",
  /** 被 run 快照钉住、与 API 的 `KERNEL_MODEL_PROVIDER` 全等比较的 provider 名（配置值，不是模型名）。 */
  modelProvider: "kg-eval-loopback",
  modelId: "kg-eval-grounded",
} as const;

export interface KgEvalAccount {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
}
