/**
 * fetchClosingPrs 的翻页纯测（独立审 #2541 五轮意见 1）：注入 exec，不起 gh、不跑整个 doctor。
 * 行为测（PR 落在第二页 → doctor 照样报）在 doctor-pr-green.test.ts；这里补的是翻页协议本身：
 * 第一页不带 after、后续页带 endCursor、hasNextPage 为假才停、无限翻页有上限、缺 pageInfo 不放行。
 */
import { describe, expect, it } from "vitest";
import { fetchClosingPrs } from "./doctor";

type Page = { nodes: object[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } };
const wrap = (p: Page) => JSON.stringify({ data: { repository: { issue: { closedByPullRequestsReferences: p } } } });
const node = (number: number) => ({ number, merged: false, mergedAt: null, headRefOid: "e".repeat(40) });

function fakeExec(pages: Record<string, Page | "fail">) {
  const seen: string[] = [];
  const exec = (cmd: string) => {
    seen.push(cmd);
    if (!cmd.includes("api graphql")) return { code: 0, stdout: "" };
    const m = /-f c="([^"]*)"/.exec(cmd);
    const key = m ? m[1]! : "";
    const p = pages[key];
    if (p === undefined || p === "fail") return { code: 1, stdout: "gh: HTTP 502" };
    return { code: 0, stdout: wrap(p) };
  };
  return { exec, seen };
}

describe("fetchClosingPrs 翻页协议", () => {
  it("查询串用单引号交给 bash——双引号会把 $o/$r/$n 展开成空串，gh 报 Expected VAR_SIGN（2026-09-05 实测）", () => {
    const { exec, seen } = fakeExec({ "": { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    fetchClosingPrs("acme/x", 7, exec);
    const gql = seen.find((c) => c.includes("api graphql"))!;
    expect(gql).toMatch(/-f query='query\(\$o:String!/);
    expect(gql).not.toMatch(/-f query="/);
  });
  it("三页翻到底：第一页不带 after，后续用上一页的 endCursor，节点按序拼起来", () => {
    const { exec, seen } = fakeExec({
      "": { nodes: [node(1), node(2)], pageInfo: { hasNextPage: true, endCursor: "C1" } },
      C1: { nodes: [node(3)], pageInfo: { hasNextPage: true, endCursor: "C2" } },
      C2: { nodes: [node(4)], pageInfo: { hasNextPage: false, endCursor: null } },
    });
    const prs = fetchClosingPrs("acme/x", 7, exec);
    expect(prs?.map((p) => p.number)).toEqual([1, 2, 3, 4]);
    const gql = seen.filter((c) => c.includes("api graphql"));
    expect(gql).toHaveLength(3);
    expect(gql[0]).not.toContain("after:");
    expect(gql[1]).toContain("after:$c");
    expect(gql[1]).toContain('-f c="C1"');
    expect(gql[2]).toContain('-f c="C2"');
    for (const c of gql) expect(c).toContain("pageInfo{hasNextPage endCursor}");
  });

  it("hasNextPage 为真但下一页失败 → null（半份清单不放行）", () => {
    const { exec } = fakeExec({ "": { nodes: [node(1)], pageInfo: { hasNextPage: true, endCursor: "C1" } }, C1: "fail" });
    expect(fetchClosingPrs("acme/x", 7, exec)).toBeNull();
  });

  it("hasNextPage 为真却没有 endCursor / 回包缺 pageInfo → null", () => {
    expect(fetchClosingPrs("acme/x", 7, fakeExec({ "": { nodes: [node(1)], pageInfo: { hasNextPage: true, endCursor: null } } }).exec)).toBeNull();
    expect(fetchClosingPrs("acme/x", 7, fakeExec({ "": { nodes: [node(1)] } }).exec)).toBeNull();
  });

  it("永远 hasNextPage（坏数据 / 游标不前进）→ 有上限，返回 null 而不是死循环", () => {
    const { exec, seen } = fakeExec({ "": { nodes: [node(1)], pageInfo: { hasNextPage: true, endCursor: "LOOP" } }, LOOP: { nodes: [node(2)], pageInfo: { hasNextPage: true, endCursor: "LOOP" } } });
    expect(fetchClosingPrs("acme/x", 7, exec)).toBeNull();
    expect(seen.filter((c) => c.includes("api graphql")).length).toBeLessThanOrEqual(20);
  });
});
