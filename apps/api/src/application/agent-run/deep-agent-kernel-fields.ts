/**
 * issue #3132（B7）—— deep-agent 专属的内核请求字段，从 `execute-run.ts` 抽出来的独立模块。
 *
 * 为什么单独一个文件：`execute-run.ts` 有一条棘轮门（`execute-run-thin-gateway.test.ts`
 * 的 R7），钉住它「退化为薄网关」后不许再膨胀回胖网关。B7 的计划确认门要往内核请求里
 * 加一个字段，加在那边就等于往网关里继续堆判定——正确的形状是 `invokeKernel` 已经
 * 示范过的那个：**判定住在自己的文件里，网关只负责把结果摊进请求**。
 *
 * 这里放的是「哪些字段只有 deep-agent provider 会读、以及在什么条件下才该出现」这一类
 * 判定。别的 provider 读不到这些键，所以「不填」与「填空值」在内核侧不是同一件事——
 * 每个字段各自的缺席语义写在下面。
 */
import { PLAN_CONFIRM_MIN_STEPS } from "@repo/contracts/plan-control";
import { selectL2SkillNames, type SkillRiskEntry } from "../../domain/agent-run/skill-risk-level";

export interface DeepAgentKernelFieldsInput {
  /** 本轮 run 是否跑在 deep-agent runtime 上。非 deep-agent run 一个字段都不填。 */
  readonly isDeepAgentRun: boolean;
  /** 本轮 pin 住的 skill 数量（`toolSkills.length`）。 */
  readonly mountedSkillCount: number;
  /** 本轮 skill 的风险分级结果。 */
  readonly skillRisks: readonly SkillRiskEntry[];
}

export interface DeepAgentKernelFields {
  readonly hitlSkillNames?: readonly string[];
  readonly planConfirmMinSteps?: number;
}

/**
 * 组装 deep-agent 专属的内核请求字段。返回的对象直接摊进 `invokeKernel` 的入参；
 * **键缺席本身是信号**，不要改成「总是返回全部键、用 `undefined` 表示没有」。
 */
export function buildDeepAgentKernelFields(input: DeepAgentKernelFieldsInput): DeepAgentKernelFields {
  if (!input.isDeepAgentRun) return {};
  return {
    // issue #2767 -- 只有 deep-agent run 会真的经过 `call_skill`/interrupt_on。
    // `mountedSkillCount === 0`（没挂任何 skill）时不填这个键——键缺席在内核侧是
    // "每次都问"的保守默认（fail-closed，T2 锁：`deep-agent-produces-files.test.ts`）；
    // 只要挂了至少一个 skill，就该投影真实计算结果（哪怕是空数组——"挂的全是
    // L0/L1，一个都不用问"本身就是一个真实、该被投影的结论，不是"没算"）。
    ...(input.mountedSkillCount > 0 ? { hitlSkillNames: selectL2SkillNames(input.skillRisks) } : {}),
    // issue #3132（B7）—— 计划确认门的步骤数阈值。与上面 `hitlSkillNames` 不同，这里
    // **不**看挂没挂 skill：这道门管的是「模型产出多步计划后停下等确认」，与本轮挂了
    // 哪些 skill 无关。阈值取契约常量，不在这里重新决定一个数字。
    planConfirmMinSteps: PLAN_CONFIRM_MIN_STEPS,
  };
}
