/**
 * placeholder-gate.ts —— PROP-HARNESS-MODEL-001 Epic E2（HMV2-014）：未解析占位符门控。
 *
 * 背景：Proposal §13 成功指标"未解析占位符 = 0"。生成物（renderer 产出、scaffold
 * 产出）里残留占位符，意味着替换环节静默失败——这类内容一旦落盘，读者会把
 * "{{PHASE_GOAL}}"当成正文的一部分照抄下去。
 *
 * 检测规则**取自本仓模板的真实占位符语法**（实测 `.harness/templates/`，不是
 * 凭空定的正则）：
 *   1. `{{ANY}}`——机器替换类（new-phase/new-sprint/new-adr scaffold 用
 *      `{{PHASE_ID}}` 这类 UPPER_SNAKE；也见过 `{{…}}`）。生成物里出现任何
 *      `{{...}}` 都是替换失败，无条件报。
 *   2. `<含 CJK 的内容>` 或 `<…>`——人工填写类（模板里的 `<谁在用这个功能…>`
 *      `<步骤1>` 这类中文提示）。用"内容含 CJK 字符"作判据，天然区分开
 *      HTML 标签（`<div>`）、TS 泛型（`<Input, Output>`）、邮箱尖括号等
 *      合法尖括号用法——这些的内容都是 ASCII。
 *
 * 如实标注不覆盖的部分（不是遗漏）：
 *   - 纯 ASCII 的尖括号占位符（如模板里的 `<phase>`/`<tracking_issue>`）**不报**——
 *     它们与 HTML/泛型/命令行重定向在字面上不可区分，报了会淹没在假阳性里。
 *     模板作者要机器可查的占位符，用 `{{...}}`；这条取舍写进 gate 是为了让
 *     后来者知道"为什么我的 <foo> 没被查出来"。
 *   - 行内含 `placeholder-gate:ignore` 标记的行整行跳过——供文档里**刻意**
 *     展示占位符语法的场景（如本文件的注释、教学文档），同 skill-doctor:ignore
 *     的行内标注先例：标注紧贴被标注内容，不另立一份忽略清单文件。
 *
 * 风格同 renderer-model.ts/template-model.ts：纯函数、无 IO、累积上报不早退。
 * 消费方：HMV2-016（drift gate 落盘前）、HMV2-017（`templates render` CLI）。
 */
import type { RenderedFile } from "./renderer-model";

export interface PlaceholderFinding {
  /** 1-indexed 行号。 */
  line: number;
  /** 命中的占位符原文（含定界符）。 */
  placeholder: string;
  /** 哪条规则命中：machine = `{{...}}`；human = `<CJK>` / `<…>`。 */
  kind: "machine" | "human";
}

const IGNORE_MARKER = "placeholder-gate:ignore";
const MACHINE_RE = /\{\{[^{}\n]*\}\}/g;
/** 尖括号内至少一个 CJK 字符（含中文标点省略号），或整个内容就是省略号。 */
const HUMAN_RE = /<(?:[^<>\n]*[一-鿿㐀-䶿][^<>\n]*|…)>/g;

export function findUnresolvedPlaceholders(content: string): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  const lines = content.split("\n");
  lines.forEach((lineText, i) => {
    if (lineText.includes(IGNORE_MARKER)) return;
    for (const m of lineText.matchAll(MACHINE_RE)) {
      findings.push({ line: i + 1, placeholder: m[0], kind: "machine" });
    }
    for (const m of lineText.matchAll(HUMAN_RE)) {
      findings.push({ line: i + 1, placeholder: m[0], kind: "human" });
    }
  });
  return findings;
}

export interface FilePlaceholderIssue {
  path: string;
  finding: PlaceholderFinding;
}

/**
 * 对一批 renderer 产出做门控。issues 非空 = 存在未解析占位符，调用方不得落盘
 * （同 renderChecked 的"产出不可信就作废"约定）。
 */
export function checkRenderedFiles(files: RenderedFile[]): FilePlaceholderIssue[] {
  const issues: FilePlaceholderIssue[] = [];
  for (const f of files) {
    for (const finding of findUnresolvedPlaceholders(f.content)) {
      issues.push({ path: f.path, finding });
    }
  }
  return issues;
}
