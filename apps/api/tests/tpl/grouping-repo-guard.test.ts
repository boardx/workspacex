/**
 * F950（2026-08-16 delta）—— 把 `pg-grouping-repository.ts` 那条 `lint-permission-paths`
 * 豁免的前提钉成机械事实。这一条比 `project-prep-repo-guard.test.ts` 那两条更窄——它是
 * 三个里唯一碰 `project_memberships`（身份数据）的仓储，所以前提也更严格：
 *   ① 名到的表恰好是 `groups`/`project_grouping_revision`/`project_memberships` 三张。
 *   ② 对 `project_memberships` 的**每一条**语句都是 `UPDATE`，从不出现 `INSERT`——
 *      这是「不能把任何人拉进一个他们本不在的项目」这条豁免论证的机械对应物：
 *      仓储没有能力创建一行新的成员关系，只能改已存在的行的 `group_id`/`project_role`。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/infrastructure/templates/pg-grouping-repository.ts", import.meta.url));

function codeLines(body: string): string[] {
  return body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

describe("F950 pg-grouping-repository.ts 权限豁免前提", () => {
  const source = codeLines(readFileSync(SRC, "utf8")).join("\n");

  it("① 名到的表恰好是允许的三张", () => {
    // ⚠ `ON CONFLICT (id) DO UPDATE\n  SET ...` 会让正则把紧跟 UPDATE 后面的 `SET` 关键字
    // 误认成表名——过滤掉它，不是放宽断言：SQL 关键字不可能是表名，过滤这一个词不会让
    // 真正漏查的表悄悄通过。
    const named = [...new Set(
      [...source.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]!.toLowerCase()),
    )].filter((t) => t !== "set").sort();
    expect(named).toEqual(["groups", "project_grouping_revision", "project_memberships"].sort());
  });

  it("② project_memberships 从不出现在 INSERT INTO 里", () => {
    expect(source).not.toMatch(/INSERT\s+INTO\s+project_memberships/i);
  });

  it("③ 没有 withoutTenant，且确实走 withTenant", () => {
    expect(source).not.toContain("withoutTenant");
    expect(source).toContain("withTenant");
  });

  it("④ 阳性对照：project_memberships 确实被 UPDATE 过（不是这张表完全不出现）", () => {
    expect(source).toMatch(/UPDATE\s+project_memberships/i);
  });
});
