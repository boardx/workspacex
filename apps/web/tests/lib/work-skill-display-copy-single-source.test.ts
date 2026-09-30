/**
 * 同一事实不得声明在两处 —— 技能中文名表是派生副本，机械核对它与
 * requirements/work-stack-v2/skills/S*.md 标题括号内名字逐条相等。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORK_SKILL_NAMES } from "@/lib/work-skill-display-copy";

const ROOT = join(__dirname, "../../../..");

describe("技能显示名表 = 单一事实源", () => {
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
});
