import { describe, expect, it } from "vitest";
import {
  analyzeContractRewriteCoverage,
  extractContractRoutes,
  rewriteSourceToRegExp,
} from "./contract-rewrite-coverage.ts";

const API = "http://127.0.0.1:65535";
const proxy = (source: string) => ({ source, destination: `${API}${source}` });

const WORKFLOW_CONTRACT = `
  export const ops = {
    list: { method: "GET", path: "/workflow-instances" },
    get: { method: "GET", path: "/workflow-instances/:instanceId" },
    start: { method: "POST", path: "/workflows/:key/instances" },
    approvals: { method: "GET", path: "/workflow-approvals" },
    runnable: { method: "GET", path: "/agents/:agentId/runnable-workflows" },
  };
  ctx.addIssue({ path: ["stages"], message: "not a route" });
`;

describe("extractContractRoutes", () => {
  it("抽出 path 字面量，跳过数组与插值", () => {
    const routes = extractContractRoutes(WORKFLOW_CONTRACT + "x = { path: `/a/${b}` }", "wf.ts").map((r) => r.path);
    expect(routes).toEqual([
      "/workflow-instances",
      "/workflow-instances/:instanceId",
      "/workflows/:key/instances",
      "/workflow-approvals",
      "/agents/:agentId/runnable-workflows",
    ]);
  });
});

describe("rewriteSourceToRegExp", () => {
  it(":path* 匹配零到多段，:param 恰好一段", () => {
    expect(rewriteSourceToRegExp("/agents/:path*").test("/agents")).toBe(true);
    expect(rewriteSourceToRegExp("/agents/:path*").test("/agents/x/y")).toBe(true);
    expect(rewriteSourceToRegExp("/workflows/:key/instances").test("/workflows/x/instances")).toBe(true);
    expect(rewriteSourceToRegExp("/workflows/:key/instances").test("/workflows/runs/x")).toBe(false);
    expect(rewriteSourceToRegExp("/admin/skills/:path*").test("/admin/nav")).toBe(false);
  });
});

describe("analyzeContractRewriteCoverage", () => {
  const contracts = [{ file: "workflow-runtime.ts", source: WORKFLOW_CONTRACT }];

  it("反证：只有 /agents 规则时，workflow-runtime 整族判为缺口（2026-09-29 真实形态）", () => {
    const r = analyzeContractRewriteCoverage({
      contracts,
      rewrites: [proxy("/agents"), proxy("/agents/:path*")],
      allowlist: [],
    });
    expect(r.incomplete).toBe(false);
    expect(r.gaps.map((g) => g.path)).toEqual([
      "/workflow-instances",
      "/workflow-instances/:instanceId",
      "/workflows/:key/instances",
      "/workflow-approvals",
    ]);
  });

  it("补齐后无缺口；指回内部页面的放行规则与带条件的规则不算覆盖", () => {
    const full = [
      proxy("/agents/:path*"),
      proxy("/workflow-instances"),
      proxy("/workflow-instances/:path*"),
      proxy("/workflow-approvals"),
      proxy("/workflows/:key/instances"),
    ];
    expect(analyzeContractRewriteCoverage({ contracts, rewrites: full, allowlist: [] }).gaps).toEqual([]);
    const internal = analyzeContractRewriteCoverage({
      contracts,
      rewrites: [...full.slice(0, 4), { source: "/workflows/:key/instances", destination: "/workflows/:key/instances" }],
      allowlist: [],
    });
    expect(internal.gaps.map((g) => g.path)).toEqual(["/workflows/:key/instances"]);
  });

  it("棘轮名单按首段豁免", () => {
    const r = analyzeContractRewriteCoverage({
      contracts,
      rewrites: [proxy("/agents/:path*")],
      allowlist: ["workflow-instances", "workflows", "workflow-approvals"],
    });
    expect(r.gaps).toEqual([]);
  });

  it("扫不全就不判（0 条契约路由 / 0 条代理规则）", () => {
    expect(analyzeContractRewriteCoverage({ contracts: [], rewrites: [proxy("/a")], allowlist: [] }).incomplete).toBe(true);
    expect(analyzeContractRewriteCoverage({ contracts, rewrites: [], allowlist: [] }).incomplete).toBe(true);
  });
});
