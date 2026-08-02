/**
 * F106 — 留白两规则（O-32 / D-11）：`validateWhitespaceRules`（**纯函数**）。
 *
 * uc-7-2 R3/R7 的两条结构化规则取代了作废的「六成」判据（D-11）：
 *   ① 每个分区必须至少留一格空 —— 该分区的便签数 < `capacity`（`capacity == null` 时
 *      规则①**目前断言不出来**，这是 domain.md 明确记录的已知缺口 [待定 D-a]，不在此
 *      冒充有判据——跳过而不是编一个）。
 *   ② 每条 AI 起草的便签必须附原始引述三件套（segmentId + 时间码 + 原文），缺任一项
 *      即「无来源 · 待补」，标 `missing-citation`（I-23）。
 *
 * ⚠ **只提示不阻断**（I-25）：本函数没有 err 通道（契约 `validateWhitespaceRules.err`
 *   是空数组，这是刻意的，见契约注释）——规则被突破时仍然只返回 `warnings`，调用方
 *   （写入路径）永远成功返回，`warnings` 非空不是失败。
 *
 * ## markdown 里怎么认「一条便签」「一条引述」——过渡记法，非最终裁决
 *
 * F103（三段互转的真实 markdown⇄mermaid⇄fabric 模型）此刻仍 `in_progress`，尚未定义
 * 「一张便签在 markdown 里长什么样」的官方语法。`validateWhitespaceRules` 的契约签名
 * 却是 `{ markdown: string, sections: SectionDef[] }`——不是结构化的便签数组，所以本函数
 * 必须真的解析文本，不能假装契约是别的形状。
 *
 * 这里选用的记法是**过渡性的**，只服务于「留白两规则」这一个判定面，不冒充 F103 的
 * 权威序列化格式（那份格式最终敲定后，本文件的解析器应该改用它，而不是相反）：
 *
 *   ```
 *   ## <分区 name，与 SectionDef.name 逐字匹配>
 *   - [AVA] <便签文本> <!-- cite: <segmentId>@<timecode> "<原文>" -->
 *   - <人工便签，不受规则②约束>
 *   ```
 *
 *   - 一行以 `- ` 开头即一条便签；`[AVA]` 前缀标记这是 AI 落笔（规则②只管这些行——
 *     人工便签不需要自证引述）。
 *   - `<!-- cite: ... -->` 是引述三件套的载体；三个捕获组任一为空即视为「三件套不完整」，
 *     与「整条不带 cite 注释」同归 `missing-citation`——I-23 明确写「缺任一项」，
 *     不是「全缺才算」。
 */
import { canvas as C } from "@repo/contracts";
import type { z } from "zod";

export type SectionDef = z.infer<typeof C.SectionDef>;
export type WhitespaceWarning = z.infer<typeof C.WhitespaceWarning>;

interface ParsedSticky {
  readonly stickyId: string;
  readonly isAva: boolean;
  /** `null` ⟺ 引述三件套不完整（无 cite 注释，或注释里三个字段任一为空）*/
  readonly citeComplete: boolean;
}

const HEADING_RE = /^##\s+(.+?)\s*$/;
const AVA_PREFIX_RE = /^-\s*\[AVA\]/;
const BULLET_RE = /^-\s*/;
// 三个捕获组故意允许匹配空串——「三件套任一为空」与「整段没写」是同一件事（I-23）。
const CITE_RE = /<!--\s*cite:\s*([^@\s]*)@([^\s]*)\s+"([^"]*)"\s*-->/;

/** 按 `## <name>` 标题切分 markdown，键是标题文本，值是该分区标题下的原始行 */
function splitSectionsByHeading(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const h = HEADING_RE.exec(line);
    if (h) {
      current = h[1]!;
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    if (current !== null) out.get(current)!.push(line);
  }
  return out;
}

function parseStickyLines(sectionId: string, lines: string[]): ParsedSticky[] {
  const stickies: ParsedSticky[] = [];
  let index = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!BULLET_RE.test(trimmed)) continue;
    const isAva = AVA_PREFIX_RE.test(trimmed);
    const cite = CITE_RE.exec(trimmed);
    const citeComplete = cite !== null && cite[1]!.length > 0 && cite[2]!.length > 0 && cite[3]!.length > 0;
    stickies.push({ stickyId: `${sectionId}#${index}`, isAva, citeComplete });
    index += 1;
  }
  return stickies;
}

/**
 * 留白两规则的纯函数校验器。**不改 markdown、不写任何东西**——只读取，返回提示。
 * 输出形状与契约 `validateWhitespaceRules.out` 逐字段一致（`{ warnings: WhitespaceWarning[] }`）。
 */
export function validateWhitespaceRules(markdown: string, sections: SectionDef[]): { warnings: WhitespaceWarning[] } {
  const bySectionName = splitSectionsByHeading(markdown);
  const warnings: WhitespaceWarning[] = [];

  for (const section of sections) {
    const lines = bySectionName.get(section.name) ?? [];
    const stickies = parseStickyLines(section.sectionId, lines);

    // 规则①：每个分区至少留一格空。capacity == null 时目前断言不出来（domain.md [待定 D-a]）——
    // 跳过，不编一个判据冒充能判定。
    if (section.capacity !== null && stickies.length >= section.capacity) {
      warnings.push({
        rule: "section-full",
        sectionId: section.sectionId,
        stickyId: null,
        message: `分区「${section.name}」已被填满（${stickies.length}/${section.capacity}），未留给现场的空格`,
      });
    }

    // 规则②：AI 起草的便签必须附引述三件套，缺任一项即「无来源 · 待补」。
    for (const sticky of stickies) {
      if (sticky.isAva && !sticky.citeComplete) {
        warnings.push({
          rule: "missing-citation",
          sectionId: section.sectionId,
          stickyId: sticky.stickyId,
          message: `分区「${section.name}」的便签 ${sticky.stickyId} 缺原始引述三件套（segmentId/时间码/原文任一为空），标「无来源 · 待补」，不计入完成度分子`,
        });
      }
    }
  }

  return { warnings };
}
