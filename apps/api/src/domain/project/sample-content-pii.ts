/**
 * backlog E2 —— 内置示例材料的 PII 形状扫描（纯函数）。
 *
 * 用途：`tests/project/sample-project-pii-gate.test.ts` 用它扫 `SAMPLE_DOCUMENTS`
 * 全文，命中任何一类即红。它是**形状**门，不是语义识别：宁可误报（把内容改掉即可），
 * 不能漏报——示例内容会原样进每一个新组织。
 */
export type PiiKind = "cn-mobile" | "cn-landline" | "email" | "cn-id-card" | "bank-card";

export interface PiiFinding {
  readonly kind: PiiKind;
  readonly match: string;
}

// 数字边界用 (?<!\d) / (?!\d)，而不是 \b：中文与数字之间 \b 的语义在 JS 里不可靠。
const PATTERNS: readonly (readonly [PiiKind, RegExp])[] = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["cn-id-card", /(?<!\d)\d{17}[\dXx](?!\d)/g],
  ["bank-card", /(?<!\d)\d{16,19}(?!\d)/g],
  // 手机号：允许中间有空格或短横（138 1234 5678 / 138-1234-5678）。
  ["cn-mobile", /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g],
  ["cn-landline", /(?<!\d)0\d{2,3}[\s-]?\d{7,8}(?!\d)/g],
];

export function scanForPii(text: string): readonly PiiFinding[] {
  const findings: PiiFinding[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) findings.push({ kind, match: m[0] });
  }
  return findings;
}
