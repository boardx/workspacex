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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { validateInstanceMetadata, type InstanceMetadata, type ValidationIssue } from "./template-model";

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".next", ".turbo", "dist", "build", ".vercel",
  "coverage", ".claude", ".wrangler",
]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
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
