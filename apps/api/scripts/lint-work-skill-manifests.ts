/**
 * lint-work-skill-manifests.ts —— UC-1 `lintWorkSkillManifests`（Phase 20 WS01）。
 *
 * 扫描给定根目录（默认仓库 `skills/`）下所有 `SKILL.md`，对含 `metadata.work` 的文件用契约
 * `WorkSkillManifest` 校验；任一失败逐条打印 `文件: 字段路径: 原因` 并以退出码 1 结束。
 * 无 `metadata.work` 的普通 Skill 跳过（A1）。
 *
 *   pnpm --filter @repo/api exec tsx scripts/lint-work-skill-manifests.ts [root ...]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatWorkSkillManifestIssue,
  parseWorkSkillManifest,
  type WorkSkillManifestIssue,
} from "../src/domain/skill/work-skill-manifest";
import { isCliEntry } from "./cli-entry";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

function findSkillFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out.sort();
}

export interface LintWorkSkillManifestsResult {
  readonly checked: number;
  readonly valid: number;
  readonly issues: readonly WorkSkillManifestIssue[];
}

export function lintWorkSkillManifests(roots: readonly string[]): LintWorkSkillManifestsResult {
  let checked = 0;
  let valid = 0;
  const issues: WorkSkillManifestIssue[] = [];
  for (const root of roots) {
    const files = statSync(root).isDirectory() ? findSkillFiles(root) : [root];
    for (const file of files) {
      const shown = relative(process.cwd(), file) || file;
      const result = parseWorkSkillManifest(shown, readFileSync(file, "utf8"));
      if (result.kind === "absent") continue;
      checked += 1;
      if (result.kind === "valid") valid += 1;
      else issues.push(...result.issues);
    }
  }
  return { checked, valid, issues };
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const roots = args.length > 0 ? args.map(arg => resolve(arg)) : [join(REPO_ROOT, "skills")];
  const result = lintWorkSkillManifests(roots);
  for (const issue of result.issues) console.error(formatWorkSkillManifestIssue(issue));
  if (result.issues.length > 0) {
    console.error(`lint-work-skill-manifests: ${result.issues.length} 个问题（${result.checked} 个 Work Skill）`);
    process.exit(1);
  }
  console.log(`lint-work-skill-manifests: ${result.valid}/${result.checked} 个 Work Skill manifest 通过`);
}
