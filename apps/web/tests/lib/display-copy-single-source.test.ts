/**
 * 同一事实不得声明在两处 —— web 侧显示名表是派生副本，这里机械核对它与单一事实源逐条相等：
 *   · 技能中文名 ⇐ requirements/work-stack-v2/skills/S*.md 标题括号内名字
 *   · 目录工作流中文名的键 ⇐ apps/api/src/domain/work-content/definitions/W*.ts 的 title
 * 源变了而表没跟上（或反过来）⇒ 这条测试红。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORK_SKILL_NAMES } from "@/lib/work-skill-display-copy";
import { CATALOG_TITLE_ZH } from "@/lib/workflow-catalog-title-copy";

const ROOT = join(__dirname, "../../../..");

describe("显示名表 = 单一事实源", () => {
  it("技能中文名与 S*.md 标题逐条相等", () => {
    const dir = join(ROOT, "requirements/work-stack-v2/skills");
    const parsed: Record<string, string> = {};
    for (const f of readdirSync(dir).filter((n) => /^S\d{3}.*\.md$/.test(n))) {
      const head = readFileSync(join(dir, f), "utf8").split("\n")[0]!;
      const m = /^# (S\d{3}) — .*?（([^）]+)）/.exec(head);
      expect(m, `${f} 标题缺中文名`).not.toBeNull();
      parsed[m![1]!] = m![2]!.split("：")[0]!.trim();
    }
    expect({ ...WORK_SKILL_NAMES }).toEqual(parsed);
  });

  it("目录工作流中文名的键与 API 定义 title 一一对应", () => {
    const dir = join(ROOT, "apps/api/src/domain/work-content/definitions");
    const titles = readdirSync(dir)
      .filter((n) => /^W\d{3}\.ts$/.test(n))
      .map((f) => /^\s*title:\s*"([^"]+)"/m.exec(readFileSync(join(dir, f), "utf8"))![1]!.toLowerCase())
      .sort();
    expect(Object.keys(CATALOG_TITLE_ZH).sort()).toEqual(titles);
  });
});
