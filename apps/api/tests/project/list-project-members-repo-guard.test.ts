/**
 * 豁免的载荷：`scripts/lint-permission-paths.mjs` 里
 * `pg-project-membership-repository.ts` 那条 ALLOWLIST 条目，在 #609 之后多了**读的一半**
 * （`findProjectKind` / `listWorkshopMembers`）。条目逐字写着它「仅在以下形状成立时有效」——
 * 本文件把那句话变成会红的东西，**纯静态解析源码，不需要 Postgres**
 * （同 `project-name-lookup-repo-guard.test.ts` / `advance-segment-repo-guard.test.ts` 的写法）。
 *
 * 钉四件：
 *   ① 只碰 `project_memberships` / `projects` / `credentials` 三张表，不多一张；
 *   ② 名单查询带 `m.project_id = $1` 这条判权谓词——去掉它，一次合法的读会返回**别的项目**
 *      的成员，而返回值看起来完全正常；
 *   ③ 名单只取四列，不是 `*`——`SELECT *` 会让将来给 `project_memberships` 加的任何一列
 *      （比如一个内部标记）自动出现在响应里，没有任何东西会报警；
 *   ④ `credentials` 是 `LEFT JOIN` 不是 `INNER JOIN`——免注册受邀者没有凭据行，
 *      INNER JOIN 会让这样一个人**整行从名单里消失**，而名单少一个人同样不会报警。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_SRC = fileURLToPath(
  new URL("../../src/infrastructure/project/pg-project-membership-repository.ts", import.meta.url),
);

function stripComments(body: string): string {
  return body
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
}

const code = (): string => stripComments(readFileSync(REPO_SRC, "utf8"));

/** 名单那条 SELECT 的正文（从 `FROM project_memberships` 往回取到最近的 SELECT）。 */
function rosterSelect(src: string): string {
  // ⚠ 用「不含反引号」的字符类而不是 `[\s\S]*?`：后者会从**上一条** SQL 模板字面量里的
  //   SELECT 开始懒匹配，把 removeMember 的 `SELECT status` 当成名单查询的列集
  //   （首版实测如此——一条看起来很合理的正则，比对的是另一条语句）。
  const m = /SELECT ([^`]*?) FROM project_memberships m\b([^`]*?)`/.exec(src);
  expect(m, "没扫到名单查询（`... FROM project_memberships m`）——本文件在空转").not.toBeNull();
  return `SELECT ${m![1]!} FROM project_memberships m ${m![2]!}`;
}

describe("① 表引用不多不少", () => {
  it("只命名 project_memberships / projects / credentials", () => {
    const src = code();
    expect(src, "文件没读到或不含 SQL——本断言在空转").toMatch(/FROM project_memberships/);

    const refs = [...src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["project_memberships", "projects", "credentials"]));
  });
});

describe("② 名单查询带 project_id 判权谓词", () => {
  it("WHERE 子句以 m.project_id = $1 约束", () => {
    expect(rosterSelect(code())).toMatch(/WHERE\s+m\.project_id\s*=\s*\$1/);
  });

  it("反证：判定函数对一条去掉了谓词的同形查询必须失败", () => {
    const withoutPredicate = `SELECT m.user_id, c.display_name, m.project_role, m.is_host
           FROM project_memberships m
           LEFT JOIN credentials c ON c.user_id = m.user_id
          ORDER BY m.user_id ASC`;
    expect(/WHERE\s+m\.project_id\s*=\s*\$1/.test(withoutPredicate)).toBe(false);
  });
});

describe("③ 名单只取四列", () => {
  it("SELECT 列集恰为 user_id / display_name / project_role / is_host，且不是 *", () => {
    const select = rosterSelect(code());
    const columns = /SELECT\s+([\s\S]*?)\s+FROM/.exec(select)![1]!
      .split(",")
      .map((c) => c.trim().replace(/^[a-z]\./, ""));
    expect(columns).toEqual(["user_id", "display_name", "project_role", "is_host"]);
    expect(select).not.toMatch(/SELECT\s+\*/);
  });

  it("容器种类那条查询同样只取 kind 一列", () => {
    expect(code()).toMatch(/SELECT kind FROM projects WHERE id = \$1/);
  });
});

describe("④ credentials 是 LEFT JOIN", () => {
  it("没有凭据行的成员不会从名单里消失", () => {
    const select = rosterSelect(code());
    expect(select).toMatch(/LEFT JOIN credentials/);
    expect(select, "INNER JOIN 会让免注册受邀者整行消失").not.toMatch(/INNER JOIN credentials/);
  });
});
