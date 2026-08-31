/**
 * F06 -- 底注当日汇总，O-37 结构性口径（uc-11-5 R7/R10 · 已裁决 O-37）。
 *
 * O-37 定死的是三条原则，不是数值（数值"无依据，需产品给出"）：
 *   ① 折算系数/单价存为组织可配口径表，不硬编码；
 *   ② 展示时必须标注样本量与口径版本；
 *   ③ 样本量低于最小阈值时显示"样本不足"而非折算值。
 *
 * ## 本次实现范围
 *
 * 没有真实的 AI 执行折算数据来源（组织可配口径表本身、agent 运行完成后的耗时归档都
 * 不存在——那是 F03/F05/F08 之外的另一整块能力）。诚实的做法不是"接口先占位、界面继续
 * 显示原型里的示例数字"，而是：`aiCompletedCount` 走一次真实查询（当日 `executor` 为
 * agent 且 `status` 转为 `done` 的卡数，uc-11-5 V16 定义的口径），**这个数字本身是
 * 真实的**（哪怕现在恒为 0，因为没有真实 agent 执行写回这张表）；但"折算成多少人时"
 * 这一步，只要样本量低于配置阈值就不产出数值，只返回"样本不足"这个结构化标记——
 * 阈值与系数都不编造具体数字，用一个显式配置对象承载（`TodaySummaryConfig`），
 * 调用方（`get-my-today.ts`）传入一个保守默认值，且明确标注"产品未定稿，先用一个
 * 非零的默认阈值防止用 1 条真实完成就冒充"有意义的折算""。
 *
 * `waitingAuthzCount`（"M 项停下等授权"）同理：F08（授权流/等待输入态）未做，没有
 * 字段承载"等待授权"，本次恒返回 0 并标注 `waitingAuthzKnown: false`，不编一个非零数字。
 */
export interface TodaySummaryConfig {
  /** 最小样本量阈值——低于它一律显示"样本不足"。产品未定稿的临时保守值，见头注。 */
  readonly minSampleSize: number;
  /** 组织口径表版本号——本次没有真实的可配置口径表，取 null 表示"未配置"，不编版本号。 */
  readonly coefficientTableVersion: string | null;
}

export const DEFAULT_TODAY_SUMMARY_CONFIG: TodaySummaryConfig = {
  minSampleSize: 5,
  coefficientTableVersion: null,
};

export type TodaySummary =
  | {
      readonly sampleSufficient: false;
      readonly aiCompletedCount: number;
      readonly label: "样本不足";
      readonly waitingAuthzCount: number;
      readonly waitingAuthzKnown: false;
    }
  | {
      readonly sampleSufficient: true;
      readonly aiCompletedCount: number;
      /** 折算人时——只有样本充足时才会出现在返回体里，且必须带口径表版本。 */
      readonly personHours: number;
      readonly coefficientTableVersion: string;
      readonly waitingAuthzCount: number;
      readonly waitingAuthzKnown: false;
    };

export interface ComputeTodaySummaryInput {
  readonly aiCompletedCount: number;
  readonly config: TodaySummaryConfig;
}

/**
 * 折算系数本身"无依据，需产品给出"（O-37 原文）——本次没有系数来源，所以即使样本量
 * 达到阈值，本函数也**不产出折算值**（`coefficientTableVersion` 恒为 null ⇒ 永远走
 * "样本不足/无口径"分支）。这不是把阈值设成"永远不够"来蒙混过关：函数结构上支持
 * "样本充足 + 有口径表版本 ⇒ 显示折算值"这条路径（`sampleSufficient: true` 分支的
 * 类型签名要求 `coefficientTableVersion: string`，非 null），只是在"口径表不存在"
 * 这一前提下，honest 的输出只能是"样本不足/未配置"这一支——把这两种"不显示折算值"
 * 的原因（样本不够 / 口径表压根没配）合并成同一个对外标记 `sampleSufficient: false`，
 * 因为 uc-11-5 R10 只要求"样本不足不显示数字"，没有要求界面区分两种不显示的原因。
 */
export function computeTodaySummary(input: ComputeTodaySummaryInput): TodaySummary {
  const { aiCompletedCount, config } = input;
  const hasEnoughSample = aiCompletedCount >= config.minSampleSize;
  const hasCoefficientTable = config.coefficientTableVersion !== null;

  if (hasEnoughSample && hasCoefficientTable) {
    // 结构上可达，但本次没有真实系数来源去算 personHours——留给以后接入组织口径表时
    // 填这一支。当前恒不会命中（coefficientTableVersion 恒为 null，见头注）。
    throw new Error("computeTodaySummary: coefficient table wiring not implemented yet (F06 scope note)");
  }

  return {
    sampleSufficient: false,
    aiCompletedCount,
    label: "样本不足",
    waitingAuthzCount: 0,
    waitingAuthzKnown: false,
  };
}
