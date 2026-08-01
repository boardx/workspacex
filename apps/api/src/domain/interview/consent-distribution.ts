/**
 * 同意位的**分发**——把受访者提交的四个原始同意位，派生成四条下游链路各自能不能跑
 * 的布尔开关（F87 / uc-6-3 R3 第 5 步、R7）。纯函数，最内层，没有库、没有 HTTP。
 *
 * ## 为什么这是一个独立的派生层，而不是直接拿 `ConsentBits` 当过滤器用
 *
 * `submitConsent`（F86）原样落库受访者勾的四位——**不做任何校验或改写**（那个函数的
 * 文件头写得很清楚：校验会把「全部拒绝」变成特殊分支，契约明说它不是）。但 R3 第 5 步
 * 明确写了四条链路之间有**级联关系**，不是四个各自独立生效的开关：
 *
 *   · `录音 = 否` ⇒ 不采集、不进转写——**即使受访者同时勾了"转成文字稿"也没有意义**，
 *     因为根本没有音频可转。
 *   · `转成文字稿 = 否` ⇒ 只留音频不落逐字稿；`交给 AI 分析` 建立在"有文字稿可喂"之上，
 *     所以 AI 分析同样谈不上，即使那一位单独是 `true`。
 *   · `交给 AI 分析 = 否` ⇒ 该人一切片段排除出 AI 输入（已裁决 O-05，两处：AI 副驾驶
 *     输入 + 合并同类观点/候选洞察）。
 *   · `报告中署名与职务` —— **唯一真正独立**的一位：它管的是"引述里怎么称呼你"，
 *     跟录不录音、转不转写、喂不喂 AI 完全无关，全部拒绝时它依然可以是 `true`。
 *
 * 如果把 `ConsentBits` 原样当四个开关分别喂给四条管线，会出现"没录音却允许转写任务
 * 跑"这种荒谬状态——那不是受访者的选择被尊重，是实现偷懒。这个文件把级联关系钉死
 * 在一个纯函数里，下游任何一条管线（F87 之后的录制/转写/Context Pack 过滤/报告署名）
 * 只需要读这一份 `ConsentDistribution`，不需要各自重新推导"没录音是不是也不能转写"
 * 这条规则。
 *
 * ⚠ **本文件只建模型，不接管道**——Context Pack 构建阶段的 per-speaker 前置过滤、
 * 转写任务的实际拒绝，属于 R11 拆分出的其它 feature（⑤），本文件只保证它们将来读到
 * 的是同一份不矛盾的派生结果。
 */
import type { ConsentBits } from "./subject";

/** 四条链路各自的"当前是否被允许跑"。都是**派生**布尔值，磁盘上不单独存这四个字段。 */
export interface ConsentDistribution {
  /** 是否允许为这个人录音。恒等于 `bits.record`——这是级联的起点，不依赖任何其它位。 */
  readonly recordingAllowed: boolean;
  /** 是否允许把这个人的录音落成逐字稿。没有录音就没有音频可转，与 `transcript` 位取与。 */
  readonly transcriptPersistAllowed: boolean;
  /** 是否允许把这个人的片段喂给任何 AI 分析（副驾驶输入 / 合并同类观点 / 候选洞察）。 */
  readonly aiAnalysisAllowed: boolean;
  /** 报告中是否可以署真实姓名与职务。唯一与前三者完全独立的一位。 */
  readonly attributionAllowed: boolean;
}

/**
 * `ConsentBits` → `ConsentDistribution` 的唯一实现。
 *
 * ⚠ `bits` 里全为 `false`（`[全部拒绝]`）是合法输入，不特殊处理、不抛错——
 *   算出来的分发结果也全为 `false`，访谈照常可以进行（人工笔记路径）。
 */
export function deriveConsentDistribution(bits: ConsentBits): ConsentDistribution {
  const recordingAllowed = bits.record;
  const transcriptPersistAllowed = bits.record && bits.transcript;
  const aiAnalysisAllowed = bits.record && bits.transcript && bits.ai_analysis;
  return {
    recordingAllowed,
    transcriptPersistAllowed,
    aiAnalysisAllowed,
    attributionAllowed: bits.attribution,
  };
}
