/**
 * #458 的 import 闭包走图器 —— 抽出来给第二个调用方（#520）用。
 *
 * ## 为什么抽，而不是复制一份
 *
 * 这段代码就是「这条路径不吃 mock」这条断言的**判定标准本身**。复制一份之后，两份
 * 会各自演化：有人给 A 补了动态 `import()` 的正则，B 仍然漏着，于是 B 的绿是假的，
 * 而没有任何地方看得出来。`AGENTS.md`：**同一事实不得声明在两处**。
 *
 * ⚠ 本文件不叫 `*.test.ts`，所以 vitest 的 `include` 不会收它——它是工具，不是门控。
 * 门控在 `agent-admin-route-no-mock.test.ts`（#458）与 `skill-create-route-no-mock.test.ts`
 * （#520）里，两者都必须各自带**反空转**断言：走图器解析不出任何 import 时，
 * 「没有 mock 边」会恒真。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export const ROOT = process.cwd();

/** 只认静态 import/export-from：动态 `import()` 也一并抓，漏掉它等于留了一扇后门。 */
const SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

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

export interface ImportClosure {
  /** 被走到的全部本仓模块（相对仓内路径，已排序）。 */
  readonly visited: string[];
  /** 命中的 `lib/mock/**` 依赖边，形如 `a.tsx -> lib/mock/b.ts`（已排序）。 */
  readonly mockEdges: string[];
}

/**
 * 从 entry 出发的传递闭包。
 *
 * ⚠ 入口不存在时**抛错**而不是返回空：一个拼错的入口会让「没有 mock 边」恒真，
 *   那正是本仓九次「全绿但空转」的形状。调用方无需再自己判存在性。
 */
export function walk(entry: string): ImportClosure {
  const start = resolve(ROOT, entry);
  if (!existsSync(start)) {
    throw new Error(`走图入口不存在：${entry}（入口写错了，断言会空转）`);
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
  return {
    visited: [...visited].map((f) => relative(ROOT, f)).sort(),
    mockEdges: [...new Set(mockEdges)].sort(),
  };
}
