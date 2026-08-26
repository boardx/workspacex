/**
 * 反证 2026-08-26 那次事故：**迁移文件里不许再出现「无条件创建平台组织」的 INSERT**。
 *
 * ## 事故经过
 *
 * `20260826120000_platform_canvas_template_library.sql` 曾经直接
 * `INSERT INTO organizations` + `INSERT INTO org_memberships` 创建平台组织与它的
 * 服务身份。后果是**每一个跑过这份迁移的数据库**（含每一次测试用的隔离库）都无条件
 * 多出一个「有 admin 的组织」——`backfill-default-agents.ts` / `backfill-deep-research-
 * agent.ts` / `backfill-image-gen-agent.ts` 三个脚本都是 `FROM organizations o`
 * （不限定哪个组织）找候选，于是三个脚本各自的单测断言全部多算一个，三条 CI shard
 * 一起红——只有一条症状"expected 2 to be 1"，读起来毫无线索指向平台组织。
 *
 * ## 为什么这条断言是**静态**的，不是起真库查
 *
 * 本仓的测试隔离是**整个 vitest run 共用一个隔离库**（各测试文件用各自的 org id
 * 互不踩踏，不是每个文件一个全新库）。真去查"库里有没有 kind='platform' 的组织"，
 * 结果取决于 `platform-template-visibility.test.ts` 的 `backfillPlatformOrg()` 有没有
 * 先跑过——那是一场看执行顺序的赛跑，不是本条要证的事。真正要挡的是**源码**：
 * 平台组织的创建逻辑必须待在显式脚本里，不能被下一个人复制粘贴回某份新迁移。
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "../../migrations");

describe("平台组织不由迁移种（2026-08-26 事故反证）", () => {
  it("有迁移文件可查（反空转：目录路径写错会让本条假绿）", () => {
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length).toBeGreaterThan(30);
  });

  it("没有任何迁移会 INSERT kind='platform' 的组织", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith(".sql")) continue;
      const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      // ⚠ 必须先剥掉 `--` 行注释：本文件自己的迁移里就有一句解释旧代码的注释，
      //   逐字写着「曾经直接 `INSERT INTO organizations`」——不剥注释会把"讲事故的
      //   历史记录"误判成"事故又发生了一次"，这条门控自己就红过一次。
      const sql = raw.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
      // 判据是「INSERT 语句里出现 'platform'」，不是「文件名含 platform」——
      // 后者会漏掉把种子悄悄塞进另一份不相干文件名的迁移里。
      for (const stmt of sql.split(/;/)) {
        if (/insert\s+into\s+organizations/i.test(stmt) && /'platform'/.test(stmt)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
