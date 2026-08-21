/**
 * F65 · **写不了这条线程的人**不能挂载 skill；服务端拒绝 + 安全审计（V4；UC-3.3 R5/R7/E1）。
 *
 * ## 这份文件的判据被人类裁决改过一次（2026-08-21，#1693）
 *
 * 原判据是「组员/组长一律拒绝，只放行引导师」。人类逐字裁决：
 *
 * > 「个人对话必须要可以使用公共的 skills」
 * > 「所有的人都可以用」
 *
 * ⇒ 「是不是引导师」不再是判据。文件名保留（`member-cannot-self-mount`）只是为了
 *   让 git 历史连着；**内容断言的是新判据**：能写这条线程的人就能挂，写不了的不能挂。
 *   `KNOWN_CONTRACT_GAPS.S3`（组长下放开关）随之作废——不再需要「下放」这个动作。
 *
 * ## 没有被裁决动到、因而必须原样保住的三条
 *
 * 这三条是本文件真正的价值，放宽「谁能挂」时最容易被顺手一起放宽：
 *
 * 1. **直调用例同样被拒**：「前端不显示『＋加技能』」是表现，不是控制。
 * 2. **拒绝留痕**：一次没有审计的拒绝，事后与「从未发生」无法区分（I-23）。
 * 3. **拒绝发生在任何可见性判断之前**：否则越权者能靠错误码差异反推
 *    「池子里有没有这个 skill」，是一次信息泄露（I-14）。
 */
import { describe, expect, it } from "vitest";
import { mountSkillToThread } from "../../../src/application/skill/mount-skill-to-thread";
import type { ThreadMountAuthorization } from "../../../src/application/skill/authorize-thread-mount";
import { collectAudit, threadMountStore, visibility } from "../../support/skill-fakes";

const baseInput = {
  threadId: "thread-1",
  skillIds: ["sk-mece"],
  mountIdFor: (i: number) => `mount-${i}`,
  mountedAt: "2026-08-01T00:00:00Z",
  expectedFingerprint: null,
} as const;

/** 授权通过：`authorizeThreadMount` 对「能写这条线程的人」的返回形状。 */
const allow = (projectRole: "facilitator" | "groupLead" | "member" | null, projectId: string | null): ThreadMountAuthorization =>
  ({ allowed: true, projectId, projectRole, decisionId: "d-ok" });

/** 授权拒绝：线程看不见，或你是只读的观察者。 */
const deny = (reason: "thread-not-visible" | "read-only-role"): ThreadMountAuthorization =>
  ({ allowed: false, reason, decisionId: "d-no" });

function skillPool() {
  return visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } });
}

describe("F65 · 挂载授权：能写这条线程的人才能挂（V4，#1693 改判据）", () => {
  it.each([
    ["线程不可见（含别人的个人线程、别的项目的线程）", deny("thread-not-visible")],
    ["项目里的观察者（只读角色）", deny("read-only-role")],
  ])("%s ⇒ PERMISSION_REVOKED，不入库，写安全审计", async (_label, authorization) => {
    const mounts = threadMountStore();
    const audit = collectAudit();
    const r = await mountSkillToThread(
      { ...baseInput, principalId: "u-x", authorization },
      { mounts, skills: skillPool(), audit, fingerprintOf: (m) => JSON.stringify(m) },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("PERMISSION_REVOKED");
    // 「不入库」的判据：这个线程从未出现在存储桶里，而不是「存了个空数组」。
    expect(mounts.savesByThread.has("thread-1")).toBe(false);
    expect(audit.events.map((e) => e.kind)).toContain("skill-member-self-mount-attempt");
    expect(audit.events[0]?.principalId).toBe("u-x");
  });

  /**
   * 🔴 裁决的正面断言。这三行**在改判据之前全都是红的**——`组员`/`组长` 当时
   * 恒返回 `MEMBER_CANNOT_SELF_MOUNT`。它们就是「所有的人都可以用」的可执行形式。
   */
  it.each([
    ["项目线程 · 引导师", allow("facilitator", "p-1")],
    ["项目线程 · 组长", allow("groupLead", "p-1")],
    ["项目线程 · 组员（裁决前被拒）", allow("member", "p-1")],
    ["个人对话 · 线程所有者（裁决前连用例都进不来）", allow(null, null)],
  ])("%s ⇒ 放行，且不写这条越权审计", async (_label, authorization) => {
    const audit = collectAudit();
    const mounts = threadMountStore();
    const r = await mountSkillToThread(
      { ...baseInput, principalId: "u-f", authorization },
      { mounts, skills: skillPool(), audit, fingerprintOf: (m) => JSON.stringify(m) },
    );

    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(audit.events.map((e) => e.kind)).not.toContain("skill-member-self-mount-attempt");
    expect(mounts.savesByThread.get("thread-1")).toHaveLength(1);
  });

  it("拒绝发生在任何可见性判断之前——越权尝试不会因为 skill 不存在而换一个错误码", async () => {
    // 池子里根本没有这个 skill，但被拒的原因必须始终是权限，不是「skill 不存在」——
    // 否则越权尝试能靠错误码反推池子里有什么，是一次信息泄露（I-14）。
    const r = await mountSkillToThread(
      {
        ...baseInput,
        principalId: "u-outsider",
        authorization: deny("thread-not-visible"),
        skillIds: ["sk-does-not-exist"],
      },
      { mounts: threadMountStore(), skills: visibility({}), audit: collectAudit(), fingerprintOf: (m) => JSON.stringify(m) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("PERMISSION_REVOKED");
  });

  /**
   * ⭐ 安全边界没有被一起放宽（T3）。放开的是「谁能挂」，不是「能挂到什么」：
   * 授权**通过**的人去挂一个对他不可见的 skill，仍然是 `SKILL_NOT_FOUND`
   * （I-14：不存在与不可见同一出口，不泄露存在性）。
   */
  it("⭐ 授权通过 ≠ 可见性放宽：挂不可见的 skill 仍 SKILL_NOT_FOUND", async () => {
    const mounts = threadMountStore();
    const r = await mountSkillToThread(
      {
        ...baseInput,
        principalId: "u-member",
        authorization: allow("member", "p-1"),
        skillIds: ["sk-invisible"],
      },
      // 空池 = 该 skill 对这个人不可见（或不存在——对外必须分不出来）。
      { mounts, skills: visibility({}), audit: collectAudit(), fingerprintOf: (m) => JSON.stringify(m) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_NOT_FOUND");
    expect(mounts.savesByThread.has("thread-1")).toBe(false);
  });
});
