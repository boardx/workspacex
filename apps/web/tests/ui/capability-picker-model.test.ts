import { describe, expect, it } from "vitest";
import { buildPickerGroups, joinWithOverflow, shortReason, strengthsFor, subtitleFor, workflowLabel } from "@/lib/capability-picker-model";
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

  it("shortReason keeps the first clause", () => {
    expect(shortReason("该 Agent 尚无可用的已发布版本，请联系管理员。")).toBe("尚无可用的已发布版本");
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
});
