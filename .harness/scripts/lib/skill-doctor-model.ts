// skill-doctor-model.ts — 纯函数部分，喂 fixture 单测。
//
// 背景（skill 深度升级 backlog 第 1 轮的自评结论，见
// .harness/state/skill-upgrade-backlog.md）：24 个 skill 补齐"能力清单/架构
// 知识/领域知识"后，6 个批次共同打出的最低分维度是"可维护性"——新增的知识性
// 章节引用了大量具体文件路径/命令，目前只靠"谁踩坑谁回流"的软约束保证不过时，
// 没有机械检查。本模块把"skill 里提到的仓库路径是否还存在"这条最基础、最容易
// 机械化的新鲜度信号，变成可重复运行的检查——不解决"内容是否还准确"这种需要
// 人类判断的问题，只解决"引用的东西还在不在"这个能穷举验证的子集。
//
// 判定逻辑：从 SKILL.md 正文里提取反引号包住、且形如仓库路径的字符串（以
// apps/、packages/、docs/、phases/、.harness/ 开头），逐条问调用方"这个路径
// 存在吗"，不存在的记为一条 finding。刻意排除明显不是路径的反引号内容（命令、
// 变量名、代码片段）——见 extractRepoPathCandidates 里的启发式规则与其单测。
export interface SkillFile {
  skillName: string; // 目录名，如 "mod-chat"
  filePath: string; // 相对仓库根的路径，如 ".agents/skills/mod-chat/SKILL.md"
  content: string;
}

export interface PathFinding {
  skillName: string;
  filePath: string;
  referencedPath: string;
}

export interface SkillDoctorResult {
  ok: boolean;
  totalSkills: number;
  totalReferencedPaths: number;
  missing: PathFinding[];
}

const PATH_PREFIXES = ["apps/", "packages/", "docs/", "phases/", ".harness/"];

// 反引号内容长得像仓库路径的启发式：以已知前缀开头，且不含空格/中文/花括号
// 展开语法之外的"看起来是路径"的字符。花括号展开（如 apps/api/src/application/
// {agent,agent-run}）单独处理：展开成多条候选路径分别检查，因为这是本仓 skill
// 文件里高频出现的写法（一次性列举同级多个目录）。
// 每行末尾（反引号之后）出现这个标记，代表这一行里所有反引号路径都是**刻意**
// 引用了不存在/不再存在的路径（教学用的"这不是真的"反例，或者已经在正文里写明
// 是"已知缺口"的路径），不是需要机械检查的正常引用。约定写在同一行末尾，
// 保持"标注就在被标注内容旁边"，不引入另一份要单独维护的忽略清单文件。
const IGNORE_MARKER = "skill-doctor:ignore";

export function extractRepoPathCandidates(content: string): string[] {
  const candidates = new Set<string>();

  for (const line of content.split("\n")) {
    if (line.includes(IGNORE_MARKER)) continue;

    const backtickMatches = line.match(/`([^`]+)`/g) ?? [];
    for (const raw of backtickMatches) {
      const inner = raw.slice(1, -1).trim();
      if (!PATH_PREFIXES.some((p) => inner.startsWith(p))) continue;
      // 排除明显是命令行的内容（含空格且不是花括号展开的那种）
      if (/\s/.test(inner) && !inner.includes("{")) continue;
      // 排除纯粹的字段名引用类（如 `apps/*` 通配，不是具体路径，跳过整体统配符）
      if (inner.includes("*") && !inner.includes("{")) continue;
      // 排除模板占位符（`phases/<phase>/...`）与省略号简写
      // （`apps/web/.../rooms/page.tsx`）——两者都不是字面路径，是给人看的示意写法。
      if (inner.includes("<") || inner.includes(">") || inner.includes("...")) continue;

      for (const expanded of expandBraces(inner)) {
        // 去掉行尾可能带的标点（中文冒号/句号等常跟在反引号后面但没被反引号包住，
        // 这里只处理反引号内部残留的标点）
        const cleaned = expanded.replace(/[，。：；、]+$/u, "");
        if (cleaned) candidates.add(cleaned);
      }
    }
  }

  return [...candidates];
}

// 展开路径里的花括号列表（可能不止一组，如
// "apps/api/src/{infrastructure,domain}/{canvas,artifact}"），逐组做笛卡尔积展开。
// 没有花括号就原样返回单元素数组。
function expandBraces(path: string): string[] {
  const match = path.match(/^(.*?)\{([^{}]+)\}(.*)$/);
  if (!match) return [path];
  const [, prefix = "", group = "", suffix = ""] = match;
  const options = group.split(",").map((part) => part.trim());
  const results: string[] = [];
  for (const option of options) {
    // 递归展开剩余部分（suffix 里可能还有下一组花括号）
    for (const rest of expandBraces(`${prefix}${option}${suffix}`)) {
      results.push(rest);
    }
  }
  return results;
}

export function checkSkillFiles(
  files: SkillFile[],
  pathExists: (repoRelativePath: string) => boolean,
): SkillDoctorResult {
  const missing: PathFinding[] = [];
  let totalReferencedPaths = 0;

  for (const file of files) {
    const candidates = extractRepoPathCandidates(file.content);
    totalReferencedPaths += candidates.length;
    for (const referencedPath of candidates) {
      if (!pathExists(referencedPath)) {
        missing.push({ skillName: file.skillName, filePath: file.filePath, referencedPath });
      }
    }
  }

  return {
    ok: missing.length === 0,
    totalSkills: files.length,
    totalReferencedPaths,
    missing,
  };
}
