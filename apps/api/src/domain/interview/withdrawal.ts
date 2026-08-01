/**
 * `domain/interview/withdrawal.ts` —— F89（uc-6-3 R4/A4）：五步撤回的**纯计算**部分。
 *
 * ## 时限只有一个数值来源
 *
 * ⚠ 本文件**不**声明任何分钟/天数字面量。两级 SLA（D-15：逻辑失效 ≤5 分钟、物理删除
 * ≤30 天）唯一的可计算事实源是 `@repo/contracts/org-admin` 的 `WITHDRAWAL_SLA_MS`——
 * 与 `withdraw-participant-phone.ts`（F14）算 deadline 用的是同一常量。展示字符串
 * （给人看的 "≤5 分钟"）的事实源是 `apps/web/lib/withdrawal-flow.ts`，由
 * `lint-withdrawal-flow.mjs` 门控前端不出现第二份；后端这份只算日期，不渲染文案，
 * 不受该 lint 管辖，但共享同一条 D-15 裁决——改期时两处都要跟着 `WITHDRAWAL_SLA_MS` 走，
 * 而不是各自另起一个 5 / 30。
 *
 * ## 五步 ≠ 五个独立开关
 *
 * 01–03 是「逻辑失效」，**在同一次编排调用内完成**（不是排队等 5 分钟后台跑）——
 * `dueAt` 记录的是 D-15 允许的截止时限，`state: "done"` 证明实际完成时间 ≤ 该截止时限。
 * 04 是**人工步骤**，没有系统能保证的截止时限（E4 明说「超时的后果是催办，不是自动化」），
 * 所以 `dueAt` 恒为 `null`——写一个假的 SLA 截止时间会暗示系统能强制人在那之前处理完。
 * 05 是物理删除，**本 feature 只负责入队**（触发），真正执行归 22-files（uc-22-4）与
 * 17-gov（UC-17.2）——见 F14 头部注释同一分工原则，"只做触发，不做执行"。
 */
import { WITHDRAWAL_SLA_MS } from "@repo/contracts/org-admin";

export type WithdrawalStepStateValue = "done" | "needs-human" | "pending";

export interface WithdrawalStepRecord {
  readonly no: 1 | 2 | 3 | 4 | 5;
  readonly state: WithdrawalStepStateValue;
  readonly dueAt: string | null;
}

/**
 * 五步的静态描述，仅供服务端内部核对与测试断言引用——**不是**对外展示文案
 * （对外展示文案唯一来源是 `apps/web/lib/withdrawal-flow.ts`，本文件不复制其文案，
 * 只复制它已经拍板的「几步、时限属于哪一级 SLA」这个结构决定）。
 */
export const WITHDRAWAL_STEP_NOS = [1, 2, 3, 4, 5] as const;

export interface BuildWithdrawalStepsInput {
  readonly queuedAt: Date;
  /** 第 04 步：是否存在支撑过已签字决策的证据——存在则该步 `needs-human`，否则 `done`（无需人工）。 */
  readonly hasSignedDecisionImpact: boolean;
}

/**
 * 从「登记时刻」推出五步的初始状态。01–03 在编排函数里同步执行完，所以调用这个函数时
 * 传入的就是「已经做完 01–03 之后」的快照期望值——本函数只负责算 `dueAt`，
 * 真正跑 01–03 的副作用在 `application/interview/request-withdrawal.ts`。
 */
export function buildWithdrawalSteps(input: BuildWithdrawalStepsInput): WithdrawalStepRecord[] {
  const logicalDeadline = new Date(input.queuedAt.getTime() + WITHDRAWAL_SLA_MS.logicalRetire).toISOString();
  const physicalDeadline = new Date(input.queuedAt.getTime() + WITHDRAWAL_SLA_MS.physicalDelete).toISOString();

  return [
    { no: 1, state: "done", dueAt: input.queuedAt.toISOString() },
    { no: 2, state: "done", dueAt: logicalDeadline },
    { no: 3, state: "done", dueAt: logicalDeadline },
    // ⚠ 禁止自动改写结论——存在受影响的已签字决策时，本步永远停在「等人」，
    //   不存在系统自己把它标成 done 的路径。
    { no: 4, state: input.hasSignedDecisionImpact ? "needs-human" : "done", dueAt: null },
    { no: 5, state: "pending", dueAt: physicalDeadline },
  ];
}

/** 供 `issueDeletionReceipt` 复用：第 05 步真正完成前禁止发回执（E3 / `ERASURE_NOT_COMPLETE`）。 */
export function isPhysicalDeleteComplete(steps: readonly WithdrawalStepRecord[]): boolean {
  const step5 = steps.find((s) => s.no === 5);
  return step5?.state === "done";
}
