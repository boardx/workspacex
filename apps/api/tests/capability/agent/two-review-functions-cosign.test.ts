/**
 * F56 / O-21 / I-26 / I-29 -- 双重门禁与越权申请会签：两种审核职能不可合并.
 *
 * `user_visible_behavior` 逐字：「发布须过双重门禁（安全扫描自动 + 方法论审核人工），且
 * 工具白名单里的越权申请须由安全评审人 + 组织管理员会签逐条裁决——方法论审核人尝试裁决
 * 越权申请被拒、安全评审人尝试批准发布被拒（两职能不合并）」。
 *
 * Two symmetric wrong-function cases are the load-bearing assertions here (not merely one
 * direction): a fix that only rejects "方法论审核人裁决越权申请" while still letting
 * "安全评审人批准发布" through would satisfy half of O-21 and silently violate the other half.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import {
  decideElevationRequest,
  auditElevationEntryCompliance,
} from "../../../src/domain/agent/elevation-review";
import { decideAgentPublish } from "../../../src/domain/agent/publish-review";
import { agent } from "./fixtures";
import type { ToolWhitelistEntryT } from "../../../src/domain/agent/definition";

const pendingEntry: ToolWhitelistEntryT = {
  toolFullName: "mcp:crm.exportAll",
  state: "越权申请待确认",
  elevationDecision: null,
};

describe("F56 O-21 -- 方法论审核人尝试裁决越权申请 ⇒ WRONG_REVIEW_FUNCTION", () => {
  it("方法论审核人不在 CountersignRole 里，尝试裁决即被拒", () => {
    const result = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "我觉得可以",
      actorFunction: "methodologyReviewer",
      actorId: "usr-methodology-reviewer",
      signatureRole: "orgAdmin", // 即使冒用签名角色也一样被拒——见下一条
    });
    expect(result).toEqual({ ok: false, reason: "WRONG_REVIEW_FUNCTION" });
  });

  it("安全评审人本人尝试以 orgAdmin 的签名角色签署（角色不一致）⇒ 同样 WRONG_REVIEW_FUNCTION", () => {
    // 一个人的真实职能与他声称在签的槽位必须一致，否则一次签名可以冒充两条签名中的任意一条。
    const result = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "已审阅",
      actorFunction: "securityReviewer",
      actorId: "usr-security-reviewer",
      signatureRole: "orgAdmin",
    });
    expect(result).toEqual({ ok: false, reason: "WRONG_REVIEW_FUNCTION" });
  });

  it("反向：安全评审人以 securityReviewer 身份签署 ⇒ 被接受（不是「一律拒绝」的实现）", () => {
    const result = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "风险可接受，已审阅工具签名",
      actorFunction: "securityReviewer",
      actorId: "usr-security-reviewer",
      signatureRole: "securityReviewer",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.elevationDecision?.securityReviewerSig).toBe("usr-security-reviewer");
      // 只有一条签名——条目仍未生效，恒留在「越权申请待确认」
      expect(result.entry.state).toBe("越权申请待确认");
    }
  });

  it("提交人本人尝试裁决自己提交的越权申请 ⇒ SELF_REVIEW_FORBIDDEN", () => {
    const result = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "自己批自己",
      actorFunction: "securityReviewer",
      actorId: "usr-submitter",
      signatureRole: "securityReviewer",
    });
    expect(result).toEqual({ ok: false, reason: "SELF_REVIEW_FORBIDDEN" });
  });

  it("理由缺失 ⇒ REVIEW_REASON_REQUIRED", () => {
    const result = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "   ",
      actorFunction: "orgAdmin",
      actorId: "usr-org-admin",
      signatureRole: "orgAdmin",
    });
    expect(result).toEqual({ ok: false, reason: "REVIEW_REASON_REQUIRED" });
  });

  it("契约本身：WRONG_REVIEW_FUNCTION / SELF_REVIEW_FORBIDDEN / COUNTERSIGN_MISSING 都在 decideElevationRequest.err 里", () => {
    expect(A.operations.decideElevationRequest.err).toEqual(
      expect.arrayContaining([
        "WRONG_REVIEW_FUNCTION",
        "SELF_REVIEW_FORBIDDEN",
        "COUNTERSIGN_MISSING",
        "REVIEW_REASON_REQUIRED",
      ]),
    );
    // 方法论审核人根本不在会签角色闭集里——这条比运行时判定更强的一层保证。
    expect(A.CountersignRole.options).toEqual(["securityReviewer", "orgAdmin"]);
    expect(A.CountersignRole.safeParse("methodologyReviewer").success).toBe(false);
  });
});

describe("F56 O-21 -- 会签：两条签名都到齐才生效，且缺一即「流程不合规」", () => {
  it("安全评审人先签，条目仍待确认；组织管理员再签，两签齐全后条目转为已准且生效", () => {
    const afterSecurity = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "安全评审：风险可接受",
      actorFunction: "securityReviewer",
      actorId: "usr-security-reviewer",
      signatureRole: "securityReviewer",
    });
    expect(afterSecurity.ok).toBe(true);
    if (!afterSecurity.ok) throw new Error("unreachable");
    expect(afterSecurity.entry.state).toBe("越权申请待确认");
    expect(auditElevationEntryCompliance(afterSecurity.entry)).toEqual({ ok: true }); // 未到「已准」，不适用该检查

    const afterOrgAdmin = decideElevationRequest(afterSecurity.entry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "会签：批准扩大授权范围",
      actorFunction: "orgAdmin",
      actorId: "usr-org-admin",
      signatureRole: "orgAdmin",
    });
    expect(afterOrgAdmin.ok).toBe(true);
    if (!afterOrgAdmin.ok) throw new Error("unreachable");
    expect(afterOrgAdmin.entry.state).toBe("已准");
    expect(afterOrgAdmin.entry.elevationDecision?.securityReviewerSig).toBe("usr-security-reviewer");
    expect(afterOrgAdmin.entry.elevationDecision?.orgAdminSig).toBe("usr-org-admin");
    expect(auditElevationEntryCompliance(afterOrgAdmin.entry)).toEqual({ ok: true });
  });

  it("一个人先后同时扮演两个签名角色也不能拼出两条签名——signatureRole 必须与该次调用的 actorFunction 一致", () => {
    // 同一人尝试用两个不同 signatureRole 签两次，第二次会因角色不一致被拒（他的 actorFunction 不变）。
    const afterSecurity = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "安全评审：风险可接受",
      actorFunction: "securityReviewer",
      actorId: "usr-same-person",
      signatureRole: "securityReviewer",
    });
    if (!afterSecurity.ok) throw new Error("unreachable");

    const secondAttempt = decideElevationRequest(afterSecurity.entry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "准",
      reason: "再签一次冒充组织管理员",
      actorFunction: "securityReviewer", // 他的真实职能没变
      actorId: "usr-same-person",
      signatureRole: "orgAdmin", // 却想签在 orgAdmin 槽位
    });
    expect(secondAttempt).toEqual({ ok: false, reason: "WRONG_REVIEW_FUNCTION" });
  });

  it("手工构造的「已准但缺一签」记录被审计判为流程不合规（COUNTERSIGN_MISSING）", () => {
    const malformed: ToolWhitelistEntryT = {
      toolFullName: "mcp:crm.exportAll",
      state: "已准", // 不应通过正常路径到达这个态却缺签——防御性校验
      elevationDecision: {
        verdict: "准",
        reason: "已审阅",
        securityReviewerSig: "sec-1",
        orgAdminSig: null,
      },
    };
    expect(auditElevationEntryCompliance(malformed)).toEqual({
      ok: false,
      reason: "COUNTERSIGN_MISSING",
    });
  });

  it("单方拒绝（否）即终局，不需要第二签——与批准不对称", () => {
    const rejected = decideElevationRequest(pendingEntry, "usr-submitter", {
      toolFullName: pendingEntry.toolFullName,
      verdict: "否",
      reason: "涉及客户机密数据导出，拒绝",
      actorFunction: "securityReviewer",
      actorId: "usr-security-reviewer",
      signatureRole: "securityReviewer",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) throw new Error("unreachable");
    expect(rejected.entry.state).toBe("已否");
  });
});

describe("F56 O-21 -- 安全评审人尝试 [批准发布] ⇒ WRONG_REVIEW_FUNCTION（两职能不可合并的另一半）", () => {
  const publishBase = {
    submitterId: "usr-submitter",
    decision: "批准发布" as const,
    securityScanPassed: true,
    methodologyPrecheckPassed: true,
    agent: agent(),
  };

  it("安全评审人不能批准发布——即使安全扫描与方法论预检都已通过", () => {
    const result = decideAgentPublish({
      ...publishBase,
      actorId: "usr-security-reviewer",
      actorFunction: "securityReviewer",
    });
    expect(result).toEqual({ ok: false, reason: "WRONG_REVIEW_FUNCTION" });
  });

  it("组织管理员（越权申请会签的另一半职能）同样不能批准发布——批准发布是方法论审核人独有的职权", () => {
    const result = decideAgentPublish({
      ...publishBase,
      actorId: "usr-org-admin",
      actorFunction: "orgAdmin",
    });
    expect(result).toEqual({ ok: false, reason: "WRONG_REVIEW_FUNCTION" });
  });

  it("反向：方法论审核人本人可以批准发布（不是「谁都不能批」的实现）", () => {
    const result = decideAgentPublish({
      ...publishBase,
      actorId: "usr-methodology-reviewer",
      actorFunction: "methodologyReviewer",
    });
    expect(result).toEqual({ ok: true, publishState: "运行中" });
  });

  it("契约本身：decideAgentPublish.err 携带 WRONG_REVIEW_FUNCTION 与 SELF_REVIEW_FORBIDDEN", () => {
    expect(A.operations.decideAgentPublish.err).toEqual(
      expect.arrayContaining(["WRONG_REVIEW_FUNCTION", "SELF_REVIEW_FORBIDDEN"]),
    );
  });

  it("白名单里还有越权申请待确认 ⇒ ELEVATION_UNDECIDED，即使方法论审核人本人批准", () => {
    const result = decideAgentPublish({
      ...publishBase,
      actorId: "usr-methodology-reviewer",
      actorFunction: "methodologyReviewer",
      agent: agent({ toolWhitelist: [pendingEntry] }),
    });
    expect(result).toEqual({ ok: false, reason: "ELEVATION_UNDECIDED" });
  });
});
