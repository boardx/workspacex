/**
 * F68 · 改进提案未经人工复核不得上线（UC-3.6 R3 阶段三/四，AC2；R7 硬约束）。
 *
 * V3（门禁态）：AC2 —— 生成的改进提案在未经人工复核时不上线；直接调接口置为
 *   生效被拒绝并记审计。
 * V4（门禁态）：提交提案的人尝试自行复核被拒绝，提示需另一名审核人。
 * V7（版本态）：复核通过后 vN+1 上线、vN 自动归档，进行中项目仍按锁定版本运行
 *   （锁定行为本身已在 F63 `binding-version-snapshot.test.ts` 测过，这里只断言
 *   版本链恰好一个已生效）。
 * V8（兼容性态）：破坏 schema 的改进复核界面须显著标出（未确认 ⇒ 拒绝上线）。
 */
import { describe, expect, it } from "vitest";
import { generateImprovementProposal } from "../../../src/application/skill/generate-improvement-proposal";
import { reviewProposal } from "../../../src/application/skill/review-proposal";
import { releaseProposal } from "../../../src/application/skill/release-proposal";
import { exactlyOneEffective, type SkillVersionSnapshot } from "../../../src/domain/skill/version-chain";
import {
  collectAudit,
  improvementProposalStore,
  skillVersionStore,
  validContract,
} from "../../support/skill-fakes";

const V1: SkillVersionSnapshot = Object.freeze({
  versionId: "v1",
  skillId: "sk-facilitator",
  versionNumber: 1,
  content: validContract(),
  contentHash: "hash-v1",
  state: "已生效",
});

describe("V3/AC2：改进提案生成不改变 vN，且未经复核不得上线", () => {
  it("generateImprovementProposal 落 vN+1·待审核，vN 保持已生效不变", async () => {
    const versions = skillVersionStore({ "sk-facilitator": [V1] });
    const proposals = improvementProposalStore();

    const result = await generateImprovementProposal(
      {
        proposalId: "proposal-1",
        skillId: "sk-facilitator",
        draftVersionId: "v2",
        category: "contract-solvable",
        proposedContract: validContract({ promptTemplate: "请对 {{输入}} 做 MECE 拆解（阈值 3→5）" }),
      },
      { versions, proposals },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.diff.length).toBeGreaterThan(0);
    expect(result.schemaBreaking).toBe(false);
    expect(result.machineGenerated).toBe(true);

    const history = await versions.loadChain("sk-facilitator");
    const v1 = history.find((v) => v.versionId === "v1");
    const v2 = history.find((v) => v.versionId === "v2");
    expect(v1?.state).toBe("已生效");
    expect(v2?.state).toBe("待审核");
    expect(proposals.saved).toHaveLength(1);
    expect(proposals.saved[0]?.humanEdits).toBe(0);
  });

  it("对非 contract-solvable 的聚合项生成提案 ⇒ NOT_CONTRACT_SOLVABLE，不产出任何 diff", async () => {
    const versions = skillVersionStore({ "sk-facilitator": [V1] });
    const proposals = improvementProposalStore();

    const result = await generateImprovementProposal(
      {
        proposalId: "proposal-2",
        skillId: "sk-facilitator",
        draftVersionId: "v2",
        category: "implementation-defect",
        proposedContract: validContract(),
      },
      { versions, proposals },
    );

    expect(result).toEqual({ ok: false, code: "NOT_CONTRACT_SOLVABLE" });
    expect(proposals.saved).toHaveLength(0);
    expect((await versions.loadChain("sk-facilitator")).map((v) => v.versionId)).toEqual(["v1"]);
  });

  it("绕过复核直接调用 releaseProposal ⇒ PROPOSAL_NOT_REVIEWED，且写安全审计", async () => {
    const V2_PENDING: SkillVersionSnapshot = Object.freeze({
      versionId: "v2",
      skillId: "sk-facilitator",
      versionNumber: 2,
      content: validContract(),
      contentHash: "hash-v2",
      state: "待审核",
    });
    const versions = skillVersionStore({ "sk-facilitator": [V1, V2_PENDING] });
    const audit = collectAudit();

    const result = await releaseProposal(
      {
        proposalId: "proposal-1",
        skillId: "sk-facilitator",
        versionId: "v2",
        principalId: "attacker-or-mistaken-caller",
        expectedHeadVersionId: "v1",
        gate: { reviewDecision: "not-reviewed", schemaBreaking: false, schemaBreakingAcknowledged: false },
      },
      { versions, audit },
    );

    expect(result).toEqual({
      ok: false,
      code: "PROPOSAL_NOT_REVIEWED",
      reason: expect.stringContaining("未经人工复核"),
    });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.kind).toBe("skill-gate-bypass-attempt");
    // 版本链没有被悄悄改动——v2 仍是「待审核」，没有变成「已生效」。
    const history = await versions.loadChain("sk-facilitator");
    expect(history.find((v) => v.versionId === "v2")?.state).toBe("待审核");
  });
});

describe("V4：提交人 ≠ 复核人——提交人自审被拒绝", () => {
  it("submitterId === reviewerId ⇒ SELF_REVIEW_FORBIDDEN，不触发发版", async () => {
    const V2_PENDING: SkillVersionSnapshot = Object.freeze({
      versionId: "v2",
      skillId: "sk-facilitator",
      versionNumber: 2,
      content: validContract(),
      contentHash: "hash-v2",
      state: "待审核",
    });
    const versions = skillVersionStore({ "sk-facilitator": [V1, V2_PENDING] });
    const audit = collectAudit();

    const result = await reviewProposal(
      {
        proposalId: "proposal-1",
        skillId: "sk-facilitator",
        versionId: "v2",
        expectedHeadVersionId: "v1",
        submitterId: "user-same",
        reviewerId: "user-same",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        schemaBreaking: false,
        schemaBreakingAck: false,
      },
      { versions, audit },
    );

    expect(result).toEqual({
      ok: false,
      code: "SELF_REVIEW_FORBIDDEN",
      reason: expect.any(String),
    });
    expect((await versions.loadChain("sk-facilitator")).find((v) => v.versionId === "v2")?.state).toBe(
      "待审核",
    );
  });
});

describe("V7：复核通过后 vN+1 上线、vN 自动归档，恰好同时只有一个已生效", () => {
  it("approve 分支：审核人 ≠ 提交人 ⇒ 发新版成功", async () => {
    const V2_PENDING: SkillVersionSnapshot = Object.freeze({
      versionId: "v2",
      skillId: "sk-facilitator",
      versionNumber: 2,
      content: validContract(),
      contentHash: "hash-v2",
      state: "待审核",
    });
    const versions = skillVersionStore({ "sk-facilitator": [V1, V2_PENDING] });
    const audit = collectAudit();

    const result = await reviewProposal(
      {
        proposalId: "proposal-1",
        skillId: "sk-facilitator",
        versionId: "v2",
        expectedHeadVersionId: "v1",
        submitterId: "user-author",
        reviewerId: "user-reviewer",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        schemaBreaking: false,
        schemaBreakingAck: false,
      },
      { versions, audit },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.decision !== "approve") throw new Error("unreachable");
    expect(result.released.versionId).toBe("v2");
    expect(result.released.state).toBe("已生效");
    expect(result.archivedVersionId).toBe("v1");

    const history = await versions.loadChain("sk-facilitator");
    expect(history.find((v) => v.versionId === "v1")?.state).toBe("已归档");
    expect(history.find((v) => v.versionId === "v2")?.state).toBe("已生效");
    expect(exactlyOneEffective(history)).toBe(true);
    expect(audit.events).toHaveLength(0);
  });

  it("reject 分支：不触发发版，vN 保持生效", async () => {
    const V2_PENDING: SkillVersionSnapshot = Object.freeze({
      versionId: "v2",
      skillId: "sk-facilitator",
      versionNumber: 2,
      content: validContract(),
      contentHash: "hash-v2",
      state: "待审核",
    });
    const versions = skillVersionStore({ "sk-facilitator": [V1, V2_PENDING] });
    const audit = collectAudit();

    const result = await reviewProposal(
      {
        proposalId: "proposal-1",
        skillId: "sk-facilitator",
        versionId: "v2",
        expectedHeadVersionId: "v1",
        submitterId: "user-author",
        reviewerId: "user-reviewer",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "reject",
        schemaBreaking: false,
        schemaBreakingAck: false,
      },
      { versions, audit },
    );

    expect(result).toEqual({ ok: true, decision: "reject", reason: expect.any(String) });
    const history = await versions.loadChain("sk-facilitator");
    expect(history.find((v) => v.versionId === "v1")?.state).toBe("已生效");
    expect(history.find((v) => v.versionId === "v2")?.state).toBe("待审核");
  });
});

describe("V8/E3：破坏 schema 兼容性的改进未被确认时拒绝上线，须显著标出", () => {
  it("schemaBreaking=true 且未 ack ⇒ SCHEMA_BREAKING_UNACKNOWLEDGED", async () => {
    const V2_PENDING: SkillVersionSnapshot = Object.freeze({
      versionId: "v2",
      skillId: "sk-facilitator",
      versionNumber: 2,
      content: validContract(),
      contentHash: "hash-v2",
      state: "待审核",
    });
    const versions = skillVersionStore({ "sk-facilitator": [V1, V2_PENDING] });
    const audit = collectAudit();

    const result = await reviewProposal(
      {
        proposalId: "proposal-1",
        skillId: "sk-facilitator",
        versionId: "v2",
        expectedHeadVersionId: "v1",
        submitterId: "user-author",
        reviewerId: "user-reviewer",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        schemaBreaking: true,
        schemaBreakingAck: false,
      },
      { versions, audit },
    );

    expect(result).toEqual({ ok: false, code: "SCHEMA_BREAKING_UNACKNOWLEDGED", reason: expect.any(String) });
    expect((await versions.loadChain("sk-facilitator")).find((v) => v.versionId === "v2")?.state).toBe(
      "待审核",
    );
  });

  it("确认后（ack=true）即可正常上线", async () => {
    const V2_PENDING: SkillVersionSnapshot = Object.freeze({
      versionId: "v2",
      skillId: "sk-facilitator",
      versionNumber: 2,
      content: validContract(),
      contentHash: "hash-v2",
      state: "待审核",
    });
    const versions = skillVersionStore({ "sk-facilitator": [V1, V2_PENDING] });
    const audit = collectAudit();

    const result = await reviewProposal(
      {
        proposalId: "proposal-1",
        skillId: "sk-facilitator",
        versionId: "v2",
        expectedHeadVersionId: "v1",
        submitterId: "user-author",
        reviewerId: "user-reviewer",
        reviewerFunction: "methodology-reviewer",
        anotherMethodologyReviewerExists: true,
        decision: "approve",
        schemaBreaking: true,
        schemaBreakingAck: true,
      },
      { versions, audit },
    );

    expect(result.ok).toBe(true);
  });
});
