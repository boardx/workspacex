/**
 * `lint-permission-paths` 对 `pg-skill-trial-run-store.ts` 的豁免**不是一句声明，
 * 是这个文件在守**。形态照抄 `tests/auth/registration-repo-is-write-only.test.ts`：
 * 那条豁免也附了一个解析源码的测试，且脚本头注明确写着
 * 「If that test is ever deleted, this entry must go with it.」——本条同理。
 *
 * ## 豁免的论证（与 allowlist 里那条逐字一致）
 *
 * `Guarded<T>` 保护的是**披露**：让人无法在没有权限判定的情况下把租户内容交给请求方。
 * `skill_trial_runs` 背后**没有 ACL 对象**——一次试跑不是 Artifact / Segment / Capability，
 * 没有可以据以判定的 scope。它的披露规则只有一条：**只有提交者本人能读自己那一行**，
 * 而这条规则是用 SQL 谓词 `actor_id = $3` 表达的。
 *
 * ⚠ 为了过 linter 而给它编一个 `ObjectRef` 种类会**更糟**：那等于断言存在一套并不存在的
 *   权限模型，下一个人会照着它去接 ACL，然后发现接不上。
 *
 * ## 那这个测试守什么
 *
 * 守住豁免的前提本身。本文件里对 `skill_trial_runs` 的每一条读，必须落在两类之一：
 *
 * ① **面向请求方的读** ⇒ 谓词里必须有 `actor_id`（否则就是越权披露）；
 * ② **系统侧认领**（`claimQueued`）⇒ 没有请求方，行是交给执行器的，不披露给任何人。
 *
 * 任何新增的、既不带 `actor_id` 又不是认领的读，都会让本测试变红 —— 那正是豁免
 * 不再成立的时刻。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "src",
  "infrastructure",
  "skill",
  "pg-skill-trial-run-store.ts",
);

/** 系统侧认领：唯一允许不带 `actor_id` 的读，因为它没有请求方。 */
const CLAIM_MARKER = "FOR UPDATE SKIP LOCKED";

describe("试跑仓储的豁免前提：读要么按提交者收窄，要么是系统侧认领", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  /** 抽出所有 SQL 字符串字面量（反引号模板）。 */
  const statements = [...source.matchAll(/`([^`]*(?:SELECT|UPDATE|INSERT)[^`]*)`/gi)].map(
    (m) => m[1]!,
  );

  it("actually found the SQL in the file — otherwise this test would pass vacuously", () => {
    // ⚠ 自检。没有它，一次重命名/重构就能让本测试变成永远绿的空转
    //   （`lint-arch-deps` 自己栽过的「目录不存在就 skipped 并 exit 0」同一形状）。
    expect(statements.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain("skill_trial_runs");
  });

  it("every SELECT against skill_trial_runs is scoped to the submitting actor", () => {
    const offenders = statements.filter((sql) => {
      const isSelect = /\bSELECT\b/i.test(sql) && /\bFROM\s+skill_trial_runs\b/i.test(sql);
      if (!isSelect) return false;
      // 认领语句里的 SELECT 是子查询，属于第 ② 类。
      if (sql.includes(CLAIM_MARKER)) return false;
      return !/\bactor_id\s*=\s*\$/i.test(sql);
    });
    expect(offenders, `unscoped reads:\n${offenders.join("\n---\n")}`).toEqual([]);
  });

  it("every statement is tenant-scoped by org_id as the second line of defence behind RLS", () => {
    const offenders = statements.filter((sql) => {
      if (!/skill_trial_runs/i.test(sql)) return false;
      // INSERT 用 VALUES 带 org_id，不走 WHERE。
      if (/\bINSERT\s+INTO\b/i.test(sql)) return !/org_id/i.test(sql);
      return !/\borg_id\s*=\s*\$/i.test(sql);
    });
    expect(offenders, `statements missing org scoping:\n${offenders.join("\n---\n")}`).toEqual([]);
  });

  it("has no DELETE path — the migration grants no DELETE either", () => {
    // 表级不可变性由 GRANT 保证；这里守住应用侧也没有偷偷写一条。
    expect(/\bDELETE\s+FROM\s+skill_trial_runs\b/i.test(source)).toBe(false);
  });
});
