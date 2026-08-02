/**
 * 转写自动回流到本组 —— 洋葱最内层（F99，uc-6-7 R3 步骤 8 / O-05）。
 *
 * ## 这个文件唯一要证明的事
 *
 * 回流是否「只能以原文引述出现、不参与本组推演模板自动填充」（AC8/V8）由
 * **同意位**单向决定,不是由回流管线自己再判断一次「这条内容看起来能不能用」。
 * `quotesOnlyFor` 是这条规则唯一的实现,复用 `subject.ts` 的 `ConsentBits`
 * 类型(不重新声明同意位结构),与 `deriveConsentStatus` 同一处置手法——
 * 纯函数、单一事实源、两处调用方不可能算出两个答案。
 *
 * ⚠ 尚无任何提交(`bits === null`)时同样按 `quotesOnly = true` 处理:
 * 「尚未同意」与「明确拒绝」在「能不能参与自动填充」这件事上是同一个答案——
 * 只有明确 `ai_analysis = true` 才放行自动填充,这是**默认拒绝**而不是默认放行,
 * 对齐 O-05「回流受同意位约束」的保守读法。
 */
import type { ConsentBits } from "./subject";

/**
 * 该对象的回流内容是否只能以原文引述出现(`true`)，还是可以参与本组推演模板的
 * 自动填充(`false`)。
 */
export function quotesOnlyFor(bits: ConsentBits | null): boolean {
  if (bits === null) return true;
  return !bits.ai_analysis;
}
