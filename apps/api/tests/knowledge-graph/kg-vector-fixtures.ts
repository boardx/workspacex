/**
 * S9（#4366）向量通道测试的确定性回环嵌入器：不调任何真实模型。
 *
 * 形状 = 一个小「概念表」（同义词组各占一维，模拟真实嵌入模型把换了说法的同一件事放在一起）+ 字符 unigram 的
 * 哈希维（弱信号）。同一段文本永远得到同一个向量；两段文本共享的概念越多越近。它只为测试造得出
 * 「字面抓不到、语义抓得到」的一对话，**不**代表任何真实模型的相似度分布。
 */
import type { EmbeddingPort } from "../../src/application/retrieval/ports";

const CONCEPTS: readonly (readonly string[])[] = [
  ["上线", "发布", "发版", "推出"],
  ["v2", "新版本", "第二版"],
  ["安卓", "android", "移动端"],
  ["预算", "经费", "花多少钱"],
  ["决定", "拍板", "定的", "定了"],
  ["测试环境", "预发环境"],
];
const HASHED = 48;
export const LOOPBACK_DIMS = CONCEPTS.length + HASHED;

export function loopbackEmbed(text: string): number[] {
  const t = text.toLowerCase();
  const v = new Array<number>(LOOPBACK_DIMS).fill(0);
  CONCEPTS.forEach((words, i) => { if (words.some((w) => t.includes(w))) v[i] = 3; });
  for (const ch of t.replace(/\s+/g, "")) {
    let h = 0;
    for (const u of Buffer.from(ch, "utf8")) h = (h * 31 + u) >>> 0;
    const k = CONCEPTS.length + (h % HASHED);
    v[k] = (v[k] ?? 0) + 0.25;
  }
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

/** 回环嵌入端口；`fail` 打开时模拟嵌入服务不可用（与 LangChainEmbeddingClient 同一个错误码）。 */
export class LoopbackEmbedding implements EmbeddingPort {
  fail = false;
  calls = 0;
  constructor(readonly model = "kg-s9-loopback", readonly modelVersion = "v1", private readonly delayMs = 0) {}
  async embed(text: string): Promise<readonly number[]> {
    this.calls += 1;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw new Error("embedding_unavailable");
    return loopbackEmbed(text);
  }
}
