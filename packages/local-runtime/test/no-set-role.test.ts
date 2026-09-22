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

describe("the premise that keeps local RLS honest", () => {
  it("never issues SET ROLE / RESET ROLE from the API", () => {
    // 注释里提到它是可以的（本文件自己就提了一路）；语句才是问题。
    const statement = /^[^*/]*\b(SET|RESET)\s+ROLE\b/im;
    const offenders = walk(API_SRC).filter((file) => statement.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.slice(API_SRC.length + 1))).toEqual([]);
  });
});
