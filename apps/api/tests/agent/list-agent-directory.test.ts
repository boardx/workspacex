import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
/**
 * AG04 —— `list-agent-directory.ts` 用例行为覆盖（review 指出：此前只有仓储白名单守卫测试，
 * 没有任何测试真正跑用例逻辑）。覆盖：`roleCategory`/`q` 过滤、`initialsOf`/`readinessOf`
 * 派生、workflow 名称解析（含解析失败回退 stableId）、`getAgentDirectoryCard` 的
 * 401/404 判定与「不存在/跨组织/不可见」统一 404（E9，不泄露存在性）。
 */
import { describe, expect, it } from "vitest";
import {
  AgentDirectoryError,
  getAgentDirectoryCard,
  getAgentDirectoryProfile,
  listAgentDirectory,
  type AgentDirectoryRepository,
  type AgentDirectoryRow,
} from "../../src/application/agent/list-agent-directory";
import type { IdentityRepository } from "../../src/application/identity/ports";
import type { WorkflowDefinitionStore } from "../../src/application/agent-import/ports";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-1");

function row(over: Partial<AgentDirectoryRow> = {}): AgentDirectoryRow {
  return {
    agentId: "agent-1",
    versionId: "v-1",
    name: "研究员小艾",
    roleLabel: "研究专家",
    avatar: null,
    roleCategory: "research",
    tags: [],
    catalogSource: "official",
    workflowAllowlist: [],
    toolPolicyLength: 0,
    duty: null, roleRef: null, skillMountIds: [], skillVersionIds: [], delegationTargetRefs: [], requireApprovalForHandoff: true,
    ...over,
  };
}

function deps(opts: {
  rows?: readonly AgentDirectoryRow[];
  found?: AgentDirectoryRow | null;
  authed?: boolean;
  resolveName?: (stableId: string) => Promise<string | null>;
} = {}) {
  const identities: IdentityRepository = {
    findOrgMembership: async () => (opts.authed === false ? null : ({ orgRole: "member" } as never)),
  } as unknown as IdentityRepository;
  const repository: AgentDirectoryRepository = {
    listVisible: async () => opts.rows ?? [row()],
    findVisible: async () => (opts.found === undefined ? row() : opts.found),
  };
  const workflows: WorkflowDefinitionStore = {
    resolveName: opts.resolveName ?? (async (stableId: string) => `工作流-${stableId}`),
  } as unknown as WorkflowDefinitionStore;
  return { identities, repository, workflows };
}

describe("AG04 listAgentDirectory", () => {
  it("未认证 → UNAUTHENTICATED，不查仓储", async () => {
    const d = deps({ authed: false });
    await expect(
      listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: null }, d),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("按 roleCategory 过滤", async () => {
    const d = deps({ rows: [row({ agentId: "a1", roleCategory: "research" }), row({ agentId: "a2", roleCategory: "product" })] });
    const out = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: "product", q: null }, d);
    expect(out.map((c) => c.agentId)).toEqual(["a2"]);
  });

  it("按 q 过滤（name/roleLabel 拼接、大小写不敏感）", async () => {
    const d = deps({
      rows: [
        row({ agentId: "a1", name: "Sales Sam", roleLabel: "销售专家" }),
        row({ agentId: "a2", name: "研究员", roleLabel: "Research Lead" }),
      ],
    });
    const out = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: "sales" }, d);
    expect(out.map((c) => c.agentId)).toEqual(["a1"]);
    const out2 = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: "RESEARCH" }, d);
    expect(out2.map((c) => c.agentId)).toEqual(["a2"]);
  });

  it("initials 取 name 首字符大写，不依赖落库列", async () => {
    const d = deps({ rows: [row({ name: "z-agent" })] });
    const [card] = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: null }, d);
    expect(card!.initials).toBe("Z");
  });

  it("initials 对空白 name 回退 '?'", async () => {
    const d = deps({ rows: [row({ name: "   " })] });
    const [card] = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: null }, d);
    expect(card!.initials).toBe("?");
  });

  it("readiness：toolPolicyLength 为 0 → ready，非 0 → unknown", async () => {
    const d = deps({ rows: [row({ agentId: "a1", toolPolicyLength: 0 }), row({ agentId: "a2", toolPolicyLength: 2 })] });
    const out = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: null }, d);
    expect(out.find((c) => c.agentId === "a1")!.readiness).toBe("ready");
    expect(out.find((c) => c.agentId === "a2")!.readiness).toBe("unknown");
  });

  it("readiness：toolPolicy 非空但本组织已发布白名单内的 Workflow → ready；一个都没发布 → unknown", async () => {
    const launchable = { publishedWorkflowIds: async () => new Set(["W001"]) };
    const d = { ...deps({ rows: [row({ agentId: "a1", toolPolicyLength: 1, workflowAllowlist: ["W001", "W002"] }), row({ agentId: "a2", toolPolicyLength: 1, workflowAllowlist: ["W002"] })] }), launchable };
    const out = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: null }, d);
    expect(out.find((c) => c.agentId === "a1")).toMatchObject({ readiness: "ready", workflows: [{ stableId: "W001" }] });
    expect(out.find((c) => c.agentId === "a2")).toMatchObject({ readiness: "unknown", workflows: [] });
  });

  it("workflowAllowlist 解析出名称；解析失败（reject 或 null）回退 stableId", async () => {
    const d = deps({
      rows: [row({ workflowAllowlist: ["W001", "W002", "W003"] })],
      resolveName: async (stableId: string) => {
        if (stableId === "W001") return "客户调研";
        if (stableId === "W002") return null;
        throw new Error("boom");
      },
    });
    const [card] = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: null }, d);
    expect(card!.workflows).toEqual([
      { stableId: "W001", name: "客户调研" },
      { stableId: "W002", name: "W002" },
      { stableId: "W003", name: "W003" },
    ]);
  });
});

describe("AG04 getAgentDirectoryCard", () => {
  it("未认证 → UNAUTHENTICATED", async () => {
    const d = deps({ authed: false });
    await expect(
      getAgentDirectoryCard({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, d),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("不存在/跨组织/不可见 → 统一 AGENT_NOT_FOUND（E9，不泄露存在性）", async () => {
    const d = deps({ found: null });
    const err = await getAgentDirectoryCard({ orgId: ORG, actorId: "u1", agentId: "nope" }, d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentDirectoryError);
    expect((err as AgentDirectoryError).code).toBe("AGENT_NOT_FOUND");
  });

  it("可见 → 返回卡片", async () => {
    const d = deps({ found: row({ agentId: "agent-1" }) });
    const card = await getAgentDirectoryCard({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, d);
    expect(card.agentId).toBe("agent-1");
  });
});

describe("可发起 = 本组织已发布的流程", () => {
  it("白名单里未在本组织发布的流程不进卡片 workflows（列表与单卡同一判定）", async () => {
    const d = { ...deps({ rows: [row({ workflowAllowlist: ["W001", "W011"] })] }), launchable: { publishedWorkflowIds: async () => new Set(["W001"]) } };
    const [card] = await listAgentDirectory({ orgId: ORG, actorId: "u1", roleCategory: null, q: null }, d);
    expect(card!.workflows.map((w) => w.stableId)).toEqual(["W001"]);
    const one = await getAgentDirectoryCard({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, { ...d, repository: { ...d.repository, findVisible: async () => row({ workflowAllowlist: ["W001", "W011"] }) } });
    expect(one.workflows.map((w) => w.stableId)).toEqual(["W001"]);
  });
});

describe("AG04 follow-up getAgentDirectoryProfile", () => {
  it("未认证 → UNAUTHENTICATED；不可见 → AGENT_NOT_FOUND", async () => {
    await expect(getAgentDirectoryProfile({ orgId: ORG, actorId: "u1", agentId: "a" }, deps({ authed: false }))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(getAgentDirectoryProfile({ orgId: ORG, actorId: "u1", agentId: "a" }, deps({ found: null }))).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
  });

  it("占位职责（等于名字）不回显；真实职责原样返回；技能引用去重", async () => {
    const placeholder = await getAgentDirectoryProfile({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, deps({ found: row({ duty: "研究员小艾" }) }));
    expect(placeholder.duty).toBeNull();
    const real = await getAgentDirectoryProfile(
      { orgId: ORG, actorId: "u1", agentId: "agent-1" },
      deps({ found: row({ duty: "做结构化调研", skillMountIds: ["s1", "s1", "s2"], skillVersionIds: ["sv1"] }) }),
    );
    expect(real.duty).toBe("做结构化调研");
    expect(real.mountedSkillIds).toEqual(["s1", "s2"]);
    expect(real.pinnedSkillVersionIds).toEqual(["sv1"]);
  });

  it("转交对象只列目录里可见、且被委派策略引用的角色（不含自己）", async () => {
    const self = row({ agentId: "agent-1", roleRef: "D002", delegationTargetRefs: ["D003", "D099"] });
    const pm = row({ agentId: "agent-3", name: "产品经理", roleRef: "D003" });
    const sales = row({ agentId: "agent-5", name: "销售", roleRef: "D005" });
    const out = await getAgentDirectoryProfile({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, deps({ found: self, rows: [self, pm, sales] }));
    expect(out.delegationTargets.map((t) => t.agentId)).toEqual(["agent-3"]);
    expect(out.delegationTargets[0]!.initials).toBe("产");
  });
});

 it("profile exposes exact old-version pins without substituting catalog current versions", async () => {
  const d = deps({ found: row({ skillVersionIds: ["old-version"], pinnedSkills: [{ skillId: "catalog-skill", versionId: "old-version" }, { skillId: "other", versionId: "not-pinned" }] }) });
  const profile = await getAgentDirectoryProfile({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, d);
  expect(profile.pinnedSkills).toEqual([{ skillId: "catalog-skill", versionId: "old-version" }]);
});
it("pending declared capabilities remain informational and do not become executable pins", async () => {
  const pending = { stableId: "S061", stableName: "product-capability", contentDigest: "a".repeat(64), reason: "awaiting_verification" as const, skillId: "candidate", versionId: "candidate-v1" };
  const profile = await getAgentDirectoryProfile({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, deps({ found: row({ skillVersionIds: [], pendingSkillBindings: [pending] }) }));
  expect(profile.pendingSkillBindings).toEqual([pending]);
  expect(profile.pinnedSkills).toEqual([]);
  expect(profile.pinnedSkillVersionIds).toEqual([]);
});

it("legacy frozen pending IDs receive exact authored titles in the read projection only", async () => {
  const coordinate = buildOfficialAgentRolePack().agents.find(agent => agent.roleRef === "D003")!.authoredSkillBindings!.find(skill => skill.stableId === "S061")!;
  const binding = { ...coordinate, reason: "awaiting_verification" as const, displayName: "S061" };
  const drifted = { ...binding, contentDigest: "0".repeat(64) };
  const named = { ...binding, displayName: "真实中文名称" };
  const original = [binding, drifted, named];
  const profile = await getAgentDirectoryProfile({ orgId: ORG, actorId: "u1", agentId: "agent-1" }, deps({ found: row({ pendingSkillBindings: original }) }));
  expect(profile.pendingSkillBindings).toEqual([{ ...binding, displayName: "产品探索（S061）" }, drifted, named]);
  expect(original[0]!.displayName).toBe("S061");
  expect(profile.pinnedSkills).toEqual([]);
});
