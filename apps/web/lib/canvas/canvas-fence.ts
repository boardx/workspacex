/**
 * ```canvas / ```persona 围栏 = **工作坊画布模板（便签协作模板）** 的专用校验器。
 *
 * ⚠ 这与 mermaid 图表是**两套独立系统**：mermaid（flowchart/类图/mindmap/gantt…）是
 *   标准图表类型，判据是 `MermaidDiagramType` 白名单 + `mermaid.parse`，住在
 *   `lib/mermaid-diagram-type.ts` + `components/chat/chat-diagram-fabric.tsx`；
 *   工作坊画布模板是分区框 + 可贴便签 + 多人协作，判据是下面这两条。
 *   **两个校验器各管各的，本文件不 import 任何 mermaid 相关模块，也不出现
 *   「既判 mermaid 类型又判模板 key」的合并分支。**
 *
 * ⚠ 绝不能拿 `mermaid.parse` 校验工作坊画布围栏 —— 它们根本不是 mermaid 语法。
 *   `chat-diagram-fabric.tsx` 的两道闸门对它们一律判失败，这也正是它们此前被
 *   `markdown-message` 主动丢弃、落回灰底代码块的原因。
 *
 * 合法性判据（生产端与本仓共享的围栏契约，逐字核实自 `parseTemplateText`）：
 *   ① 能解析出 `templateKey`（`模板: xxx` 行；```persona 围栏隐含 key = persona）
 *   ② 至少有一个 `## 分区` 标题
 * 模板 key 能不能解析到 spec 是**第二道闸**，在 `fence-template-resolver.ts` 里，
 * 因为它要发网络请求，而这一道是纯函数。
 */
import { parseTemplateText } from "@repo/fabric-markdown";

/** `extractMermaidBlocks` 会吐出的、由本条渲染路径接管的围栏语言。 */
export const CANVAS_FENCE_LANGS = ["canvas", "persona"] as const;
export type CanvasFenceLang = (typeof CANVAS_FENCE_LANGS)[number];

export function isCanvasFenceLang(lang: string): lang is CanvasFenceLang {
  return (CANVAS_FENCE_LANGS as readonly string[]).includes(lang);
}

export type CanvasFenceCheck =
  | { readonly ok: true; readonly key: string; readonly sectionCount: number }
  | { readonly ok: false; readonly detail: string };

export function checkCanvasFence(code: string, lang: CanvasFenceLang): CanvasFenceCheck {
  const parsed = parseTemplateText(code);
  // ```persona 是 `模板: persona` 的别名（见 template-engine 文件头），围栏语言即 key。
  const key = lang === "persona" ? "persona" : (parsed.templateKey ?? "").trim();
  if (!key) {
    return { ok: false, detail: "缺少「模板: <模板 key>」行——canvas 围栏必须首行声明用哪个模板。" };
  }
  if (parsed.sections.size === 0) {
    return { ok: false, detail: `模板「${key}」的围栏里没有任何「## 分区」标题，画布无处可放便签。` };
  }
  return { ok: true, key, sectionCount: parsed.sections.size };
}
