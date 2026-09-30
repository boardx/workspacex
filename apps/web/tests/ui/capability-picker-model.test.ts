import { describe, expect, it } from "vitest";
import { buildPickerGroups, examplePromptsFor, joinWithOverflow, reasonCopy, shortReason, strengthsFor, subtitleFor, workflowLabel, pendingWorkflowLabels, autoExamplePrompts } from "@/lib/capability-picker-model";
import type { CapabilityListing } from "@/lib/live-capabilities";
import type { AgentDirectoryCard, PendingOfficialRole } from "@/lib/agent-directory";

const mk = (id: string, name: string, extra: Partial<CapabilityListing> = {}): CapabilityListing => ({ id, orgId: "o", kind: "agent", name, scope: "org-wide", enabled: true, endpoint: null, abbr: null, duty: null, disabledReason: null, agentAvailable: true, ...extra });
const card = (agentId: string, over: Partial<AgentDirectoryCard> = {}): AgentDirectoryCard => ({
  agentId, versionId: "v", name: agentId, initials: "X", roleLabel: "", avatar: null, roleCategory: null, tags: [],
  catalogSource: "org" as AgentDirectoryCard["catalogSource"], workflows: [], readiness: "ready", ...over,
});
const pending: PendingOfficialRole = { roleRef: "D005", name: "Sales Representative", roleLabel: "Sales Representative", avatar: null, roleCategory: "sales", tags: ["销售"], workflowAllowlist: ["W011"] } as PendingOfficialRole;

describe("capability picker model", () => {
  it("subtitle drops when equal to name (case/space-insensitive), falls back roleLabel → duty", () => {
    expect(subtitleFor("DT Agent", undefined, "dt  agent")).toBeNull();
    expect(subtitleFor("A", card("a", { roleLabel: "A" }), "does research")).toBe("does research");
    expect(subtitleFor("A", card("a", { roleLabel: "Analyst" }), "x")).toBe("Analyst");
  });

  it("groups: official DH first, then portrait DH, pending, others, unavailable last", () => {
    const g = buildPickerGroups({
      listings: [mk("gen", "Gen"), mk("bad", "Bad", { agentAvailable: false, disabledReason: "该 Agent 尚无可用的已发布版本，请联系管理员。" }), mk("port", "Portrait"), mk("off", "Official")],
      directory: new Map([
        ["port", card("port", { avatar: { kind: "illustration", key: "dh-05-sales-representative", alt: "" } as AgentDirectoryCard["avatar"] })],
        ["off", card("off", { catalogSource: "official" as AgentDirectoryCard["catalogSource"], tags: ["产品"] })],
      ]),
      pending: [pending],
    });
    expect(g.digitalHumans.map((e) => e.listing.id)).toEqual(["off", "port"]);
    expect(g.others.map((e) => e.listing.id)).toEqual(["gen"]);
    expect(g.unavailable.map((e) => e.listing.id)).toEqual(["bad"]);
    expect(g.pending).toHaveLength(1);
    expect(g.tagOptions).toEqual(["产品", "销售"]);
  });

  it("search and tag filter apply to entries and pending alike", () => {
    const base = { listings: [mk("off", "Official")], directory: new Map([["off", card("off", { catalogSource: "official" as AgentDirectoryCard["catalogSource"], tags: ["产品"] })]]), pending: [pending] };
    expect(buildPickerGroups({ ...base, filter: { kind: "tag", value: "销售" } })).toMatchObject({ digitalHumans: [], pending: [pending] });
    const q = buildPickerGroups({ ...base, query: "official" });
    expect(q.digitalHumans).toHaveLength(1);
    expect(q.pending).toHaveLength(0);
  });

  it("isEmpty only when there are no listings and nothing pending", () => {
    expect(buildPickerGroups({ listings: [], directory: new Map() }).isEmpty).toBe(true);
    expect(buildPickerGroups({ listings: [], directory: new Map(), pending: [pending] }).isEmpty).toBe(false);
  });

  it("不可用原因映射成客户端中文文案，服务端原文（含端点 / id）不上屏", () => {
    expect(shortReason("该 Agent 尚无可用的已发布版本，请联系管理员。")).toBe("尚未发布");
    expect(shortReason("本地组织的产品承诺：…该条目的端点（https://x.example）不在本机")).toBe("本地组织不可用");
    expect(shortReason("AGENT_D002_UNAVAILABLE")).toBe("暂不可用");
    expect(reasonCopy("S061 failed").full).not.toMatch(/S061/);
    expect(shortReason(null)).toBe("暂不可用");
  });

  it("擅长不回显名字：duty(≠名字/头衔) → 标签 (无则分类) → 流程 → null", () => {
    expect(strengthsFor({ name: "设计思维专家", duty: "设计思维专家" }, card("a", { roleLabel: "设计思维专家", tags: ["设计", "创新"] }))).toBe("设计、创新");
    expect(strengthsFor({ name: "A", duty: "把问题拆成可验证的假设" }, card("a"))).toBe("把问题拆成可验证的假设");
    const flows = ["一", "二", "三", "四"].map((n, i) => ({ stableId: `X90${i}`, name: n })) as unknown as AgentDirectoryCard["workflows"];
    expect(strengthsFor({ name: "A", duty: "A" }, card("a", { workflows: flows }))).toBe("一、二、三 等 4 个");
    expect(strengthsFor({ name: "A", duty: null }, card("a", { roleCategory: "research" }))).toBe("研究");
    expect(strengthsFor({ name: "A", duty: null }, undefined)).toBeNull();
  });
  it("流程名上屏用中文显示名，不漏英文标识 / 技术 id；截断落在条目边界", () => {
    expect(workflowLabel({ stableId: "W028", name: "Research-to-Insight（从一轮用户研究提炼洞察）" })).toBe("用户研究到洞察");
    expect(workflowLabel({ stableId: "research-to-insight", name: "x" })).toBe("用户研究到洞察");
    expect(workflowLabel({ stableId: "zz", name: "Experiment Loop" })).toBe("实验闭环");
    expect(workflowLabel({ stableId: "zz", name: "周报汇总（按团队）" })).toBe("周报汇总");
    expect(joinWithOverflow(["甲", "乙"], 3)).toBe("甲、乙");
    expect(joinWithOverflow(["甲", "乙", "丙", "丁", "戊"], 3)).toBe("甲、乙、丙 等 5 个");
  });
  it("预览「适合这样问」由流程派生，无流程时给中性说法", () => {
    const flows = [{ stableId: "W029", name: "Problem-to-PRD" }] as unknown as AgentDirectoryCard["workflows"];
    expect(examplePromptsFor(card("a", { workflows: flows }))).toEqual(["帮我走一遍「问题定义到 PRD」"]);
    expect(examplePromptsFor(undefined).length).toBeGreaterThan(0);
  });
  it("English-first workflow names show only the parenthesised Chinese", () => {
    expect(workflowLabel({ stableId: "W040", name: "Knowledge Capture Loop（知识捕获循环）" })).toBe("知识捕获循环");
    expect(workflowLabel({ stableId: "W040", name: "Knowledge Capture Loop (知识捕获循环)" })).toBe("知识捕获循环");
    expect(workflowLabel({ stableId: "zz", name: "Weekly Sync" })).toBe("未命名流程");
  });

  it("pending preview lists builtin workflows in Chinese and counts unknown ids", () => {
    expect(pendingWorkflowLabels({ workflowAllowlist: ["W029", "W030", "W011"] })).toEqual({ labels: ["问题定义到 PRD", "PRD 到迭代计划"], unknown: 1 });
    expect(pendingWorkflowLabels(pending)).toEqual({ labels: [], unknown: 1 });
  });

  it("auto preview examples come from candidates, with a generic fallback", () => {
    const e = { listing: mk("a", "A"), card: card("a", { workflows: [{ stableId: "W029", name: "x" }] as AgentDirectoryCard["workflows"] }), subtitle: null, tags: [] };
    expect(autoExamplePrompts([e])).toEqual(["帮我走一遍「问题定义到 PRD」"]);
    expect(autoExamplePrompts([])).toHaveLength(2);
  });
});

describe("自动匹配示例不出现纯英文工作流名（r4）", () => {
  it("Research-to-Brief 等 ASCII-only 名字都经中文 label 或被剔除", () => {
    const wf = [
      { stableId: "W001", name: "Research-to-Brief" },
      { stableId: "research-to-brief", name: "Research-to-Brief" },
      { stableId: "zz", name: "Weekly Sync" },
      { stableId: "W029", name: "Problem-to-PRD" },
    ] as AgentDirectoryCard["workflows"];
    const entries = wf.map((w, i) => ({ listing: mk(`a${i}`, "A"), card: card(`a${i}`, { workflows: [w] }), subtitle: null, tags: [] }));
    const all = [...autoExamplePrompts(entries), ...entries.flatMap((e) => examplePromptsFor(e.card))];
    for (const q of all) {
      for (const name of q.match(/「([^」]*)」/g) ?? []) expect(name).toMatch(/\p{Script=Han}/u);
    }
    expect(all.join()).not.toMatch(/Research-to-Brief|Weekly Sync/);
    expect(examplePromptsFor(entries[0]!.card)).toEqual(["帮我走一遍「调研到简报」"]);
  });
});
