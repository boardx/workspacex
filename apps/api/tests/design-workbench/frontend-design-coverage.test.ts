import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESIGN_OUTLINE_SYSTEM_PROMPT, DESIGN_PRINCIPLES, DESIGN_QUALITY_BAR,
} from "../../src/application/design-workbench/design-chat-model";
import {
  FRONTEND_DESIGN_COVERAGE, FRONTEND_DESIGN_SKILL_SHA256,
} from "../../src/application/design-workbench/frontend-design-coverage";
import { scorePrototypeScreen } from "../../src/application/design-workbench/prototype-quality";

/**
 * #4327 —— `frontend-design` skill 的翻译覆盖矩阵是一道门，不是一份文档：
 * 上游一变就红；每个去处都必须真的存在；视觉原则的每一条都要能追溯回上游。
 */
const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const PROMPTS = { principles: DESIGN_PRINCIPLES, outline: DESIGN_OUTLINE_SYSTEM_PROMPT, qualityBar: DESIGN_QUALITY_BAR } as const;
const CLAUSES = ["⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱"];
/** 条目 ⑧ 的文字 = 从 ⑧ 到下一个圈号之间。 */
function clauseText(marker: string): string {
  const start = DESIGN_PRINCIPLES.indexOf(marker);
  const rest = DESIGN_PRINCIPLES.slice(start + 1);
  const next = Math.min(...CLAUSES.map((m) => rest.indexOf(m)).filter((i) => i >= 0), rest.length);
  return DESIGN_PRINCIPLES.slice(start, start + 1 + next);
}

describe("frontend-design 翻译覆盖矩阵", () => {
  it("⭐ 钉住上游：SKILL.md 一变（重新导入 skill）就红——逐条重核矩阵后再更新 hash", () => {
    const skill = readFileSync(join(REPO, ".agents", "skills", "frontend-design", "SKILL.md"));
    expect(createHash("sha256").update(skill).digest("hex"), "frontend-design/SKILL.md 变了：逐条重核 frontend-design-coverage.ts 再更新 FRONTEND_DESIGN_SKILL_SHA256").toBe(FRONTEND_DESIGN_SKILL_SHA256);
  });

  it("每条上游判据都有去处，且去处真的存在（提示词原话 / 质量指标 / 渲染器文件 / 写明表达不了的原因）", () => {
    // 非空转：矩阵真有内容。
    expect(FRONTEND_DESIGN_COVERAGE.length).toBeGreaterThanOrEqual(20);
    const metrics = new Set(scorePrototypeScreen({ type: "stack", children: [{ type: "text", props: { content: "x" } }] } as never).parts.map((p) => p.metric));
    const broken: string[] = [];
    for (const e of FRONTEND_DESIGN_COVERAGE) {
      if (e.targets.length === 0) broken.push(`${e.id}: 没有任何去处`);
      for (const t of e.targets) {
        if (t.kind === "prompt") {
          const where = t.clause === undefined ? PROMPTS[t.prompt] : clauseText(t.clause);
          if (!where.includes(t.anchor)) broken.push(`${e.id}: 「${t.anchor}」不在 ${t.prompt}${t.clause ?? ""} 里`);
        }
        if (t.kind === "metric" && !metrics.has(t.metric)) broken.push(`${e.id}: 质量门没有指标 ${t.metric}`);
        if (t.kind === "renderer" && !existsSync(join(REPO, t.file))) broken.push(`${e.id}: 文件不存在 ${t.file}`);
        if (t.kind === "inexpressible" && t.reason.trim().length < 10) broken.push(`${e.id}: 「表达不了」要写明原因`);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });

  it("反向追溯：视觉 / 套路 / 文案原则（⑧–⑱）每一条都至少对应一条上游判据——⑬ 除外（它来自渲染器事实，不是 skill）", () => {
    const referenced = new Set(FRONTEND_DESIGN_COVERAGE.flatMap((e) => e.targets.flatMap((t) => (t.kind === "prompt" && t.clause !== undefined ? [t.clause] : []))));
    const orphans = CLAUSES.filter((c) => c !== "⑬" && !referenced.has(c));
    expect(orphans, `这些原则追溯不到上游判据：${orphans.join(" ")}`).toEqual([]);
  });

  it("id 不重复", () => {
    const ids = FRONTEND_DESIGN_COVERAGE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
