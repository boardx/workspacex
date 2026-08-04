/**
 * #459 —— `disable-skill.ts` 的 `from` 必须来自库，不能来自调用方的假设。
 *
 * ## 被修的缺陷
 *
 * 改之前，`disable-skill.ts:50` 逐字写着 `from: "已启用"`，**不读 skill 的真实状态**。
 * 后果不是「错误码不准」：拿它去停用一个 `草稿`，`authorizeStatusTransition` 看到的是
 * 一条合法的 `已启用 → 已停用`，于是返回 `ok: true`，任何接在它后面的 repository
 * 都会**持久化一次非法状态迁移** —— 库里凭空多出一个从未过门禁、却已经历过「停用」的 skill。
 *
 * ## 反证（这条测试真的会红吗）
 *
 * 把 `from: input.currentStatus` 改回 `from: "已启用"`，本文件第一条用例立刻红：
 * 它会拿到 `ok: true`。这不是「实现前就写好了」——本文件是在修复之后补的，
 * 反证是靠**把修复回退**做出来的，PR 里贴了那次回退的实测输出。
 * 说成「测试先行」会是一句谎，而一条只在正确实现上绿过的断言，与没有断言不可区分。
 *
 * ⚠ 这条走 application 层而不是 HTTP：HTTP 那条路上，R7 的引用清单门
 *   （`REFERENCES_NOT_ENUMERATED`）在状态机**之前**就把请求挡住了，
 *   于是状态机那道门根本走不到，测不出这个缺陷。要测第二道门，必须先
 *   把第一道门喂过去 —— 这里用一个真实的、新鲜的快照 stub 做到。
 */
import { describe, expect, it } from "vitest";
import { disableSkill } from "../../src/application/skill/disable-skill";
import type { ReferenceSnapshot } from "../../src/domain/skill/reference-enumeration";
import type { SecurityAuditPort, ReferenceSnapshotStorePort } from "../../src/application/skill/ports";

const SKILL = "skill-contract-under-test";
const SNAPSHOT = "ref-snapshot-fresh";

/** 一份**新鲜的**空引用清单，好让 R7 那道门放行，把判定交给状态机。 */
const freshSnapshot: ReferenceSnapshot = {
  referenceSnapshotId: SNAPSHOT,
  skillId: SKILL,
  inFlightProjects: [],
  templateBindings: [],
  agentMounts: [],
  asyncTaskId: null,
};

const snapshots: ReferenceSnapshotStorePort = {
  save: async () => undefined,
  loadLatest: async () => freshSnapshot,
};

function recordingAudit(): SecurityAuditPort & { readonly events: unknown[] } {
  const events: unknown[] = [];
  return { events, record: async (event) => void events.push(event) };
}

const input = {
  skillId: SKILL,
  principalId: "u-actor",
  referenceSnapshotId: SNAPSHOT,
  mode: "drain" as const,
  archive: false,
  replacementSkillId: null,
};

describe("#459 停用读真实状态", () => {
  it("停用一个 `草稿` 被拒 —— 状态机里没有 `草稿 → 已停用` 这条边", async () => {
    const audit = recordingAudit();

    const result = await disableSkill({ ...input, currentStatus: "草稿" }, { snapshots, audit });

    // ★ 硬编码 `from: "已启用"` 时这里是 `ok: true` —— 那正是被修掉的缺陷。
    expect(result.ok).toBe(false);
    // `SKILL_VERSION_CHANGED`（这条边不存在），**不是** `GATE_NOT_PASSED`：
    // 后者只在 `to === "已启用"` 时产生，而停用的 `to` 是 `已停用`。
    expect(result.ok === false ? result.code : null).toBe("SKILL_VERSION_CHANGED");
    // I-23：「这条边不存在」是并发/手滑，不是绕过尝试，所以**不进安全审计**。
    expect(audit.events).toEqual([]);
  });

  it("停用一个 `待审核` 同样被拒（同一条边不存在）", async () => {
    const audit = recordingAudit();
    const result = await disableSkill({ ...input, currentStatus: "待审核" }, { snapshots, audit });
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.code : null).toBe("SKILL_VERSION_CHANGED");
  });

  it("停用一个 `已启用` 放行 —— 修复没有把合法路径一起堵死", async () => {
    const audit = recordingAudit();
    const result = await disableSkill({ ...input, currentStatus: "已启用" }, { snapshots, audit });

    expect(result.ok).toBe(true);
    expect(result.ok === true ? result.status : null).toBe("已停用");
    expect(audit.events).toEqual([]);
  });

  it("引用清单不新鲜时，第一道门就拒 —— 与状态无关", async () => {
    const audit = recordingAudit();
    const result = await disableSkill(
      { ...input, referenceSnapshotId: "some-older-snapshot", currentStatus: "已启用" },
      { snapshots, audit },
    );
    expect(result.ok === false ? result.code : null).toBe("REFERENCES_NOT_ENUMERATED");
  });
});
