/**
 * F62 · 双重门禁：安全扫描（自动）＋ 方法论审核（人工），两道**并列**，
 * 且**两职能不合并**（`domain.md` O-21 / I-5，`security-gate.ts` + `review-authorization.ts`）。
 *
 * 本文件断言的是**绕过路径**：
 *   ① 只过安全扫描、未过方法论审核的版本，直接调接口置「已启用」被拒并写审计（I-23，已在
 *      `status-enum-exactly-four.test.ts` 覆盖状态机半边；这里从 `reviewSkillVersion` 的
 *      入口重新走一遍，确认**这条用例**也不提供绕过口）。
 *   ② 安全评审人（`security-reviewer`）调用 `reviewSkillVersion` 试图批准发布 skill 被拒
 *      （`REVIEWER_FUNCTION_MISMATCH`，两职能不合并）。
 *   ③ 未被组织管理员指派任何评审职能的人调用同一用例被拒，同一错误码。
 *   ④ 人员维度过了、门禁维度没过（扫描未跑）时，仍然被 `GATE_NOT_PASSED` 挡住——
 *      两道判定是 **AND**，任何一边不过都不能只靠另一边放行。
 *
 * ⚠ 「方法论审核人裁决工具白名单越权申请被拒」是同一条纪律（I-5）在 **MCP/agent-runtime**
 *   束的镜像（`apps/api/src/application/mcp/authorize-layer1.ts`），不属本契约束的
 *   `reviewSkillVersion` 操作——两束共享同一批错误码由 `packages/contracts/src/skills.ts`
 *   的 `_sharedWithAgentRuntime` 编译期门控保证同码同义，具体断言归 `tests/capability/mcp/*`。
 */
import { describe, expect, it } from "vitest";
import { advanceSkillStatus } from "../../../src/application/skill/advance-skill-status";
import { reviewSkillVersion } from "../../../src/application/skill/review-skill-version";
import type { GateState } from "../../../src/domain/skill/security-gate";
import { collectAudit } from "../../support/skill-fakes";

describe("门禁第二道：只过扫描未过方法论审核 ⇒ 停在待审核，直调接口置已启用被拒并记审计", () => {
  it("扫描 pass、方法论审核尚无记录 ⇒ 直接置「已启用」被拒 `GATE_NOT_PASSED`", async () => {
    const audit = collectAudit();
    const gates: GateState = {
      scan: { verdict: "pass", findings: [] },
      methodologyReview: null,
      acknowledgedRiskItemIds: [],
    };
    const r = await advanceSkillStatus(
      { skillId: "sk-1", principalId: "attacker-1", from: "待审核", to: "已启用", gates },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("GATE_NOT_PASSED");
    expect(r.reason).toContain("方法论审核尚无记录");
    expect(r.status, "被拒时状态原地不动——仍是待审核").toBe("待审核");
    expect(r.auditWritten).toBe(true);
    expect(audit.events.map((e) => e.kind)).toContain("skill-gate-bypass-attempt");
  });
});

describe("两职能不合并：安全评审人调用 `reviewSkillVersion` 批准发布 skill 被拒（I-5）", () => {
  const CLEAN_SCAN: GateState["scan"] = { verdict: "pass", findings: [] };

  it("`security-reviewer` 试图 approve ⇒ `REVIEWER_FUNCTION_MISMATCH`，状态原地不动", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-submitter",
        reviewerId: "u-security",
        reviewerFunction: "security-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        from: "待审核",
        scan: CLEAN_SCAN,
        acknowledgedRiskItemIds: [],
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("REVIEWER_FUNCTION_MISMATCH");
    expect(r.reason).toContain("两职能不合并");
    expect(r.status).toBe("待审核");
  });

  it("未被指派任何评审职能（`null`）⇒ 同一错误码，不因『至少不是安全评审人』而放行", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-submitter",
        reviewerId: "u-nobody",
        reviewerFunction: null,
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        from: "待审核",
        scan: CLEAN_SCAN,
        acknowledgedRiskItemIds: [],
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("REVIEWER_FUNCTION_MISMATCH");
  });

  it("职能对了但扫描没过 ⇒ 仍然 `GATE_NOT_PASSED`——人员维度过关不能替代门禁维度", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-submitter",
        reviewerId: "u-methodology",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        from: "待审核",
        scan: null,
        acknowledgedRiskItemIds: [],
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("GATE_NOT_PASSED");
  });

  it("两道门禁齐全 ∧ 职能对 ∧ 非自审 ⇒ 才放行（不过火：不能恒拒）", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-submitter",
        reviewerId: "u-methodology",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        from: "待审核",
        scan: CLEAN_SCAN,
        acknowledgedRiskItemIds: [],
      },
      { audit },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("已启用");
    expect(audit.events).toEqual([]);
  });
});
