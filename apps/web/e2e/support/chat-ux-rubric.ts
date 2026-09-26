/**
 * 「对标 Claude Code」十项评分的**机械测量**。
 *
 * ## 这个文件不是评分标准
 *
 * 判据文字的唯一权威是 `.harness/instructions/chat-ux-acceptance-criteria.md`
 * （它自己头注就写了：不要在别处重新定义一套）。这里只放**怎么量**：
 * 十个维度各自的探针、证据、以及「没量到」与「量到了是 0 分」的区别。
 *
 * 那份文档同时要求「评分人必须用真实浏览器实际操作一遍，不能只看代码 diff 就打分」。
 * 机械测量不替代那条纪律，它解决的是另一件事：**让同一个分可复现、可证伪**。
 * 人看一遍给 6 分、下一轮又给 7 分，没人说得清是产品变好了还是评分人换了心情。
 *
 * ## 三态，不是两态
 *
 * 每项探针返回 `measured` + `score`。**没量到 ≠ 0 分，更不是满分**：
 *   · `measured: true, score: 0`   —— 量了，确实不行。
 *   · `measured: false`            —— 这一轮没量（探针还没写 / 前置条件不具备）。
 *     计入总分时按 0 算，但在报告里单独标出来，不许混进「已验证的缺陷」里充数。
 * 这条是本仓反复栽的那个坑的反面：判据无法被证伪时，它给出的绿是假的；
 * 同理，判据没跑过时给出的分也不是分。
 */

export interface ProbeResult {
  /** 这一轮是否真的量到了。false ⇒ 计 0 分，但报告里与「量到 0 分」分开列。 */
  readonly measured: boolean;
  /** 0–1。`measured: false` 时忽略。 */
  readonly score: number;
  /** 一句话说清量到了什么——报告里逐条印出来，不是只留一个数。 */
  readonly evidence: string;
}

export interface Dimension {
  /** 与验收文档里的编号逐一对应（1–10）。 */
  readonly id: number;
  /** 短名，仅用于报告可读；判据全文见验收文档。 */
  readonly name: string;
}

/**
 * 十个维度。**只有编号与短名**——判据文字不复制到这里。
 * `chat-ux-rubric-drift.test.ts` 机械核对这张表与验收文档的编号集合一致。
 */
export const DIMENSIONS: readonly Dimension[] = [
  { id: 1, name: "流式反馈" },
  { id: 2, name: "可见的规划步骤" },
  { id: 3, name: "可见的工具调用与进度" },
  { id: 4, name: "真实的多步能力" },
  { id: 5, name: "语音输入体验" },
  { id: 6, name: "多轮上下文" },
  { id: 7, name: "错误处理透明度" },
  { id: 8, name: "消息呈现质量" },
  { id: 9, name: "控制感" },
  { id: 10, name: "整体连贯性" },
];

export type Scorecard = Readonly<Record<number, ProbeResult>>;

/** 未量到按 0 计入总分——不许把没跑过的探针算成满分。 */
export function totalScore(card: Scorecard): number {
  let sum = 0;
  for (const d of DIMENSIONS) {
    const r = card[d.id];
    if (r !== undefined && r.measured) sum += Math.max(0, Math.min(1, r.score));
  }
  // 验收文档：「总分 10 分，向下取整到 0.5」。
  return Math.floor(sum * 2) / 2;
}

export function renderScorecard(card: Scorecard): string {
  const lines = [`# chat 体验评分（对标 Claude Code）`, "", `**总分 ${String(totalScore(card))} / 10**`, ""];
  lines.push("| # | 维度 | 分 | 证据 |", "|---|---|---|---|");
  for (const d of DIMENSIONS) {
    const r = card[d.id];
    const score = r === undefined || !r.measured ? "未量" : r.score.toFixed(2);
    lines.push(`| ${String(d.id)} | ${d.name} | ${score} | ${r?.evidence ?? "本轮没有探针"} |`);
  }
  const unmeasured = DIMENSIONS.filter((d) => !(card[d.id]?.measured ?? false));
  if (unmeasured.length > 0) {
    lines.push("", `⚠ 未量到 ${String(unmeasured.length)} 项（按 0 计入总分，但不等于「已验证为 0 分」）：`
      + unmeasured.map((d) => `${String(d.id)} ${d.name}`).join("、"));
  }
  return lines.join("\n");
}
