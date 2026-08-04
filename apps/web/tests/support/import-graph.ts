/**
 * 从某个入口出发把 import 图走成**传递闭包**，报出所有指向 `lib/mock/**` 的边。
 *
 * ## 为什么是走图，不是 grep 一个文件
 *
 * `covered-routes-no-mock.test.ts` 对单个文件做字符串断言，它防的是「这个文件里
 * 写了 mock」。但 mock 依赖的真实失效方式是**间接的**：屏组件干干净净，它引的某个
 * 子组件里 `import { TEAM_AGENTS } from "@/lib/mock/chat"`。只查根文件的断言对此
 * **全绿**。走图器把整棵依赖树走完，因此能看见隔了几跳的那条边。
 *
 * ## 出处
 *
 * 实现逐字取自 #458 的 `tests/session/agent-admin-route-no-mock.test.ts`（那是本仓
 * 第一份走图器）。#467 需要同一个能力，与其抄第二份，不如抽出来共用——
 * 「同一事实不得声明在两处」。
 * ⚠ 已知残留：#458 那个文件仍持有自己的副本，尚未改为引用本模块。收敛它属于 #458
 *   的范围，已另行上报，本文件不顺手去改别人的 issue。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const ROOT = process.cwd();

/** 只认静态 import/export-from：动态 `import()` 也一并抓，漏掉它等于留了一扇后门。 */
const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return null; // 裸包名：node_modules，不是本仓源码
  for (const candidate of [
    base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`,
  ]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        readFileSync(candidate, "utf8");
        return candidate;
      } catch {
        // 目录本身：继续试带扩展名的候选
      }
    }
  }
  return null;
}

export interface ImportGraphWalk {
  /** 闭包里被走到的全部模块（相对 apps/web 的路径），已排序。 */
  readonly visited: string[];
  /** 命中的 mock 依赖边，形如 `a.tsx -> lib/mock/chat.ts`。 */
  readonly mockEdges: string[];
}

/** ⚠ 入口不存在时抛出，而不是返回空——空结果会让「没有 mock」变成一次空转。 */
export function walkImports(entry: string): ImportGraphWalk {
  const start = resolve(ROOT, entry);
  if (!existsSync(start)) {
    throw new Error(`走图入口不存在：${entry}——入口写错了，断言会空转`);
  }
  const visited = new Set<string>();
  const mockEdges: string[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const target = resolveModule(file, specifier);
      if (target === null) continue;
      if (relative(ROOT, target).startsWith("lib/mock/")) {
        mockEdges.push(`${relative(ROOT, file)} -> ${relative(ROOT, target)}`);
        continue;
      }
      queue.push(target);
    }
  }
  return { visited: [...visited].map((f) => relative(ROOT, f)).sort(), mockEdges };
}
