/**
 * F62 · 提交人 ≠ 审核人（`domain.md` I-4，`review-authorization.ts`）。
 *
 * 两个分支，⚠ **两码分开**（`review-authorization.ts` 注释③）：
 *   · 组织内换得到第二名方法论审核人 ⇒ `SELF_REVIEW_FORBIDDEN`（操作错误，提示换人）
 *   · 组织内换不到（提交人是唯一持有该职能的人）⇒ `NO_SECOND_REVIEWER`（组织配置问题，
 *     提示找组织管理员再指派一名）
 * 且自审尝试**不得**推进状态机——被拒时版本仍停在 `待审核`。
 */
import { describe, expect, it } from "vitest";
import { reviewSkillVersion } from "../../../src/application/skill/review-skill-version";
import type { GateState } from "../../../src/domain/skill/security-gate";
import { collectAudit } from "../../support/skill-fakes";

const CLEAN_SCAN: GateState["scan"] = { verdict: "pass", findings: [] };

describe("提交人尝试批准自己提交的 skill 被拒", () => {
  it("组织内还有另一名方法论审核人 ⇒ `SELF_REVIEW_FORBIDDEN`，提示换人", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-alice",
        reviewerId: "u-alice",
        reviewerFunction: "methodology-reviewer",
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
    expect(r.code).toBe("SELF_REVIEW_FORBIDDEN");
    expect(r.reason).toContain("另一名方法论审核人");
    expect(r.status, "自审被拒——状态原地不动").toBe("待审核");
  });

  it("组织内无第二名方法论审核人 ⇒ `NO_SECOND_REVIEWER`，与上一条区分（A4）", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-alice",
        reviewerId: "u-alice",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: false,
        decision: "approve",
        from: "待审核",
        scan: CLEAN_SCAN,
        acknowledgedRiskItemIds: [],
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NO_SECOND_REVIEWER");
    expect(r.code).not.toBe("SELF_REVIEW_FORBIDDEN");
    expect(r.reason).toContain("组织管理员");
  });

  it("reject 分支同样受自审规则约束（不只 approve 才检查）", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-alice",
        reviewerId: "u-alice",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "reject",
        from: "待审核",
        scan: CLEAN_SCAN,
        acknowledgedRiskItemIds: [],
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SELF_REVIEW_FORBIDDEN");
  });

  it("换一名真正不同的审核人 ⇒ 正常放行（正对照：规则不是恒拒）", async () => {
    const audit = collectAudit();
    const r = await reviewSkillVersion(
      {
        skillId: "sk-1",
        submitterId: "u-alice",
        reviewerId: "u-bob",
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
  });
});
