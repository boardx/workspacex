/**
 * 实例源码 → 分区/便签投影（#1493 / UC-7.3 第二块，renderCanvas 与 exportSource 共用）。
 *
 * ## 解析语义的权威是 `@repo/fabric-markdown` 的 `parseTemplateText`，本文件不发明第二套
 *
 * 模板文本语法（`## 段落` 标题、`- 便签` 列表项、空行分隔的段落块合并为一条）在
 * `packages/fabric-markdown/src/diagrams/template-engine.ts` 里定义并被 164+ 单测钉住。
 * 本文件仍然自己走了一遍行扫描，唯一原因是 `parseTemplateText` **不返回行号**，而
 * `exportSource` 的「围栏原位替换、保序」需要每条便签的精确行区间才能做到只动该动的行。
 * 为了保证两套扫描不漂移，`tests/canvas/source-projection-matches-engine.test.ts`
 * 把本投影的产出与 `parseTemplateText` 对同一文档的产出做逐条相等断言——权威仍是那一份，
 * 本文件只是它的「带行号视图」，断言失效时先改这里、不改 vendor 源码（VENDOR.md）。
 *
 * ## mermaid/canvas 围栏行不参与便签解析
 *
 * 实例源码是完整 markdown 文档（`# 标题` + `## 段落` + 便签 + 可能的 ```mermaid 围栏），
 * 而引擎的 `parseTemplateText` 面向的是 ```canvas 围栏**内部**的模板文本。围栏内容行喂给
 * 便签解析会把图源码行当成段落便签——所以先用 `extractMermaidBlocks`（同
 * `mermaid-whitelist.ts` 复用的那一个围栏语法）把围栏区间挖出来跳过，围栏边界等同空行
 * （flush 段落缓冲），围栏原文一个字节都不动。
 *
 * ## `stickyId` 是按文档序派生的，不落库
 *
 * markdown 里没有持久化的便签 id（D-08：文本是唯一事实源，坐标/id 都不写回文本）。
 * `st-<n>` 按文档出现顺序派生：同一版本的 markdown 两次投影必然同 id，`renderCanvas`
 * 发出去的 id 与 `exportSource` 用来对账 `stickyPositions` 的 id 因此一致；跨版本
 * （head 推进后）id 可能重排——调用方每次渲染后都拿到全量新 id，契约没有跨版本 id 稳定性的承诺。
 */
import { extractMermaidBlocks } from "@repo/fabric-markdown/markdown";
import { STICKY_COLORS } from "@repo/fabric-markdown/diagrams/template-engine";

/** 名字→hex 的唯一权威是引擎的 `STICKY_COLORS`；这里只做一次反查，不复制色值。 */
const HEX_BY_NAME = STICKY_COLORS;

export interface ProjectedSticky {
  /** `st-<文档序号>`，1 起（见文件头「不落库」）。 */
  readonly stickyId: string;
  /** 原始条目文本（含可能的尾部 ` #颜色名` 标记），exportSource 原样搬运它。 */
  readonly rawText: string;
  /** 去掉颜色标记后的展示文本（引擎 `extractStickyColor` 的同一条正则）。 */
  readonly text: string;
  /** 颜色 hex（`STICKY_COLORS` 的值）；无标记 = 缺省黄 = `null`（引擎同款：缺省不写标记）。 */
  readonly color: string | null;
  /** 1-based 闭区间：该条目占据的源码行（段落块可跨多行；列表项恒为单行）。 */
  readonly lines: { readonly from: number; readonly to: number };
}

export interface ProjectedSection {
  /** `## ` 后的标题原文（trim 后），与模板分区定义按 name 对账。 */
  readonly name: string;
  /** `## ` 标题所在行（1-based）。 */
  readonly headingLine: number;
  readonly stickies: readonly ProjectedSticky[];
}

export interface SourceProjection {
  readonly sections: readonly ProjectedSection[];
  /** 全文档行数组（`\n` 切分，不含换行符），exportSource 的重写基底。 */
  readonly lines: readonly string[];
}

/**
 * markdown 手写的、冻结模板里没有的 `## 段落` 的派生 sectionId。
 * render 与 export 共用这一个产地（同一事实不声明两处）。
 */
export function derivedSectionId(name: string): string {
  return `md:${name}`;
}

/** 引擎 `extractStickyColor` 的同一条判定：尾部 ` #<已注册颜色名>` 才是颜色标记。 */
export function splitStickyColor(rawText: string): { text: string; color: string | null } {
  const m = /^(.*?)\s+#(\w+)$/.exec(rawText);
  if (m && HEX_BY_NAME[m[2]!]) {
    return { text: m[1]!.trim(), color: HEX_BY_NAME[m[2]!]! };
  }
  return { text: rawText, color: null };
}

/** 文档里第 `offset` 个字符落在第几行（1-based）。 */
function lineOfOffset(markdown: string, offset: number): number {
  return markdown.slice(0, offset).split("\n").length;
}

export function projectSource(markdown: string): SourceProjection {
  const lines = markdown.split("\n");

  // 围栏行集合（1-based）。extractMermaidBlocks 的 end 是「闭围栏行末尾之后」的偏移，
  // 恰好还在闭围栏那一行上 ⇒ 两端都取 lineOfOffset 即覆盖整段围栏。
  const fenced = new Set<number>();
  for (const block of extractMermaidBlocks(markdown)) {
    const from = lineOfOffset(markdown, block.start);
    const to = lineOfOffset(markdown, Math.max(block.start, block.end - 1));
    for (let n = from; n <= to; n++) fenced.add(n);
  }

  interface MutableSection {
    name: string;
    headingLine: number;
    stickies: ProjectedSticky[];
  }
  const sections: MutableSection[] = [];
  let current: MutableSection | null = null;
  let stickySeq = 0;

  // 段落缓冲（引擎语义：连续非列表行合并为一条便签，空行/标题/列表项 flush）。
  let paragraph: string[] = [];
  let paragraphFrom = 0;
  let paragraphTo = 0;

  const pushItem = (rawText: string, from: number, to: number): void => {
    if (current === null) return;
    stickySeq += 1;
    const { text, color } = splitStickyColor(rawText);
    current.stickies.push({ stickyId: `st-${stickySeq}`, rawText, text, color, lines: { from, to } });
  };
  const flush = (): void => {
    if (current !== null && paragraph.length > 0) {
      pushItem(paragraph.join(" "), paragraphFrom, paragraphTo);
    }
    paragraph = [];
  };

  for (let n = 1; n <= lines.length; n++) {
    if (fenced.has(n)) {
      flush(); // 围栏边界等同空行（见文件头）
      continue;
    }
    const line = lines[n - 1]!.trim();
    const heading = /^##\s*(.+)$/.exec(line);
    if (heading) {
      flush();
      current = { name: heading[1]!.trim(), headingLine: n, stickies: [] };
      sections.push(current);
      continue;
    }
    if (line === "") {
      flush();
      continue;
    }
    if (current === null) continue; // 第一个 `##` 之前：标题/字段区，非便签
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      pushItem(bullet[1]!.trim(), n, n);
    } else {
      if (paragraph.length === 0) paragraphFrom = n;
      paragraph.push(line);
      paragraphTo = n;
    }
  }
  flush();

  return { sections, lines };
}
