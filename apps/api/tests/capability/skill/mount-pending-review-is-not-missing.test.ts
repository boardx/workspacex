/**
 * #552 —— **一条待审核的 skill 挂不上时，必须说「还没启用」，不能说「不存在」。**
 *
 * ## 这条测试守的是一个「条件变了、注释没变」的缺陷
 *
 * `skill-mount.controller.ts` 的可见性适配原本写着：
 *
 * ```ts
 * if (row.currentVersionId === null) return null;   // ⇒ 调用方折成 SKILL_NOT_FOUND
 * ```
 *
 * 注释解释「实践中这一支到不了 —— `已启用` 蕴含有生效版本」。**那句话当时为真**：
 * #552 之前**没有任何产品路径能让一个 skill 离开草稿**（`SKILLS_FORBIDDEN_ROUTES`
 * 禁止直达启用路由，而 `reviewSkillVersion` 没有 HTTP 边界），所以挂得上的只有夹具
 * 种出来的那条已启用 skill，永远碰不到这一支。
 *
 * #552 把那条路径补上之后，条件变了：**未获批准的 skill 恒 `currentVersionId === null`**
 * （#459 起草稿刻意不填生效版本，理由见 `saveDraft`）。于是使用者去挂自己刚提交评审的
 * skill，会被告知「这个 skill **不存在**」—— 而它明明列在他自己的目录里。
 * 他会以为自己看错了，而不是去走门禁。
 *
 * ## ⚠ 断的是**错误码**，不是「有没有被拒」
 *
 * 两种实现都会拒绝，都返回 `ok: false`；只写 `expect(r.ok).toBe(false)` 的测试
 * 在缺陷存在时**照样绿**。可分辨的只有那个码，所以这里断码，并且**同时**钉住
 * 它不是 `SKILL_NOT_FOUND` —— 后者正是缺陷的那个取值。
 */
import { describe, expect, it } from "vitest";
import { mountSkillToThread } from "../../../src/application/skill/mount-skill-to-thread";
import { collectAudit, threadMountStore, visibility } from "../../support/skill-fakes";

const baseInput = {
  threadId: "thread-552",
  principalId: "u-facilitator",
  authorization: { allowed: true, projectId: "p-1", projectRole: "facilitator", decisionId: "d-1" } as const,
  mountIdFor: (i: number) => `mount-${i}`,
  mountedAt: "2026-08-05T00:00:00Z",
  expectedFingerprint: null,
} as const;

const deps = () => ({
  mounts: threadMountStore(),
  audit: collectAudit(),
  fingerprintOf: (m: unknown) => JSON.stringify(m),
});

describe("#552 · 待审核/草稿的 skill 挂不上时说的是「还没启用」", () => {
  it.each([
    ["待审核", "刚提交进人工门禁的那一版"],
    ["草稿", "建出来就没动过的那一版"],
  ] as const)(
    "status=%s（%s）且没有生效版本 ⇒ SKILL_NOT_ENABLED（**不是** SKILL_NOT_FOUND）",
    async (status, _shape) => {
      const d = deps();
      const r = await mountSkillToThread(
        { ...baseInput, skillIds: ["sk-pending"] },
        {
          ...d,
          // ⚠ `currentVersionId: null` 是**真实形态**，不是为了触发分支编出来的：
          //   #459 的 `saveDraft` 逐字把草稿的 `current_version_id` 留空，
          //   而只有 `releaseVersion`（approve 分支）会把它填上。
          skills: visibility({ "sk-pending": { status, currentVersionId: null } }),
        },
      );

      expect(r.ok).toBe(false);
      if (r.ok) return;
      // ★ 本条用例的全部意义在这两行：拒绝**得说对理由**。
      expect(r.code).toBe("SKILL_NOT_ENABLED");
      expect(r.code).not.toBe("SKILL_NOT_FOUND");
      expect(r.reason).toContain(status);
      // 拒绝之后一行都没写。
      expect(d.mounts.savesByThread.has("thread-552")).toBe(false);
    },
  );

  it("配对断言：同一条路径上，已启用且有生效版本的挂得上（否则上面两条可能是空转）", async () => {
    const d = deps();
    const r = await mountSkillToThread(
      { ...baseInput, skillIds: ["sk-enabled"] },
      { ...d, skills: visibility({ "sk-enabled": { status: "已启用", currentVersionId: "v1" } }) },
    );

    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    // 「当时挂的是哪一版」是真值，不是空串 —— 那正是原来那条 null 判定要护住的东西。
    expect(r.mounts[0]?.versionId).toBe("v1");
  });

  it("真正不存在（可见性范围外）仍然是 SKILL_NOT_FOUND —— 两者没有被合并", async () => {
    const d = deps();
    const r = await mountSkillToThread(
      { ...baseInput, skillIds: ["sk-invisible"] },
      { ...d, skills: visibility({}) },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // I-14：不存在与范围外同一出口，且**不泄露存在性**。这一条没有被本次改动动过。
    expect(r.code).toBe("SKILL_NOT_FOUND");
  });

  /**
   * 🔴 数据不一致的兜底：`已启用` 却没有生效版本。
   *
   * 正常不可达（`releaseVersion` 在**同一个事务**里置 `state='已生效'` 与
   * `current_version_id`），但这条蕴含关系靠的是另一个文件里的事务边界、不是类型系统。
   * 它哪天被拆成两次写入，这里要以一个说得出口的失败告终，
   * **而不是把一个空版本号写进挂载记录** —— 那会让复盘时「当时挂的是哪一版」永久不可答。
   */
  it("🔴 已启用却没有生效版本 ⇒ 拒绝，不写空版本号进挂载记录", async () => {
    const d = deps();
    const r = await mountSkillToThread(
      { ...baseInput, skillIds: ["sk-broken"] },
      { ...d, skills: visibility({ "sk-broken": { status: "已启用", currentVersionId: null } }) },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_NOT_ENABLED");
    expect(r.reason).toContain("没有生效版本");
    expect(d.mounts.savesByThread.has("thread-552")).toBe(false);
  });
});
