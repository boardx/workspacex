/** AG01 —— 读侧容错按字段回退：一个字段超出契约只回退它自己，catalogSource 原样保留。 */
import { describe, expect, it } from "vitest";
import { agentRole as R } from "@repo/contracts";
import { toRoleFieldsTolerant } from "../../src/infrastructure/agent/agent-version-insert";

const row = {
  avatar: null,
  role_category: "research",
  catalog_source: "official",
  workflow_allowlist: ["W001"],
  delegation_policy: { allowedTargets: ["D003"], maxDepth: 1, requireApproval: true },
  escalation_policy: { rules: [{ matter: "x".repeat(10_000), target: "org_admin" }] },
  kpi: [{ metric: "m", description: "d" }],
};

describe("AG01 toRoleFieldsTolerant", () => {
  it("only the out-of-contract field falls back; official stays official", () => {
    const out = toRoleFieldsTolerant(row, "agent-1");
    expect(out.escalationPolicy).toEqual(R.AGENT_ROLE_FIELD_DEFAULTS.escalationPolicy);
    expect(out).toMatchObject({
      catalogSource: "official", roleCategory: "research", workflowAllowlist: ["W001"],
      kpi: [{ metric: "m", description: "d" }],
    });
  });

  it("a valid row passes through unchanged", () => {
    const ok = { ...row, escalation_policy: { rules: [] } };
    expect(toRoleFieldsTolerant(ok, "agent-1").escalationPolicy).toEqual({ rules: [] });
  });
});
