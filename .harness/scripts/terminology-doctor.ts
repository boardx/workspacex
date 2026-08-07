// terminology-doctor.ts — H3A-006/007/008 的仓库侧入口。
//
// pnpm harness terminology doctor
//
// 判定逻辑全在 lib/terminology-model.ts（纯函数，喂 fixture 单测）。这里只做：
// 读两份 registry → 交给校验函数 → 按结果决定退出码，同 templates-doctor.ts
// 的分层方式。
//
// ⚠ 如实说明本命令没做的部分：完成契约里"新写旧字段会红"需要扫描全仓源码里
// 实际使用了哪些字段名，那是一个不同性质的检查（AST/字符串扫描，同
// lint-nav-reachability.mjs 一类），本命令只管两份 registry 文件自身的结构
// 完整性（同义词唯一性、映射无歧义），不做全仓扫描——留给未来单独一条
// H3A-008b（如果需要）。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateTerminologyRegistry, validateCompatRegistry } from "./lib/terminology-model";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const REGISTRY_PATH = join(REPO_ROOT, ".harness", "terminology", "registry.yaml");
const COMPAT_PATH = join(REPO_ROOT, ".harness", "terminology", "compat.yaml");

function readYaml(path: string): { parsed: unknown; error: string | null } {
  if (!existsSync(path)) return { parsed: null, error: `文件不存在：${path}` };
  try {
    return { parsed: parse(readFileSync(path, "utf8")), error: null };
  } catch (e) {
    return { parsed: null, error: `解析失败：${(e as Error).message}` };
  }
}

export function terminologyDoctor(_args: Args): void {
  let failed = false;

  const { parsed: regRaw, error: regErr } = readYaml(REGISTRY_PATH);
  if (regErr) {
    log.err(`[terminology doctor] registry.yaml ${regErr}`);
    failed = true;
  } else {
    const result = validateTerminologyRegistry(regRaw);
    if (!result.ok) {
      log.err(`[terminology doctor] registry.yaml 校验失败，${result.issues.length} 条问题：`);
      for (const issue of result.issues) log.err(`   ${issue.path}: ${issue.message}`);
      failed = true;
    } else {
      log.ok(`[terminology doctor] registry.yaml：${result.value!.entries.length} 个 Term ID，无重复/无歧义映射`);
    }
  }

  const { parsed: compatRaw, error: compatErr } = readYaml(COMPAT_PATH);
  if (compatErr) {
    log.err(`[terminology doctor] compat.yaml ${compatErr}`);
    failed = true;
  } else {
    const result = validateCompatRegistry(compatRaw);
    if (!result.ok) {
      log.err(`[terminology doctor] compat.yaml 校验失败，${result.issues.length} 条问题：`);
      for (const issue of result.issues) log.err(`   ${issue.path}: ${issue.message}`);
      failed = true;
    } else {
      log.ok(`[terminology doctor] compat.yaml：${result.value!.mappings.length} 条字段迁移映射，无重复/无歧义`);
    }
  }

  log.info("");
  log.info("以下 H3A-008 完成契约条款本命令尚未实现（如实列出，不是遗漏）：");
  log.info("   · 全仓扫描新代码是否新写旧字段名——需要 AST/字符串级扫描，是不同性质的检查");

  process.exitCode = failed ? 1 : 0;
}
