/**
 * F122 → F185（2026-08-16 delta）—— `pg-project-list-repository.ts` 在
 * `lint-permission-paths.mjs` 白名单里那条豁免的**强制前提**（不是一句声明）。
 *
 * 那条豁免的论证是「这个文件只投影 `project_memberships` / `projects` /
 * `organizations` / `project_tags` 四张表里能定义『这个容器该不该出现在列表里、
 * 带什么标签』的字段，不含任何内容摘要（D-18 边界）」。F185 在原来三张表的基础上
 * 加了 `project_tags` 的相关子查询（只读 `tag` 一列，不是 JOIN），六个键里
 * 新增的 `tags` 与既有的 `status`/`orgStatus` 同一类别——都不是内容。
 * 这条断言把论证钉成可执行的东西：
 *   ① 该文件里**没有**任何写语句（INSERT/UPDATE/DELETE）——纯读；
 *   ② 仓储返回的每一行**只有**六个键：`id/name/kind/status/orgStatus/tags`，
 *      没有第七个键能夹带内容摘要、计数或「最近活动」；
 *   ③ 只出现四张允许的表，没有第五张。
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

describe("F122/F185 白名单豁免的强制前提：pg-project-list-repository.ts 只读、只投影六个字段", () => {
  it("① 没有任何写语句", () => {
    const code = codeLines(readFileSync(SRC, "utf8")).join("\n");
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    // 非空转：文件确实有 SELECT，不是整个文件是空的。
    expect(code).toMatch(/\bSELECT\b/i);
  });

  it("② toListRow 的输出恰好六个键，没有第七个", () => {
    const code = readFileSync(SRC, "utf8");
    const m = /function toListRow\(r: ProjectListSqlRow\): ProjectListRow \{\s*return \{([^}]*)\};/.exec(code);
    expect(m, "toListRow 的实现应能被本断言解析——形状变了，本断言也要跟着看一遍").not.toBeNull();
    const keys = [...(m![1]!.matchAll(/(\w+):/g))].map((x) => x[1]);
    expect(keys.sort()).toEqual(["id", "kind", "name", "orgStatus", "status", "tags"].sort());
  });

  it("③ 只查四张表：project_memberships / projects / organizations / project_tags", () => {
    const code = codeLines(readFileSync(SRC, "utf8")).join("\n");
    const refs = new Set(
      [...code.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase()),
    );
    expect([...refs].sort()).toEqual(
      ["organizations", "project_memberships", "project_tags", "projects"].sort(),
    );
  });

  it("④ project_tags 只经相关子查询读一列 tag，不是 JOIN（不会把别的容器的标签混进来）", () => {
    const code = readFileSync(SRC, "utf8");
    expect(code).toMatch(/SELECT\s+array_agg\(pt\.tag[\s\S]{0,80}FROM\s+project_tags\s+pt\s+WHERE\s+pt\.project_id\s*=\s*p\.id/i);
    expect(code).not.toMatch(/JOIN\s+project_tags/i);
  });
});
