/**
 * 工作流目录里英文 title 的中文显示名（补充 `workflow-display-copy.ts` 未覆盖的研究/知识类
 * 内置工作流）。目录 title 是英文技术名（`Research-to-Brief`），不直接上屏。
 * 键集合由 `tests/lib/display-copy-single-source.test.ts` 与 API `definitions/W*.ts` 的 title 逐条核对。
 * 查不到时原样返回，由调用方继续走 `workflowDisplayName` 的兜底。
 */

export const CATALOG_TITLE_ZH: Readonly<Record<string, string>> = {
  "research-to-brief": "研究到简报",
  "knowledge capture loop": "知识捕获闭环",
  "evidence-to-recommendation": "证据到决策建议",
  "question-to-analysis": "问题到数据分析",
  "research-to-evidence": "研究到证据包",
};

export function catalogWorkflowTitleZh(title: string): string {
  const bare = title.trim().replace(/^W\d{3}\s+/, "");
  return CATALOG_TITLE_ZH[bare.toLowerCase()] ?? bare;
}
