/**
 * #660 —— `lint-permission-paths` 白名单条目
 * `src/infrastructure/agent/pg-agent-publish-repository.ts` 的**守卫测试**。
 *
 * 与 `create-agent-repo-guard.test.ts` / `agent-skill-pins-repo-guard.test.ts`
 * 同一形状、同一理由：那条白名单条目声称「授权已在 `agent-publish.ts` 中、
 * 且在任何仓储调用之前发生」——
 * ⚠ 一条只是一句声明的白名单条目是「写下时为真、上游改动后为假」的标准形状，
 *   且没有任何东西会红。本文件把那句声明变成机械事实。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL(
  "../../src/infrastructure/agent/pg-agent-publish-repository.ts",
  import.meta.url,
);
const USE_CASE = new URL("../../src/application/agent/agent-publish.ts", import.meta.url);
const CONTROLLER = new URL(
  "../../src/interface/controllers/agent-publish.controller.ts",
  import.meta.url,
);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");
const controllerSource = readFileSync(CONTROLLER, "utf8");

/**
 * 本仓储**允许**命名的租户表。多一张就说明这个文件长出了新的读面。
 * · `agents` —— 调用者自己要改的那一行（判定 + UPDATE）
 * · `skill_reviewer_functions` —— **调用者本人**被指派的评审职能（按 principal_id 精确取一行）
 */
const ALLOWED_TABLES = new Set(["agents", "skill_reviewer_functions"]);

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("白名单条目的前提：仓储侧", () => {
  it("只命名允许的两张租户表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("agents")).toBe(true);
    expect(tablesNamedIn(repoSource).has("skill_reviewer_functions")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });

  /**
   * 评审职能只能按**调用者本人**取：查询里必须同时按 org_id 与 principal_id 约束。
   * 少了 principal_id 这一条，它就从「我是什么职能」变成「组织里都有谁是审核人」——
   * 那是一份人员名单，不再是「调用者自己的那一行」，白名单的理由随之失效。
   */
  it("skill_reviewer_functions 只按 (org_id, principal_id) 取调用者自己那一行", () => {
    expect(repoSource).toContain("WHERE org_id = $1 AND principal_id = $2");
  });
});

describe("白名单条目的前提：授权确实存在，且在仓储调用之前", () => {
  it("两个用例都以组织成员判定开场", () => {
    expect(useCaseSource).toContain("findOrgMembership");
    // 两处：submitAgentForReview 与 decideAgentPublish 各一次。
    expect(useCaseSource.match(/findOrgMembership/g)?.length).toBe(2);
  });

  /**
   * 顺序是理由的一部分，不是装饰：授权若排在仓储读之后，
   * 非成员就能靠「AGENT_NOT_FOUND 与 ROLE_INSUFFICIENT 不一样」探测组织内有没有某个 agent。
   */
  it("每个用例里，findOrgMembership 都排在第一次 repository 调用之前", () => {
    for (const fn of ["submitAgentForReview", "decideAgentPublish"]) {
      const start = useCaseSource.indexOf(`export async function ${fn}(`);
      expect(start, `${fn} 未找到`).toBeGreaterThan(-1);
      const body = useCaseSource.slice(start);
      const authz = body.indexOf("findOrgMembership");
      const firstRepoCall = body.indexOf("deps.repository.");
      expect(authz, `${fn}: 缺少 findOrgMembership`).toBeGreaterThan(-1);
      expect(firstRepoCall, `${fn}: 缺少 repository 调用`).toBeGreaterThan(-1);
      expect(authz, `${fn}: 授权必须在仓储调用之前`).toBeLessThan(firstRepoCall);
    }
  });
});

describe("白名单条目的前提：读回来的东西不会变成响应内容", () => {
  /**
   * 仓储读到的是整行 `agents`（含 name/role 等），但**出门的只有**契约 out 的那几个字段：
   * `publishState` / `securityScanPassed` / `elevationRequests` / `agentVersionId`——
   * 全是状态与计数，没有任何一列内容被透传。
   * ⛔ 若哪天 controller 直接 return 了仓储对象，这条会红。
   */
  it("controller 只回契约 out 解析过的结果，不透传仓储行", () => {
    expect(controllerSource).toContain("C.operations.submitAgentForReview.out.parse");
    expect(controllerSource).toContain("C.operations.decideAgentPublish.out.parse");
    // 仓储的读方法名不应出现在 controller 里——它只经用例拿结果。
    expect(controllerSource.includes("findForPublish")).toBe(false);
  });
});
