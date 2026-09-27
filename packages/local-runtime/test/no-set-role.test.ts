/**
 * 本地形态的 RLS 之所以仍然成立，靠的是一条**代码层面的前提**：API 从不发 `SET ROLE`。
 *
 * 数据库那边已经拦不住了——pglite-socket 忽略登录角色，`session_user` 恒为 `postgres`，
 * 所以 `SET ROLE postgres` 在本地不会被拒（`pglite-server.test.ts` 把这条偏差钉成了断言）。
 * 在真 Postgres 上，应用连接不是表 owner，这句会被拒；在本地版上，它会成功，而成功意味着
 * 这条连接从此绕过 RLS。
 *
 * 一个今天成立、而且没有任何东西在维持它的前提，就是一条等着被踩的地雷。所以把它钉住：
 * 谁哪天为了别的目的在 API 里引入 `SET ROLE`，在真 Postgres 上大概率会被数据库挡住并当场
 * 发现，而在本地版上**不会有任何症状**——最坏的那种失败形态。这条测试让它先在 CI 上红。
 *
 * ⚠ 放在 local-runtime 而不是 apps/api：这条约束是**本地形态**加上的，apps/api 自己没有
 *   理由禁止 `SET ROLE`。把它放在提出约束的那一侧，理由和约束才在同一个地方。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_SRC = fileURLToPath(new URL("../../../apps/api/src", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * 判据：Postgres 的 `SET ROLE` / `SET SESSION ROLE` / `SET LOCAL ROLE` / `RESET ROLE` 语句。
 *
 * ⚠ 2026-09-27 误报：`pg-whiteboard-repository.ts` 的
 *   `ON CONFLICT(org_id,board_id,user_id) DO UPDATE SET role = …`
 *   是给一个**叫 `role` 的列**赋值，不是切换数据库角色。原正则带 `i` 标志，
 *   `SET role` 就被当成违规，本包测试在 main 上变红（#4242 合入之后）。
 *   区别在于：`SET ROLE` 语句后面跟角色名，**永远不跟 `=`**；列赋值一定跟 `=`。
 */
const statement = /^[^*/]*\b(?:SET(?:\s+(?:SESSION|LOCAL))?|RESET)\s+ROLE\b(?!\s*=)/im;

describe("the premise that keeps local RLS honest", () => {
  it("never issues SET ROLE / RESET ROLE from the API", () => {
    // 注释里提到它是可以的（本文件自己就提了一路）；语句才是问题。
    const offenders = walk(API_SRC).filter((file) => statement.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.slice(API_SRC.length + 1))).toEqual([]);
  });

  it("判据仍然看得见真的 SET ROLE——否定断言要配正面用例", () => {
    // 收紧正则最常见的失败是收过头：什么都不匹配了，门就恒绿。
    for (const real of [
      "await db.query('SET ROLE postgres')",
      "await db.query(`set role app_rw`)",
      "client.query('SET SESSION ROLE postgres')",
      "client.query('SET LOCAL ROLE postgres')",
      "await db.query('RESET ROLE')",
    ]) expect(statement.test(real), real).toBe(true);
  });

  it("列名叫 role 的赋值不是违规", () => {
    for (const benign of [
      "ON CONFLICT(org_id,board_id,user_id) DO UPDATE SET role = EXCLUDED.role",
      "UPDATE board_members SET role=$1 WHERE id=$2",
      "DO UPDATE SET role =$3, updated_at = now()",
    ]) expect(statement.test(benign), benign).toBe(false);
  });
});
