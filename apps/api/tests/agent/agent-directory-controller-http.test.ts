/**
 * AG04 —— `AgentDirectoryController` 的 HTTP 映射（review 指出：控制器 401/404 分支此前
 * 无任何测试覆盖）：`GET /agents/directory` 的 query 解析与 401 映射，
 * `GET /agents/directory/:agentId` 的 401/404 映射与契约出参解析。
 */
import { describe, expect, it } from "vitest";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { agentRole as R } from "@repo/contracts";
import { AgentDirectoryController } from "../../src/interface/controllers/agent-directory.controller";
import type { AgentDirectoryRepository, AgentDirectoryRow } from "../../src/application/agent/list-agent-directory";
import type { IdentityRepository } from "../../src/application/identity/ports";
import type { WorkflowDefinitionStore } from "../../src/application/agent-import/ports";
import { PgAgentDirectoryRepository } from "../../src/infrastructure/agent/pg-agent-directory-repository";
import { AGENT_ROLE_COLUMN_OF } from "../../src/infrastructure/agent/agent-version-insert";
import type { DatabasePort } from "../../src/application/ports/database.port";
import type { Principal } from "../../src/domain/principal";

const MEMBER = { userId: "u1", orgId: "org-1" } as unknown as Principal;

function row(): AgentDirectoryRow {
  return {
    agentId: "agent-1", versionId: "v-1", name: "研究员小艾", roleLabel: "研究专家",
    avatar: null, roleCategory: "research", tags: ["调研"], catalogSource: "official",
    workflowAllowlist: [], toolPolicyLength: 0,
    duty: null, roleRef: null, skillMountIds: [], skillVersionIds: [], delegationTargetRefs: [], requireApprovalForHandoff: true,
  };
}

function setup(opts: { authed?: boolean; found?: AgentDirectoryRow | null } = {}) {
  const identities: IdentityRepository = {
    findOrgMembership: async () => (opts.authed === false ? null : ({ orgRole: "member" } as never)),
  } as unknown as IdentityRepository;
  const repository: AgentDirectoryRepository = {
    listVisible: async () => [row()],
    findVisible: async () => (opts.found === undefined ? row() : opts.found),
  };
  const workflows = { resolveName: async () => null } as unknown as WorkflowDefinitionStore;
  return new AgentDirectoryController(identities, repository, workflows);
}

describe("AG04 AgentDirectoryController HTTP mapping", () => {
  it("list: 认证成员 → 200 契约形状", async () => {
    const controller = setup();
    const out = await controller.list(MEMBER, undefined, undefined);
    expect(R.operations.listAgentDirectory.out.parse(out).items).toHaveLength(1);
  });

  it("a legacy nullable label cannot break the directory or hide an official role", async () => {
    const roleColumns = Object.fromEntries(Object.entries(AGENT_ROLE_COLUMN_OF).map(([field, column]) =>
      [column, R.AGENT_ROLE_FIELD_DEFAULTS[field as keyof typeof R.AGENT_ROLE_FIELD_DEFAULTS]]));
    const legacy = {
      ...roleColumns, agent_id: "legacy", version_id: "legacy-v", name: "Legacy Agent", role_label: null,
      tool_policy: [], duty: null, abbr: null, skill_mounts: [], skill_version_ids: [],
    };
    const official = {
      ...legacy, agent_id: "official", version_id: "official-v", name: "产品经理", role_label: "产品经理",
      role_category: "product", catalog_source: "official", abbr: "D003", duty: "分析需求和撰写 PRD",
    };
    const rows = [legacy, official];
    const database: DatabasePort = {
      withTenant: async (_orgId, fn) => fn({
        query: async <T>(_sql: string, params?: readonly unknown[]) => ({
          rows: (params?.[1] ? rows.filter(row => row.agent_id === params[1]) : rows) as unknown as T[],
        }),
      }),
      withoutTenant: async () => { throw new Error("directory must use tenant context"); },
      close: async () => {},
    };
    const identity = { findOrgMembership: async () => ({ orgRole: "member" }) } as unknown as IdentityRepository;
    const workflows = { resolveName: async () => null } as unknown as WorkflowDefinitionStore;
    const controller = new AgentDirectoryController(identity, new PgAgentDirectoryRepository(database), workflows);
    const list = R.operations.listAgentDirectory.out.parse(await controller.list(MEMBER, undefined, undefined));
    expect(list.items).toHaveLength(2);
    expect(list.items.find(item => item.agentId === "legacy")?.roleLabel).toBe("");
    expect(list.items.find(item => item.agentId === "official")?.roleLabel).toBe("产品经理");
    const legacyCard = await controller.getOne(MEMBER, "legacy");
    expect(legacyCard.roleLabel).toBe("");
    await expect(controller.getProfile(MEMBER, "legacy")).resolves.toMatchObject({ agentId: "legacy" });
    await expect(controller.getProfile(MEMBER, "official")).resolves.toMatchObject({ agentId: "official", duty: "分析需求和撰写 PRD" });
  });

  it("list: 未认证 → 401", async () => {
    const controller = setup({ authed: false });
    await expect(controller.list(MEMBER, undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("list: 空字符串 query 视为未传", async () => {
    const controller = setup();
    const out = await controller.list(MEMBER, "", "");
    expect(R.operations.listAgentDirectory.out.parse(out).items).toHaveLength(1);
  });

  it("getOne: 可见 → 200 契约形状", async () => {
    const controller = setup();
    const out = await controller.getOne(MEMBER, "agent-1");
    expect(R.operations.getAgentDirectoryCard.out.parse(out).agentId).toBe("agent-1");
  });

  it("getOne: 未认证 → 401", async () => {
    const controller = setup({ authed: false });
    await expect(controller.getOne(MEMBER, "agent-1")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("getOne: 不存在 → 404", async () => {
    const controller = setup({ found: null });
    await expect(controller.getOne(MEMBER, "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AG04 follow-up getProfile HTTP mapping", () => {
  it("可见 → 200 契约形状；未认证 → 401；不存在 → 404", async () => {
    const out = await setup().getProfile(MEMBER, "agent-1");
    expect(R.operations.getAgentDirectoryProfile.out.parse(out).agentId).toBe("agent-1");
    await expect(setup({ authed: false }).getProfile(MEMBER, "agent-1")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(setup({ found: null }).getProfile(MEMBER, "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});

it("profile resolves an old published pin to its exact catalog skill ID with tenant/platform bounds", async () => {
  const roleColumns = Object.fromEntries(Object.entries(AGENT_ROLE_COLUMN_OF).map(([field, column]) =>
    [column, R.AGENT_ROLE_FIELD_DEFAULTS[field as keyof typeof R.AGENT_ROLE_FIELD_DEFAULTS]]));
  const sqlCalls: { sql: string; params?: readonly unknown[] }[] = [];
  const database: DatabasePort = {
    withTenant: async (_orgId, fn) => fn({ query: async <T>(sql: string, params?: readonly unknown[]) => {
      sqlCalls.push({ sql, params });
      return { rows: (sql.includes("FROM skill_versions")
        ? [{ skill_id: "catalog-skill", version_id: "old-version" }]
        : [{ ...roleColumns, agent_id: "agent-1", version_id: "agent-v1", name: "角色", role_label: "角色", tool_policy: [], duty: null, abbr: null, skill_mounts: [], skill_version_ids: ["old-version"] }]) as unknown as T[] };
    } }),
    withoutTenant: async () => { throw new Error("tenant context required"); }, close: async () => {},
  };
  const repository = new PgAgentDirectoryRepository(database);
  const controller = new AgentDirectoryController({ findOrgMembership: async () => ({ orgRole: "member" }) } as unknown as IdentityRepository, repository, { resolveName: async () => null } as unknown as WorkflowDefinitionStore);
  expect(await controller.getProfile(MEMBER, "agent-1")).toMatchObject({ pinnedSkills: [{ skillId: "catalog-skill", versionId: "old-version" }] });
  const lookup = sqlCalls.find(call => call.sql.includes("FROM skill_versions"));
  expect(lookup?.params).toEqual(["org-1", ["old-version"], "org-platform"]);
  expect(lookup?.sql).toContain("sv.published");
  expect(lookup?.sql).toContain("sk.org_id=sv.org_id");
});
