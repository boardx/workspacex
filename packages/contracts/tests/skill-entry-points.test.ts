/**
 * backlog E6 门控：仓库 `skills/` 下每个平台 skill（SKILL.md frontmatter `name`，
 * 与 starter-pack JSON 的 `stableName` 是同一个 slug）必须恰好归入一个入口或隐藏表。
 * 新增 skill 不分配 → 红；表里写了仓库不存在的 slug → 红。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allAssignedSkillSlugs,
  entryPointOf,
  HIDDEN_PLATFORM_SKILLS,
  SKILL_ENTRY_POINTS,
} from "../src/skill-entry-points";

const SKILLS_ROOT = resolve(__dirname, "../../../skills");

function findSkillMd(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "upstream") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findSkillMd(full));
    else if (name === "SKILL.md") out.push(full);
  }
  return out;
}

function slugOf(file: string): string {
  const m = /^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(readFileSync(file, "utf8"));
  if (!m?.[1]) throw new Error(`SKILL.md 缺 frontmatter name：${file}`);
  return m[1].trim();
}

/** 每个 starter pack 最新版本 JSON 里的 stableName——catalog 实际落库用的 slug。 */
function starterPackSlugs(): string[] {
  const root = join(SKILLS_ROOT, "starter-packs");
  const slugs: string[] = [];
  for (const pack of readdirSync(root)) {
    const versions = readdirSync(join(root, pack))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const latest = versions.at(-1);
    if (latest === undefined) continue;
    const json = JSON.parse(readFileSync(join(root, pack, `${latest}.json`), "utf8")) as {
      skills: { stableName: string }[];
    };
    slugs.push(...json.skills.map((s) => s.stableName));
  }
  return slugs;
}

const repoSlugs = findSkillMd(SKILLS_ROOT).map(slugOf);

describe("skill entry points gate (backlog E6)", () => {
  it("有三个入口，每个都有 label / promise / 至少一个 skill", () => {
    expect(SKILL_ENTRY_POINTS).toHaveLength(3);
    for (const e of SKILL_ENTRY_POINTS) {
      expect(e.label).not.toBe("");
      expect(e.promise).not.toBe("");
      expect(e.skillSlugs.length).toBeGreaterThan(0);
    }
  });

  it("仓库里扫到了平台 skill（防止扫描路径失效后门控空转）", () => {
    expect(repoSlugs.length).toBeGreaterThanOrEqual(18);
  });

  it("每个 SKILL.md slug 恰好分配一次", () => {
    const assigned = allAssignedSkillSlugs();
    const unassigned = repoSlugs.filter((s) => entryPointOf(s) === null);
    expect(unassigned, "这些 skill 没归入任何入口或隐藏表").toEqual([]);
    const dupes = assigned.filter((s, i) => assigned.indexOf(s) !== i);
    expect(dupes, "这些 slug 被分配了不止一次").toEqual([]);
  });

  it("表里没有仓库不存在的 slug", () => {
    const known = new Set(repoSlugs);
    expect(allAssignedSkillSlugs().filter((s) => !known.has(s))).toEqual([]);
  });

  it("starter-pack 发货的 stableName 与 SKILL.md slug 同一套，且全部已分配", () => {
    const packSlugs = starterPackSlugs();
    expect(packSlugs.filter((s) => entryPointOf(s) === null)).toEqual([]);
    expect(new Set(packSlugs)).toEqual(new Set(repoSlugs));
  });

  it("隐藏表每项都有原因", () => {
    for (const h of HIDDEN_PLATFORM_SKILLS) expect(h.note).not.toBe("");
  });
});
