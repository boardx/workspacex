/**
 * template-scan.ts —— 仓库级扫描，找出所有声明了实例元数据的文件。
 *
 * 与判定逻辑（template-doctor.ts）分开是刻意的：判定是纯函数，喂 fixture 就能测；
 * 扫描要碰真实文件系统，只在 CLI 入口调用一次。这条分层今天在 rewrite-coverage.ts
 * 上已经证明过价值——判定逻辑的单测跑起来是毫秒级，不依赖仓库当前长什么样。
 *
 * **识别规则**：一份文件被当成"实例文档"，当且仅当它同时含 `template_id` 与
 * `instance_id` 两个键——只查一个会在 `pnpm-workspace.yaml`、docker-compose 之类
 * 毫不相干的 YAML 文件上产生噪音（这两个键同时出现的概率趋近于零，除非真的是
 * 本模型的实例）。支持两种载体：独立 `.yaml`/`.yml` 文件，或 Markdown 文件顶部的
 * YAML frontmatter（`---\n...\n---`）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { DOMAIN_SKILL_TEMPLATE_ID } from "./domain-skill-model";
import { validateInstanceMetadata, type InstanceMetadata, type ValidationIssue } from "./template-model";

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".next", ".turbo", "dist", "build", ".vercel",
  "coverage", ".claude", ".wrangler",
]);

/**
 * 这个目录是不是一个**嵌套的 git worktree / 仓库**。
 *
 * 判据是 `.git` 存在（worktree 里它是一个写着 `gitdir: …` 的**文件**，独立 clone 里是目录），
 * 与目录叫什么名字无关 —— 所以 `.worktrees/xxx`、`wt-review`、随手起的
 * `/tmp` 之外的任何名字都能被认出来。
 */
function isNestedCheckout(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      /*
       * ⚠ 跳过嵌套 checkout。本仓的并行开发工作流（parallel-dev-workflow.md §5）
       * 就是在仓库根下开 worktree（`.worktrees/*`、`wt-*`），而 worktree 是整棵树的
       * 副本 ⇒ 每一份模板实例都会被数到两次 ⇒ 满屏 TPL-DUP-INSTANCE 假阳性，
       * **`verify:base` 对任何正在并行开发的人都跑不绿**。
       *
       * 实测（2026-08-08，#728）：根下有 `wt-review/`、`wt-h3a-030/` 两个别的会话的
       * worktree 时，`templates doctor` 报 2 条 TPL-DUP-INSTANCE，指的都是
       * 「`.harness/templates/examples/EVT-hmv2-e1-001.yaml` 与它自己的副本重复」。
       *
       * 按名字加豁免（把 `.worktrees` 塞进 EXCLUDED_DIRS）挡不住随手起名的
       * `wt-review`；按 `.git` 判定才是与命名无关的那条线。
       * ⚠ 这**不会**放过真实的重复：同一棵树里两份不同文件用同一个 instance_id，
       *   仍然照报不误（反证见 template-scan.test.ts）。
       */
      if (isNestedCheckout(join(dir, entry.name))) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml") || entry.name.endsWith(".md"))) {
      out.push(join(dir, entry.name));
    }
  }
}

function extractFrontmatter(markdown: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  return m ? m[1]! : null;
}

/** 判断一份已解析的 YAML 是否"看起来像"实例元数据——两个关键字段都要在。 */
function looksLikeInstance(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const r = parsed as Record<string, unknown>;
  return typeof r["template_id"] === "string" && typeof r["instance_id"] === "string";
}

export interface ScanResult {
  instances: InstanceMetadata[];
  validationFailures: { sourceFile: string; message: string }[];
}

/** 真正走文件系统。repoRoot 之外的路径不会被触碰。 */
export function scanForInstances(repoRoot: string): ScanResult {
  const files: string[] = [];
  walk(repoRoot, files);

  const instances: InstanceMetadata[] = [];
  const validationFailures: { sourceFile: string; message: string }[] = [];

  for (const file of files) {
    const relPath = relative(repoRoot, file);
    const text = readFileSync(file, "utf8");
    const yamlText = file.endsWith(".md") ? extractFrontmatter(text) : text;
    if (yamlText === null) continue;

    let parsed: unknown;
    try {
      parsed = parse(yamlText);
    } catch {
      continue; // 不是合法 YAML，大概率不是我们的目标文件（比如带 Jinja 占位符的模板），静默跳过
    }
    if (!looksLikeInstance(parsed)) continue;

    /*
     * ⚠ TPL-MOD-001（Domain Skill）不归本扫描管。它有自己的一套 schema
     * （domain-skill-model.ts —— 真实形状**没有** `scope` 字段，Domain Skill 属于
     * 长期 Domain 不属于某个 phase）和自己的验证入口
     * （`pnpm run lint:domains-doctor`，与本扫描一样都在 verify:base 链上）。
     * 用这里的通用 InstanceMetadata schema（要求 `scope.project`）去校验它，
     * 产生的正是 domain-skill-model.ts 文件头预言过的那种假阳性——
     * 实测（2026-08-10，#728 round 15）：PR #827 合入的
     * `.agents/skills/mod-canvas-diagram/SKILL.md` 被本扫描按通用 schema 判红
     * （TPL-INSTANCE-SCHEMA-INVALID: scope.project 必须是字符串），把 verify:base
     * 拖红了三天，而同一份文件在 domains-doctor 下是绿的。
     * 跳过 ≠ 放过：schema 校验责任完整地落在 domains-doctor 那条门上，
     * 这里只是不再用错误的尺子量第二遍（AGENTS.md：同一事实不得声明在两处）。
     */
    if ((parsed as Record<string, unknown>)["template_id"] === DOMAIN_SKILL_TEMPLATE_ID) continue;

    const result = validateInstanceMetadata(parsed, relPath);
    if (result.ok && result.value) {
      instances.push(result.value);
    } else {
      const message = result.issues.map((i: ValidationIssue) => `${i.path}: ${i.message}`).join("；");
      validationFailures.push({ sourceFile: relPath, message });
    }
  }

  return { instances, validationFailures };
}

/** 读注册表文件本身；解析失败时把原因带回去，不让调用方自己猜。 */
export function readRegistryFile(path: string): { parsed: unknown; error: string | null } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return { parsed: null, error: `读不到 ${path}：${(e as Error).message}` };
  }
  try {
    return { parsed: parse(text), error: null };
  } catch (e) {
    return { parsed: null, error: `${path} 不是合法 YAML：${(e as Error).message}` };
  }
}

function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export function fileExists(path: string): boolean {
  return statOrNull(path)?.isFile() === true;
}
