/**
 * 2026-09-10 —— 「导入 session 报 HTTP 500」的机械门。
 *
 * `design_project_chat_messages.source` 的闭集被声明了两处：契约 `AiReplySource`，与
 * 这一列的 CHECK 约束。迭代 13 往契约里加了 `system`（导入线程的留痕），CHECK 没跟上，
 * 于是确认导入时 INSERT 被约束打回 ⇒ 未映射的异常 ⇒ 500。预览不写库，所以「摘要出来了、
 * 一确认就炸」——症状看起来像模型问题，其实是一条约束。
 *
 * 这条测试把两处钉在一起：CHECK 里的值集必须**逐字等于**契约枚举。读的是 migrations 目录
 * 的最终态（后面的迁移会重建这个约束），所以取**最后一条**声明它的迁移。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { designAiCollab } from "@repo/contracts";

const MIGRATIONS = join(__dirname, "../../migrations");

describe("design_project_chat_messages.source 的闭集", () => {
  it("库里的 CHECK 与契约 AiReplySource 是同一个集合", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let last: string | null = null;
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8");
      // ⚠ 逐**语句**看，不是逐文件：一个迁移文件里可以同时建好几张表的 `source` 列，
      //   按文件匹配会把版本表的 `('user','model','restore')` 当成这张表的闭集——
      //   写这条测试时就先踩了一次，它红了，但红的是另一张表（反证反过来验了自己）。
      for (const stmt of sql.split(";")) {
        if (!/design_project_chat_messages/i.test(stmt)) continue;
        const m = /CHECK\s*\(\s*source\s+IN\s*\(([^)]*)\)\s*\)/i.exec(stmt);
        if (m !== null) last = m[1]!;
      }
    }
    // 空集防线：一条都没找到不算通过——那说明这条测试已经不再看着任何东西。
    expect(last, "没有任何迁移声明 design_project_chat_messages.source 的 CHECK").not.toBeNull();
    const inSql = last!.split(",").map((x) => x.trim().replace(/^'|'$/g, "")).sort();
    expect(inSql).toEqual([...designAiCollab.AiReplySource.options].sort());
  });
});
