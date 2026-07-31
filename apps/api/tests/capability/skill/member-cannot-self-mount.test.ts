/**
 * F65 · 组员不能自行挂载 skill；服务端拒绝 + 安全审计（V4；UC-3.3 R5/R7/E1）。
 *
 * ⚠ 「组员点不到『＋加技能』」是前端表现；这份测试验的是**服务端**那一半——
 * 直调用例（等价于绕开前端隐藏、直接打接口）同样被拒，且拒绝本身留痕，
 * 不是「隐藏入口 = 安全控制」。
 *
 * ⚠ 「组长」当前也被拒：契约 `KNOWN_CONTRACT_GAPS.S3` 记着「组长下放开关」
 * 尚无任何操作能产生，前置条件恒不可满足——`isSelfMountAllowed` 因此只放行
 * `引导师`，这不是把组长错判成组员，是如实反映委托机制未落地。
 */
import { describe, expect, it } from "vitest";
import { mountSkillToThread } from "../../../src/application/skill/mount-skill-to-thread";
import { collectAudit, threadMountStore, visibility } from "../../support/skill-fakes";

const baseInput = {
  threadId: "thread-1",
  skillIds: ["sk-mece"],
  mountIdFor: (i: number) => `mount-${i}`,
  mountedAt: "2026-08-01T00:00:00Z",
  expectedFingerprint: null,
} as const;

function skillPool() {
  return visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } });
}

describe("F65 · 组员不能自行挂载（V4）", () => {
  it.each(["组员", "组长"] as const)(
    "role=%s ⇒ MEMBER_CANNOT_SELF_MOUNT，不入库，写安全审计",
    async (role) => {
      const mounts = threadMountStore();
      const audit = collectAudit();
      const r = await mountSkillToThread(
        { ...baseInput, principalId: "u-x", role },
        { mounts, skills: skillPool(), audit, fingerprintOf: (m) => JSON.stringify(m) },
      );

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe("MEMBER_CANNOT_SELF_MOUNT");
      // 「不入库」的判据：这个线程从未出现在存储桶里，而不是「存了个空数组」。
      expect(mounts.savesByThread.has("thread-1")).toBe(false);
      expect(audit.events.map((e) => e.kind)).toContain("skill-member-self-mount-attempt");
      expect(audit.events[0]?.principalId).toBe("u-x");
      expect(audit.events[0]?.detail).toContain(role);
    },
  );

  it("role=引导师 ⇒ 放行，且不写这条越权审计", async () => {
    const audit = collectAudit();
    const mounts = threadMountStore();
    const r = await mountSkillToThread(
      { ...baseInput, principalId: "u-f", role: "引导师" },
      { mounts, skills: skillPool(), audit, fingerprintOf: (m) => JSON.stringify(m) },
    );

    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(audit.events.map((e) => e.kind)).not.toContain("skill-member-self-mount-attempt");
    expect(mounts.savesByThread.get("thread-1")).toHaveLength(1);
  });

  it("观察者/未登录/未列出角色：默认无权限，同样拒绝（R5 收尾句）", async () => {
    const r = await mountSkillToThread(
      { ...baseInput, principalId: "u-o", role: "观察者" },
      { mounts: threadMountStore(), skills: skillPool(), audit: collectAudit(), fingerprintOf: (m) => JSON.stringify(m) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MEMBER_CANNOT_SELF_MOUNT");
  });

  it("拒绝发生在任何可见性判断之前——越权尝试不会因为 skill 不存在而换一个错误码", async () => {
    // 池子里根本没有这个 skill，但组员被拒的原因必须始终是权限，不是「skill 不存在」——
    // 否则越权尝试能靠错误码反推池子里有什么，是一次信息泄露。
    const r = await mountSkillToThread(
      { ...baseInput, principalId: "u-member", role: "组员", skillIds: ["sk-does-not-exist"] },
      { mounts: threadMountStore(), skills: visibility({}), audit: collectAudit(), fingerprintOf: (m) => JSON.stringify(m) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MEMBER_CANNOT_SELF_MOUNT");
  });
});
