/**
 * `pg-feedback-github-issue-scanner.ts` 的载荷测试(纯静态解析,不需要 Postgres)。
 *
 * PR #2580 独立复核阻断项①之后，这个文件不再直接 `SELECT ... FROM product_feedback`
 * ——那条路径包在 `withoutTenant` 里会被 RLS 悄悄清空成零行（真正的反证见
 * `tests/feedback/github-issue-poll-real-postgres.test.ts`，在真实 Postgres 上证明
 * 跨组织真的能读到候选、且返回的行里没有 `detail`）。这里只断言两条**结构性**前提，
 * 防止有人为了图方便又改回直接查表：
 *
 *   1. 本文件从不出现 `FROM product_feedback` / `JOIN product_feedback`——唯一合法
 *      的读法是调用 `kernel_read_open_feedback_with_github_issue()`。
 *   2. 本文件从不出现 `detail` 字面量——即使那个 SECURITY DEFINER 函数以后被改坏、
 *      多返回了一列，这个文件本身也不该有任何代码路径去读它。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(
  new URL("../../src/infrastructure/feedback/pg-feedback-github-issue-scanner.ts", import.meta.url),
);

describe("pg-feedback-github-issue-scanner.ts 的读路径", () => {
  const body = readFileSync(SRC, "utf8");
  const code = body
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

  it("从不直接命名 product_feedback 表，只调用 SECURITY DEFINER 函数", () => {
    expect(code).not.toMatch(/\bproduct_feedback\b/);
    expect(code).toMatch(/FROM kernel_read_open_feedback_with_github_issue\(\)/);
  });

  it("从不出现 detail 字面量", () => {
    expect(code).not.toMatch(/\bdetail\b/);
  });
});
