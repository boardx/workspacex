/**
 * F122 —— `pg-project-list-repository.ts` 在 `lint-permission-paths.mjs` 白名单里那条
 * 豁免的**强制前提**（不是一句声明）。
 *
 * 那条豁免的论证是「这个文件只投影 `project_memberships` / `projects` /
 * `organizations` 三张表里能定义『这个容器该不该出现在哪一段列表』的字段，
 * 不含任何内容摘要（D-18 边界）」。这条断言把论证钉成可执行的东西：
 *   ① 该文件里**没有**任何写语句（INSERT/UPDATE/DELETE）——纯读；
 *   ② 仓储返回的每一行**只有**五个键：`id/name/kind/status/orgStatus`，
 *      没有第六个键能夹带内容摘要、计数或「最近活动」。
 * 少了这条测试，`lint-permission-paths.mjs` 里那条白名单只是一句没人验证的承诺——
 * 明天有人往这个文件加一条 `SELECT ... FROM artifacts` 也不会有任何东西报警。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(
  new URL("../../src/infrastructure/project/pg-project-list-repository.ts", import.meta.url),
);

function codeLines(body: string): string[] {
  return body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

describe("F122 白名单豁免的强制前提：pg-project-list-repository.ts 只读、只投影五个字段", () => {
  it("① 没有任何写语句", () => {
    const code = codeLines(readFileSync(SRC, "utf8")).join("\n");
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    // 非空转：文件确实有 SELECT，不是整个文件是空的。
    expect(code).toMatch(/\bSELECT\b/i);
  });

  it("② toListRow 的输出恰好五个键，没有第六个", () => {
    const code = readFileSync(SRC, "utf8");
    const m = /function toListRow\(r: ProjectListSqlRow\): ProjectListRow \{\s*return \{([^}]*)\};/.exec(code);
    expect(m, "toListRow 的实现应能被本断言解析——形状变了，本断言也要跟着看一遍").not.toBeNull();
    const keys = [...(m![1]!.matchAll(/(\w+):/g))].map((x) => x[1]);
    expect(keys.sort()).toEqual(["id", "kind", "name", "orgStatus", "status"].sort());
  });

  it("③ 只查三张表：project_memberships / projects / organizations", () => {
    const code = codeLines(readFileSync(SRC, "utf8")).join("\n");
    const refs = new Set(
      [...code.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase()),
    );
    expect([...refs].sort()).toEqual(["organizations", "project_memberships", "projects"].sort());
  });
});
