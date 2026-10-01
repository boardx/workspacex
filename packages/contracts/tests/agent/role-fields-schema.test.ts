/**
 * AG01 —— Agent 角色冻结字段契约（contracts/agent-role，requirements 03-agent-role.md R3 ①）。
 * 断言 schema 接受合法形状、拒绝越界形状，回填默认值本身合法，冻结字段名单与 schema 键一致。
 */
import { describe, expect, it } from "vitest";
import { agentRole as R } from "../../src/index";

const valid = {
  avatar: { kind: "illustration", key: "robot", alt: "研究员头像" },
  roleCategory: "research",
  catalogSource: "official",
  workflowAllowlist: ["W001", "W060"],
  delegationPolicy: { allowedTargets: ["D003"], maxDepth: 2, requireApproval: true },
  escalationPolicy: { rules: [{ matter: "预算超限", target: "project_owner" }] },
  kpi: [{ metric: "research.cycle_time", description: "单次调研周期" }],
  tags: ["调研"],
};

describe("AG01 AgentRoleFields", () => {
  it("accepts a full valid role and the backfill defaults", () => {
    expect(R.AgentRoleFields.safeParse(valid).success).toBe(true);
    expect(R.AgentRoleFields.parse(R.AGENT_ROLE_FIELD_DEFAULTS)).toEqual(R.AGENT_ROLE_FIELD_DEFAULTS);
  });

  it("backfill defaults match R3: avatar null, catalogSource org, empty allowlist", () => {
    expect(R.AGENT_ROLE_FIELD_DEFAULTS.avatar).toBeNull();
    expect(R.AGENT_ROLE_FIELD_DEFAULTS.catalogSource).toBe("org");
    expect(R.AGENT_ROLE_FIELD_DEFAULTS.workflowAllowlist).toEqual([]);
  });

  it("frozen-field list equals the schema's keys", () => {
    expect([...R.AGENT_ROLE_FROZEN_FIELDS].sort()).toEqual(Object.keys(R.AgentRoleFields.shape).sort());
  });

  it.each([
    ["avatar with non-illustration kind", { ...valid, avatar: { kind: "artifact", key: "robot", alt: "x" } }],
    ["avatar with unknown key", { ...valid, avatar: { kind: "illustration", key: "nope", alt: "x" } }],
    ["unknown roleCategory", { ...valid, roleCategory: "astrology" }],
    ["unknown catalogSource", { ...valid, catalogSource: "vendor" }],
    ["workflow id not W###", { ...valid, workflowAllowlist: ["wf-1"] }],
    ["delegation target not D###", { ...valid, delegationPolicy: { ...valid.delegationPolicy, allowedTargets: ["agent-x"] } }],
    ["delegation depth above call-chain cap", { ...valid, delegationPolicy: { ...valid.delegationPolicy, maxDepth: 3 } }],
    ["escalation target unknown", { ...valid, escalationPolicy: { rules: [{ matter: "m", target: "ceo" }] } }],
    ["kpi metric uppercase", { ...valid, kpi: [{ metric: "Bad", description: "d" }] }],
    ["extra field (strict)", { ...valid, token: "secret" }],
    ["missing catalogSource", (({ catalogSource: _c, ...rest }) => rest)(valid)],
  ])("rejects %s", (_label, candidate) => {
    expect(R.AgentRoleFields.safeParse(candidate).success).toBe(false);
  });
});

describe("AgentTags (数字人标签)", () => {
  it("trims each tag and drops duplicates, keeping first-seen order", () => {
    expect(R.AgentTags.parse([" 销售 ", "调研", "销售"])).toEqual(["销售", "调研"]);
  });

  it("accepts up to 10 tags of 1–20 chars, and an empty list", () => {
    expect(R.AgentTags.safeParse([]).success).toBe(true);
    expect(R.AgentTags.safeParse(Array.from({ length: 10 }, (_, i) => `标签${i}`)).success).toBe(true);
    expect(R.AgentTags.safeParse(["x".repeat(20)]).success).toBe(true);
  });

  it("counts the cap after dedup: 11 entries that collapse to 10 are fine", () => {
    expect(R.AgentTags.parse([...Array.from({ length: 10 }, (_, i) => `t${i}`), "t0"])).toHaveLength(10);
  });

  it.each([
    ["blank tag", ["   "]],
    ["empty tag", [""]],
    ["tag over 20 chars", ["x".repeat(21)]],
    ["11 distinct tags", Array.from({ length: 11 }, (_, i) => `t${i}`)],
    ["non-string tag", [3]],
  ])("rejects %s", (_label, candidate) => {
    expect(R.AgentTags.safeParse(candidate).success).toBe(false);
  });

  it("directory card requires tags", () => {
    const card = {
      agentId: "a", versionId: "v", name: "n", initials: "N", roleLabel: "r", avatar: null,
      roleCategory: null, catalogSource: "org", workflows: [], readiness: "ready",
    };
    expect(R.AgentDirectoryCard.safeParse(card).success).toBe(false);
    expect(R.AgentDirectoryCard.safeParse({ ...card, tags: ["销售"] }).success).toBe(true);
  });
});
