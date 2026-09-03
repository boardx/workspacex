import { describe, expect, it } from "vitest";
import { ISSUE_PAGE_LIMIT, describeIssueListFailure, listAllIssues } from "./github-issues";
import type { ShResult } from "./sh";

const fakeGh = (code: number, stdout: string, stderr = ""): ((cmd: string) => ShResult) => () => ({ code, stdout, stderr });
const rows = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `t${i + 1}`, body: "", state: "OPEN" })));

describe("listAllIssues (#2483：doctor 与 sync 共用的全量 issue 清单)", () => {
  it("请求远高于现实规模的上限，且带 --repo / --state all / 三方共用的字段集", () => {
    let seen = "";
    listAllIssues({ repo: "acme/x", exec: (cmd) => { seen = cmd; return { code: 0, stdout: "[]", stderr: "" }; } });
    expect(seen).toContain(`--limit ${ISSUE_PAGE_LIMIT}`);
    expect(seen).toContain('--repo "acme/x"');
    expect(seen).toContain("--state all");
    for (const field of ["number", "title", "body", "state", "stateReason", "closedAt", "labels"]) expect(seen).toContain(field);
    expect(ISSUE_PAGE_LIMIT).toBeGreaterThan(500); // sync 停留了一个月的旧上限
  });

  it("清单完整 → ok", () => {
    const r = listAllIssues({ exec: fakeGh(0, rows(3)) });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.issues.map((i) => i.number)).toEqual([1, 2, 3]);
  });

  it("触顶 → truncated，不是「返回前 N 条」（空数组会被当成『确实没有』）", () => {
    const r = listAllIssues({ exec: fakeGh(0, rows(7)), limit: 7 });
    expect(r).toEqual({ kind: "truncated", count: 7, limit: 7 });
  });

  it("gh 失败 / 输出不是 JSON / 不是数组 → unavailable，带原因", () => {
    expect(listAllIssues({ exec: fakeGh(1, "", "gh: not logged in") })).toMatchObject({ kind: "unavailable" });
    expect(listAllIssues({ exec: fakeGh(0, "not json") })).toMatchObject({ kind: "unavailable" });
    expect(listAllIssues({ exec: fakeGh(0, '{"a":1}') })).toMatchObject({ kind: "unavailable" });
    const r = listAllIssues({ exec: fakeGh(1, "", "gh: not logged in") });
    if (r.kind === "unavailable") expect(r.reason).toContain("not logged in");
  });

  it("describeIssueListFailure 两种失败各一句人话", () => {
    expect(describeIssueListFailure({ kind: "truncated", count: 5000, limit: 5000 })).toContain("可能被截断");
    expect(describeIssueListFailure({ kind: "unavailable", reason: "离线" })).toContain("离线");
  });
});
