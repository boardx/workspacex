/**
 * F979(design-delta skill-office-docs-node-runtime)—— `verification.md` **V6**:
 * 三份新 skill 的 SKILL.md 正文里,不能出现指向 `anthropics/skills` 或任何已知
 * fork(`appautomaton/document-SKILLs`、`tfriedel/claude-office-skills`)的 URL 或
 * 逐字引用。contract.md §0 的授权结论是"不碰 Anthropic 官方或社区 fork 的任何
 * 代码/提示词原文,原创重写"——这条测试把这句话钉成一个机械门控,而不是只停留在
 * 文档里的一句承诺。
 *
 * ⚠ SKILL.md 正文与 `apps/skill-sandbox` 的 promptTemplate 走向一致:这三份内容
 * 会被直接拼进 system prompt(`message-roundtrip.ts` 头注:"同一份 SKILL.md 正文
 * 在 system prompt 里出现"),所以这里断言的字符串就是用户/模型实际会看到的原文,
 * 不是某个中间表示。
 */
import { describe, expect, it } from "vitest";
import {
  DOCX_CREATE_SKILL_MD,
  PDF_CREATE_SKILL_MD,
  XLSX_CREATE_SKILL_MD,
} from "../../scripts/office-docs-skill-content";

const FORBIDDEN_PATTERNS = [
  /anthropics\/skills/i,
  /anthropic[-_]?skills/i,
  /appautomaton\/document-skills/i,
  /tfriedel\/claude-office-skills/i,
  /claude[-_]?office[-_]?skills/i,
  // 常见的"移植/改编自"措辞,即使没带 URL,也说明内容不是原创。
  /改编自|移植自|adapted from|ported from/i,
];

const SKILLS = {
  "docx-create": DOCX_CREATE_SKILL_MD,
  "xlsx-create": XLSX_CREATE_SKILL_MD,
  "pdf-create": PDF_CREATE_SKILL_MD,
} as const;

describe("V6 三份 SKILL.md 不含 anthropics/skills 或任何 fork 的痕迹", () => {
  for (const [name, content] of Object.entries(SKILLS)) {
    it(`${name}: 不含被禁止的字符串/URL`, () => {
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(content, `${name} 的 SKILL.md 命中了禁止模式 ${pattern}`).not.toMatch(pattern);
      }
    });

    it(`${name}: 不含任何指向 github.com 的 URL(原创内容不需要引它)`, () => {
      expect(content).not.toMatch(/github\.com/i);
    });

    it(`${name}: 明确说明库已预装、不要在脚本里 npm install(与 contract §3 末尾一致)`, () => {
      expect(content).toMatch(/预装|preinstalled/i);
      expect(content).toMatch(/不要.*npm install|not.*npm install|don't.*npm install/i);
    });
  }

  it("V1-CP 反证:混进一条 anthropics/skills 引用,这条测试本身必须能检测出来", () => {
    const poisoned = `${DOCX_CREATE_SKILL_MD}\n参考 https://github.com/anthropics/skills/tree/main/docx`;
    expect(poisoned).toMatch(/anthropics\/skills/i);
  });
});
