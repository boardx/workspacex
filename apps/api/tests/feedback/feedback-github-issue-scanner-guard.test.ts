/**
 * 豁免的载荷：`lint-permission-paths.mjs` 的白名单条目
 * （`src/infrastructure/feedback/pg-feedback-github-issue-scanner.ts`）建立在
 * 「这个文件只碰 `product_feedback` 一张租户表、且从不选 `detail` 正文列」上——
 * 本文件纯静态解析源码，不需要 Postgres，可本地跑（同
 * `temp-grant-pg-repo-guard.test.ts` 那条载荷测试的写法）。见该 allowlist 条目
 * 本身的文字：这个扫描器服务的是一个没有"请求方"的系统级后台 tick，
 * `guard()`/`disclose()` 要求的判定因此不适用，真正收窄披露面的是查询本身
 * 只选五个全组织可见的字段、从不碰 `detail`。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(
  new URL("../../src/infrastructure/feedback/pg-feedback-github-issue-scanner.ts", import.meta.url),
);

describe("豁免的前提：pg-feedback-github-issue-scanner.ts 只碰 product_feedback 一张租户表", () => {
  const body = readFileSync(SRC, "utf8");
  const code = body
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

  it("全部 FROM/JOIN/INTO/UPDATE 语句只命名 product_feedback", () => {
    // 非空转：文件确实被读到了，且它确实在读这张表。
    expect(code).toMatch(/FROM product_feedback/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(refs.length, "一条表引用都没扫到——本断言在空转").toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["product_feedback"]));
  });

  it("SELECT 恒是那五个全组织可见字段，从不出现 detail 正文列", () => {
    expect(code).not.toMatch(/\bdetail\b/);
    expect(code).toMatch(/SELECT id, org_id, submitted_by, title, github_issue_number/);
  });
});
