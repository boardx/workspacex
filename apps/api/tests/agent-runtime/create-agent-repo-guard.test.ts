/**
 * #617 —— `lint-permission-paths` 白名单条目
 * `src/infrastructure/agent/pg-create-agent-repository.ts` 的**守卫测试**。
 *
 * 与 `tests/agent-runtime/agent-skill-pins-repo-guard.test.ts` 同一形状、同一理由：
 * 那条白名单条目声称「授权已在 `create-agent.ts` 中、且在仓储调用之前发生」——
 * ⚠ 一条只是一句声明的白名单条目是「写下时为真、上游改动后为假」的标准形状，
 *   且没有任何东西会红。本文件把那句声明变成机械事实。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL(
  "../../src/infrastructure/agent/pg-create-agent-repository.ts",
  import.meta.url,
);
const USE_CASE = new URL(
  "../../src/application/agent/create-agent.ts",
  import.meta.url,
);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");

/** 本仓储**允许**命名的租户表。多一张就说明这个文件长出了新的读面。 */
const ALLOWED_TABLES = new Set(["agents", "agent_versions"]);
const graphStart = repoSource.indexOf("  async findForCapabilityGraph(");
const graphEnd = repoSource.indexOf("  async list(", graphStart);
const graphSource = repoSource.slice(graphStart, graphEnd);
const nonGraphSource = repoSource.slice(0, graphStart) + repoSource.slice(graphEnd);
const directorySource = readFileSync(new URL("../../src/infrastructure/agent/pg-agent-directory-repository.ts", import.meta.url), "utf8");
const pinSource = directorySource.slice(directorySource.indexOf("export async function readPublishedSkillPins("));

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
  it("只命名 agents 与当前发布版本元数据表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  it("新增版本读取只属于能力图；创建、克隆、列表与指令写路径仍只允许 agents", () => {
    expect(graphStart).toBeGreaterThan(-1);
    expect(graphEnd).toBeGreaterThan(graphStart);
    expect(tablesNamedIn(graphSource)).toEqual(new Set(["agents", "agent_versions"]));
    expect(tablesNamedIn(nonGraphSource)).toEqual(new Set(["agents"]));
  });

  it("能力图只选当前发布元数据，agent/version/org 三个关联均不可省略", () => {
    expect(graphSource).toContain("this.db.withTenant(toOrgId(orgId)");
    expect(graphSource).toContain("v.id=a.published_version_id AND v.agent_id=a.id AND v.org_id=a.org_id");
    expect(graphSource).toContain("WHERE a.id = $1 AND a.org_id = $2");
    expect(graphSource).toContain("[agentId, orgId]");
    const projection = /SELECT ([\s\S]*?)FROM agents/.exec(graphSource)?.[1];
    expect(projection?.replace(/\s+/g, " ").trim()).toBe("a.id, a.name, a.role_label, a.skill_mounts, a.tool_whitelist, v.id AS published_version_id, v.skill_version_ids, v.pending_skill_bindings");
  });

  it("共享 pin 查询只能回传已发布版本坐标，不增加内容、写入或租户绕过", () => {
    expect(pinSource).toContain("export async function readPublishedSkillPins(");
    expect(tablesNamedIn(pinSource)).toEqual(new Set(["skill_versions", "skills"]));
    const projection = /SELECT ([\s\S]*?)FROM skill_versions/.exec(pinSource)?.[1];
    expect(projection?.replace(/\s+/g, " ").trim()).toBe("sk.id AS skill_id, sv.id AS version_id");
    expect(pinSource).toContain("sk.id=sv.skill_id AND sk.org_id=sv.org_id");
    expect(pinSource).toContain("(sv.org_id=$1 OR sv.org_id=$3) AND sv.id=ANY($2::text[]) AND sv.published");
    expect(pinSource).toContain("[orgId, versions, PLATFORM_ORG_ID]");
    expect(pinSource).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|withoutTenant)\b/);
    expect(pinSource).not.toMatch(/sv\.(?:content|body|instructions)/);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("agents")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });
});

/**
 * #660 —— 本文件**新增**了第二个仓储类 `PgSetAgentInstructionsRepository`
 * （写 `agents.instructions`，候选 A）。它放在同一个文件里是刻意的：白名单条目按
 * 文件登记，而它要讲的理由与 `PgCreateAgentRepository` 那条逐字相同。
 * ⇒ 那条条目的前提从此**同时**覆盖两个类，所以这里补上第二个类的授权断言。
 */
describe("#660 白名单条目的前提：instructions 写路径的授权也在用例层、也在仓储调用之前", () => {
  const setInstructionsUseCase = readFileSync(
    new URL("../../src/application/agent/set-agent-instructions.ts", import.meta.url),
    "utf8",
  );

  it("用例层有 admin 组织成员判定", () => {
    expect(setInstructionsUseCase).toContain("findOrgMembership");
    expect(setInstructionsUseCase).toContain('orgRole !== "admin"');
    expect(setInstructionsUseCase).toContain('"ROLE_INSUFFICIENT"');
  });

  it("授权判定排在 deps.repository.setInstructions 调用之前", () => {
    const authAt = setInstructionsUseCase.indexOf("findOrgMembership");
    const writeAt = setInstructionsUseCase.indexOf("deps.repository.setInstructions(");
    expect(authAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(writeAt);
  });

  it("agent 不存在时不得静默成功——用例把 false 翻成 AGENT_NOT_FOUND", () => {
    expect(setInstructionsUseCase).toContain('SetAgentInstructionsError("AGENT_NOT_FOUND")');
  });
});

/**
 * #1915 —— 本文件**新增**了 `list()` 方法（`ListAgentsRepository`）。同样放在
 * `pg-create-agent-repository.ts` 而不是新文件：白名单条目按文件登记，
 * `lint-permission-paths.mjs` 那条条目的"#1915 listAgents ADDITION"段落
 * 就是这里断言的三件事的散文版本。
 */
describe("#1915 白名单条目的前提：listAgents 的授权也在用例层、也在仓储调用之前", () => {
  const listAgentsUseCase = readFileSync(
    new URL("../../src/application/agent/list-agents.ts", import.meta.url),
    "utf8",
  );

  it("用例层有 admin 组织成员判定", () => {
    expect(listAgentsUseCase).toContain("findOrgMembership");
    expect(listAgentsUseCase).toContain('orgRole !== "admin"');
    expect(listAgentsUseCase).toContain('"ROLE_INSUFFICIENT"');
  });

  it("授权判定排在 deps.repository.list 调用之前", () => {
    const authAt = listAgentsUseCase.indexOf("findOrgMembership");
    const listAt = listAgentsUseCase.indexOf("deps.repository.list(");
    expect(authAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(listAt);
  });

  /** 仓储侧 `list()` 只选契约 `AgentRow` 声明过的列，不多选 instructions/tool_whitelist。 */
  it("仓储的 list() 查询不选 instructions / tool_whitelist / clone_from", () => {
    const listMethod = repoSource.slice(repoSource.indexOf("async list("));
    const selectClause = listMethod.slice(0, listMethod.indexOf("FROM agents"));
    expect(selectClause).not.toMatch(/\binstructions\b/);
    expect(selectClause).not.toMatch(/\btool_whitelist\b/);
    expect(selectClause).not.toMatch(/\bclone_from\b/);
  });
});

describe("白名单条目的前提：授权确实存在，且在仓储调用之前", () => {
  it("用例层有 admin 组织成员判定", () => {
    expect(useCaseSource).toContain("findOrgMembership");
    expect(useCaseSource).toContain('orgRole !== "admin"');
    expect(useCaseSource).toContain('"ROLE_INSUFFICIENT"');
  });

  /**
   * ⚠ 位置断言：授权必须排在**两个仓储调用之前**——`newAgentId`/`findForClone`/`insert`
   *   三个都是。只断言「存在」不够：排在仓储调用之后的授权挡不住一个非 admin 用
   *   AGENT_NOT_FOUND 与 AGENT_MARKET_NOT_AVAILABLE 两种响应差异去探测组织内部信息。
   */
  it("授权判定排在 deps.repository.findForClone / .insert 调用之前", () => {
    const authAt = useCaseSource.indexOf("findOrgMembership");
    const findForCloneAt = useCaseSource.indexOf("deps.repository.findForClone(");
    const insertAt = useCaseSource.indexOf("deps.repository.insert(");
    expect(authAt).toBeGreaterThan(-1);
    expect(findForCloneAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(findForCloneAt);
    expect(authAt).toBeLessThan(insertAt);
  });
});


describe("能力图 principal-derived 组织边界", () => {
  it("入口先验证 principal，再仅以 principal.orgId 读取；不信任客户端组织参数", () => {
    const source = readFileSync(new URL("../../src/interface/controllers/agent.controller.ts", import.meta.url), "utf8");
    const start = source.indexOf("  async getCapabilityGraph(");
    const body = source.slice(start, source.indexOf("\n  }\n", start + 1) + 5);
    expect(start).toBeGreaterThan(-1);
    expect(body.indexOf("assertPrincipal(principal)")).toBeGreaterThan(-1);
    expect(body.indexOf("assertPrincipal(principal)")).toBeLessThan(body.indexOf("await getAgentCapabilityGraph("));
    expect(body).toContain("{ orgId: principal.orgId, agentId }");
    expect(body).not.toMatch(/@(?:Body|Query)\(/);
  });
});
