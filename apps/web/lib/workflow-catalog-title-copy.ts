/**
 * 工作流目录里英文 title 的中文显示名（补充 `workflow-display-copy.ts` 未覆盖的研究/知识类
 * 内置工作流）。目录 title 是英文技术名（`Research-to-Brief`），不直接上屏。
 * 键集合由 `tests/lib/display-copy-single-source.test.ts` 与 API `definitions/W*.ts` 的 title 逐条核对。
 * 查不到时原样返回，由调用方继续走 `workflowDisplayName` 的兜底。
 */
import { findBuiltinWorkflow } from "@/lib/workflow-display-copy";

export const CATALOG_TITLE_ZH: Readonly<Record<string, string>> = {
  "research-to-brief": "研究到简报",
  "knowledge capture loop": "知识捕获闭环",
  "evidence-to-recommendation": "证据到决策建议",
  "question-to-analysis": "问题到数据分析",
  "research-to-evidence": "研究到证据包",
};

/** 没有任何中文显示名时的占位名（显示用；不可拿去拼进预填句子）。 */
export const UNNAMED_WORKFLOW_LABEL = "未命名流程";

export function catalogWorkflowTitleZh(title: string): string {
  const bare = title.trim().replace(/^W\d{3}\s+/, "");
  return CATALOG_TITLE_ZH[bare.toLowerCase()] ?? bare;
}

/**
 * UIUX r4：目录卡片 / 详情页「可发起」列表的**唯一**显示名解析——内置中文名 → 目录英文 title 的
 * 中文 → 「English（中文）」形状里括号内的中文 → 去掉括号的原名。卡片之间不再有的走中文、有的漏英文。
 */
export function agentWorkflowLabel(w: { readonly stableId: string; readonly name: string }): string {
  const head = (w.name.split(/[（(]/)[0] ?? "").trim();
  const builtin = findBuiltinWorkflow(w.stableId) ?? findBuiltinWorkflow(head.replace(/\s+/g, "-"));
  if (builtin) return builtin.name;
  const zh = catalogWorkflowTitleZh(head);
  if (zh !== head.replace(/^W\d{3}\s+/, "")) return zh;
  const paren = /[（(]([^）)]*)[）)]/.exec(w.name)?.[1]?.trim();
  if (paren && /\p{Script=Han}/u.test(paren)) return paren;
  return zh || UNNAMED_WORKFLOW_LABEL;
}
