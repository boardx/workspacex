// skills-doctor.ts — pnpm harness skills doctor
//
// 判定逻辑在 lib/skill-doctor-model.ts（纯函数，喂 fixture 单测）。这里只做：
// 扫描 .agents/skills/*/SKILL.md → 交给校验函数（用真实 existsSync 当
// pathExists）→ 按结果决定退出码，同 terminology-doctor.ts/templates-doctor.ts
// 的分层方式。
//
// 背景：skill 深度升级 backlog（.harness/state/skill-upgrade-backlog.md）第 1
// 轮里 6 个批次共同打出的最低分维度是"可维护性"——新增知识性章节引用了大量
// 具体文件路径，之前只能靠人读一遍去核实。本命令把"引用的仓库路径是否还存在"
// 这条能穷举验证的子集机械化，不解决"内容是否还准确"这种需要人类判断的问题。
//
// ⚠ 如实说明本命令没做的部分：不检查 PR 号/commit hash/ADR 编号这类非路径引用
// 是否还有效（那需要 git log 里逐条核实，且历史 commit 天然存在，"有效"的定义
// 不是"存在"而是"内容对得上"，是不同性质的检查）；不检查 mod-_template 骨架本身
// （模板占位符故意不是真实路径）。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/paths";
import { checkSkillFiles, type SkillFile } from "./lib/skill-doctor-model";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const SKILLS_DIR = join(REPO_ROOT, ".agents", "skills");

function loadSkillFiles(): SkillFile[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const files: SkillFile[] = [];
  for (const entry of readdirSync(SKILLS_DIR)) {
    if (entry === "mod-_template") continue; // 骨架模板，占位符不是真实路径
    const skillPath = join(SKILLS_DIR, entry, "SKILL.md");
    if (!existsSync(skillPath) || !statSync(skillPath).isFile()) continue;
    files.push({
      skillName: entry,
      filePath: `.agents/skills/${entry}/SKILL.md`,
      content: readFileSync(skillPath, "utf8"),
    });
  }
  return files;
}

export function skillsDoctor(_args: Args): void {
  const files = loadSkillFiles();
  if (files.length === 0) {
    log.warn("[skills doctor] .agents/skills/ 下没找到任何 SKILL.md，跳过");
    process.exitCode = 0;
    return;
  }

  const result = checkSkillFiles(files, (p) => existsSync(join(REPO_ROOT, p)));

  if (result.ok) {
    log.ok(
      `[skills doctor] ${result.totalSkills} 个 skill，共引用 ${result.totalReferencedPaths} 条仓库路径，全部存在`,
    );
  } else {
    log.err(`[skills doctor] 发现 ${result.missing.length} 条失效路径引用：`);
    for (const f of result.missing) {
      log.err(`   ${f.skillName}（${f.filePath}）引用了不存在的路径：${f.referencedPath}`);
    }
  }

  log.info("");
  log.info("本命令未覆盖（如实列出，不是遗漏）：");
  log.info("   · 引用内容是否仍然准确（只查路径是否存在，不查语义是否过时）");
  log.info("   · PR 号/commit hash/ADR 编号这类非路径引用的有效性");

  process.exitCode = result.ok ? 0 : 1;
}
