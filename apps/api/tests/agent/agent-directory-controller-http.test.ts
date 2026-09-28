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
import type { Principal } from "../../src/domain/principal";

const MEMBER = { userId: "u1", orgId: "org-1" } as unknown as Principal;

function row(): AgentDirectoryRow {
  return {
    agentId: "agent-1", versionId: "v-1", name: "研究员小艾", roleLabel: "研究专家",
    avatar: null, roleCategory: "research", catalogSource: "official",
    workflowAllowlist: [], toolPolicyLength: 0,
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
