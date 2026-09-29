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
