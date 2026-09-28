/**
 * AG01 —— `AgentRoleController`（PATCH /admin/agents/:agentId/role）的 HTTP 映射：
 * 用例错误码 → 状态码（403/404/409/422）、路径与 body 的 agentId 不一致 → 422、
 * 无 principal 不进用例。契约 err 列表逐项被覆盖；删掉映射任何一支这里都会红。
 */
import { describe, expect, it } from "vitest";
import {
  ConflictException, ForbiddenException, HttpException, NotFoundException, UnprocessableEntityException,
} from "@nestjs/common";
import { agentRole as R } from "@repo/contracts";
import { AgentRoleController } from "../../src/interface/controllers/agent-role.controller";
import type { AgentRoleDraftRepository, AgentRoleDraftState } from "../../src/application/agent/update-agent-role-draft";
import type { IdentityRepository } from "../../src/application/identity/ports";
import type { Principal } from "../../src/domain/principal";

const ORG = "org-1";
const ADMIN = { userId: "u-admin", orgId: ORG } as unknown as Principal;
const MEMBER = { userId: "u-member", orgId: ORG } as unknown as Principal;

function setup(opts: { state?: AgentRoleDraftState | null; saveResult?: { version: number } | null } = {}) {
  const calls = { find: 0, save: 0 };
  const identities = {
    findOrgMembership: async (userId: string) =>
      ({ orgRole: userId === "u-admin" ? "admin" : "member" }),
  } as unknown as IdentityRepository;
  const state: AgentRoleDraftState | null = opts.state === undefined
    ? { draft: structuredClone(R.AGENT_ROLE_FIELD_DEFAULTS), published: null, version: 0 }
    : opts.state;
  const repository: AgentRoleDraftRepository = {
    async find() { calls.find++; return state; },
    async save() { calls.save++; return opts.saveResult === undefined ? { version: 1 } : opts.saveResult; },
  };
  return { controller: new AgentRoleController(identities, repository), calls };
}

const body = (over: Record<string, unknown> = {}) =>
  ({ agentId: "agent-1", expectedVersion: 0, patch: { roleCategory: "research" }, ...over }) as never;

async function statusOf(p: Promise<unknown>): Promise<{ status: number; reasonCode: unknown }> {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const h = e as HttpException;
    return { status: h.getStatus(), reasonCode: (h.getResponse() as { reasonCode?: unknown }).reasonCode };
  }
  throw new Error("expected rejection");
}

describe("AG01 AgentRoleController HTTP mapping", () => {
  it("admin + valid patch → 200 with contract-shaped view", async () => {
    const { controller, calls } = setup();
    const out = await controller.updateRoleDraft(ADMIN, "agent-1", body());
    expect(R.operations.updateAgentRoleDraft.out.parse(out)).toMatchObject({ version: 1, editable: true });
    expect(calls).toEqual({ find: 1, save: 1 });
  });

  it("non-admin → 403 ROLE_INSUFFICIENT, repository untouched", async () => {
    const { controller, calls } = setup();
    const r = await statusOf(controller.updateRoleDraft(MEMBER, "agent-1", body()));
    expect(r).toEqual({ status: 403, reasonCode: "ROLE_INSUFFICIENT" });
    expect(calls).toEqual({ find: 0, save: 0 });
  });

  it("official agent → 403 OFFICIAL_ROLE_FIELDS_LOCKED", async () => {
    const { controller } = setup({
      state: { draft: { ...structuredClone(R.AGENT_ROLE_FIELD_DEFAULTS), catalogSource: "official" }, published: null, version: 0 },
    });
    await expect(statusOf(controller.updateRoleDraft(ADMIN, "agent-1", body())))
      .resolves.toEqual({ status: 403, reasonCode: "OFFICIAL_ROLE_FIELDS_LOCKED" });
    const e = await controller.updateRoleDraft(ADMIN, "agent-1", body()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
  });

  it("unknown agent → 404 AGENT_NOT_FOUND", async () => {
    const { controller } = setup({ state: null });
    const e = await controller.updateRoleDraft(ADMIN, "agent-1", body()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NotFoundException);
    expect((e as HttpException).getResponse()).toMatchObject({ reasonCode: "AGENT_NOT_FOUND" });
  });

  it("stale expectedVersion → 409 VERSION_CHANGED (use-case check and conditional write)", async () => {
    const stale = setup();
    const e1 = await stale.controller.updateRoleDraft(ADMIN, "agent-1", body({ expectedVersion: 3 })).catch((x: unknown) => x);
    expect(e1).toBeInstanceOf(ConflictException);
    expect((e1 as HttpException).getResponse()).toMatchObject({ reasonCode: "VERSION_CHANGED" });
    const raced = setup({ saveResult: null });
    const e2 = await raced.controller.updateRoleDraft(ADMIN, "agent-1", body()).catch((x: unknown) => x);
    expect(e2).toBeInstanceOf(ConflictException);
  });

  it("contract-invalid merge → 422 VALIDATION_FAILED", async () => {
    const { controller, calls } = setup();
    const e = await controller.updateRoleDraft(ADMIN, "agent-1",
      body({ patch: { delegationPolicy: { allowedTargets: [], maxDepth: 5, requireApproval: true } } }))
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect((e as HttpException).getResponse()).toMatchObject({ reasonCode: "VALIDATION_FAILED" });
    expect(calls.save).toBe(0);
  });

  it("path agentId ≠ body agentId → 422 before any read", async () => {
    const { controller, calls } = setup();
    await expect(statusOf(controller.updateRoleDraft(ADMIN, "agent-OTHER", body())))
      .resolves.toEqual({ status: 422, reasonCode: "VALIDATION_FAILED" });
    expect(calls).toEqual({ find: 0, save: 0 });
  });

  it("no principal (auth layer bypassed) → rejected before the use case runs", async () => {
    const { controller, calls } = setup();
    await expect(controller.updateRoleDraft(null as unknown as Principal, "agent-1", body())).rejects.toThrow();
    expect(calls).toEqual({ find: 0, save: 0 });
  });

  it("route requires authentication: controller is not marked public", () => {
    const keys = Reflect.getMetadataKeys(AgentRoleController.prototype.updateRoleDraft) as unknown[];
    expect(keys.map(String).some((k) => /public/i.test(k))).toBe(false);
  });
});
