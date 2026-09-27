import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.claude/skills/` 是 Claude Code 原生自动发现 skill 的位置；`.agents/skills/` 是真身。
 *
 * 在这之前 `.claude/skills/` 根本不存在（CLAUDE.md 的注释却写着「软链指向真身」），于是
 * `frontend-design` 只有被 ui-prototyper 按路径点名时才会被读到——主会话/worker 改 UI 时
 * skill 列表里没有它，也就不会自动触发。
 *
 * 这里钉两件事：
 *   ① 链进来的每一项都是**软链**且解析到 `.agents/skills/` 下同名目录——不许是一份拷贝
 *      （拷贝就是同一份 skill 的第二份声明，本仓头号漂移形态）；
 *   ② `frontend-design` 必须在（这次要解决的就是它）。
 */
const ROOT = resolve(import.meta.dirname, "..", "..");
const LINKS = join(ROOT, ".claude", "skills");
const SOURCE = join(ROOT, ".agents", "skills");

describe(".claude/skills 只放指向 .agents/skills 真身的软链", () => {
  const entries = readdirSync(LINKS);

  it("frontend-design 链进来了，且能读到真身的 SKILL.md", () => {
    expect(entries).toContain("frontend-design");
    const skill = readFileSync(join(LINKS, "frontend-design", "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: frontend-design\n/);
  });

  it("每一项都是软链、相对路径、落在 .agents/skills 下的同名目录（不是拷贝）", () => {
    // 非空转：至少判了一项。
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      const p = join(LINKS, name);
      // ⭐ 反证：把软链换成 `cp -R` 出来的目录 ⇒ 这条红。
      expect(lstatSync(p).isSymbolicLink(), `${name} 不是软链（是拷贝？）`).toBe(true);
      // 相对路径：绝对路径在别人的 clone / worktree 里指向不存在的地方。
      expect(readlinkSync(p).startsWith("/"), `${name} 用了绝对路径`).toBe(false);
      expect(realpathSync(p)).toBe(realpathSync(join(SOURCE, name)));
    }
  });
});
