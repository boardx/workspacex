/**
 * B3-T4（issue #4498）—— `adoptProjectDecision` 用例的 DB-free 单测：identity 假仓储 + 假晋升端口；判定走真实 `authorize`。
 *
 * 钉住（应用层自己的判定，数据库函数另有一份同规则复核，见 adopt-project-decision.test.ts）：
 *   · 非项目成员 KG_NOT_VISIBLE（哪怕是组织成员）——什么都不写；
 *   · 观察者 KG_NOT_OWNER——什么都不写；
 *   · 来源 contested ⇒ KG_CONTESTED_NEEDS_RESOLUTION；不在项目记忆里 / 不是 fact·hypothesis ⇒ KG_CLAIM_NOT_FOUND；
 *   · 理由空白 / 超长 ⇒ KG_INVALID_REQUEST（接口层 zod 先拦，这里是第二道）；
 *   · 成员 + fact ⇒ 端口收到 trim 过的理由与新 action id，返回 decisionClaimId / actionId。
 */
import { describe, expect, it } from "vitest";
import { adoptProjectDecision } from "../../src/application/knowledge-graph/adopt-project-decision";
import type { PromotionPort } from "../../src/application/knowledge-graph/ports";
import type { PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
import { FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-b3-t4");
const PROJECT = "p-b3-t4";

type Source = { id: string; kind: "fact" | "hypothesis" | "decision" | "todo"; status: string };
const SOURCES: Record<string, Source> = {
  "c-fact": { id: "c-fact", kind: "fact", status: "accepted" },
  "c-hyp": { id: "c-hyp", kind: "hypothesis", status: "proposed" },
  "c-contested": { id: "c-contested", kind: "fact", status: "contested" },
  "c-decision": { id: "c-decision", kind: "decision", status: "accepted" },
  "c-todo": { id: "c-todo", kind: "todo", status: "accepted" },
};

function fakeDeps(members: ConstructorParameters<typeof FakeRoleViewRepository>[0]) {
  const calls: unknown[] = [];
  const promotion = {
    adoptionSource: async (_o: unknown, _u: unknown, projectId: string, claimId: string) =>
      guard({ kind: "project", id: projectId }, SOURCES[claimId] ?? null),
    adoptProjectDecision: async (_o: unknown, _u: unknown, input: unknown) => {
      calls.push(input);
      return { decisionClaimId: "act-1-g", actionId: "act-1" };
    },
  } as unknown as PromotionPort;
  const deps: PromotionDeps = {
    repo: new FakeRoleViewRepository(members), ids: { next: () => "dec" } as never, chat: {} as never, knowledge: {} as never,
    promotion, newId: () => "act-1",
  };
  return { deps, calls };
}

const run = (deps: PromotionDeps, userId: string, claimId: string, rationale = " 两轮访谈都指向它 ") =>
  adoptProjectDecision(deps, { userId, orgId: ORG, projectId: PROJECT, claimId, rationale });

describe("adoptProjectDecision（用例层）", () => {
  it("组织成员但非项目成员 ⇒ KG_NOT_VISIBLE；不在组织里也是 KG_NOT_VISIBLE；端口没被调", async () => {
    const a = fakeDeps({ u1: { orgRole: "consultant", projectRole: null } });
    await expect(run(a.deps, "u1", "c-fact")).rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    const b = fakeDeps({});
    await expect(run(b.deps, "stranger", "c-fact")).rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual([]);
  });

  it("观察者 ⇒ KG_NOT_OWNER；端口没被调", async () => {
    const { deps, calls } = fakeDeps({ u1: { orgRole: "consultant", projectRole: "observer", groupId: null } });
    await expect(run(deps, "u1", "c-fact")).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    expect(calls).toEqual([]);
  });

  it("来源 contested ⇒ KG_CONTESTED_NEEDS_RESOLUTION；不在项目记忆里 / decision / todo ⇒ KG_CLAIM_NOT_FOUND", async () => {
    const { deps, calls } = fakeDeps({ u1: { orgRole: "consultant", projectRole: "member", groupId: null } });
    await expect(run(deps, "u1", "c-contested")).rejects.toMatchObject({ code: "KG_CONTESTED_NEEDS_RESOLUTION" });
    await expect(run(deps, "u1", "c-missing")).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
    await expect(run(deps, "u1", "c-decision")).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
    await expect(run(deps, "u1", "c-todo")).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
    expect(calls).toEqual([]);
  });

  it("理由空白 / 超过 500 字 ⇒ KG_INVALID_REQUEST", async () => {
    const { deps, calls } = fakeDeps({ u1: { orgRole: "consultant", projectRole: "member", groupId: null } });
    await expect(run(deps, "u1", "c-fact", "   ")).rejects.toMatchObject({ code: "KG_INVALID_REQUEST" });
    await expect(run(deps, "u1", "c-fact", "理".repeat(501))).rejects.toMatchObject({ code: "KG_INVALID_REQUEST" });
    expect(calls).toEqual([]);
  });

  it.each([["facilitator", "c-fact"], ["member", "c-hyp"]] as const)("%s 采纳 %s ⇒ 端口收到 trim 过的理由，返回 id", async (role, claimId) => {
    const { deps, calls } = fakeDeps({ u1: { orgRole: "consultant", projectRole: role, groupId: null } });
    await expect(run(deps, "u1", claimId)).resolves.toEqual({ decisionClaimId: "act-1-g", actionId: "act-1" });
    expect(calls).toEqual([{ actionId: "act-1", projectId: PROJECT, claimId, rationale: "两轮访谈都指向它" }]);
  });
});
