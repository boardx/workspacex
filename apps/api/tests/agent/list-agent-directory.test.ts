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
    catalogSource: "official",
    workflowAllowlist: [],
    toolPolicyLength: 0,
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
