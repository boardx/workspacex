/**
 * F66 · **硬删永久拒绝 + 内置不可删 + 恢复重新进可绑定池**
 * （契约 `hardDeleteSkill`/`restoreSkill`，UC-3.4 R3 分支 B 步骤 8-9、R6 AC3、R7、V7/V8）。
 *
 * 四组：
 *   ① 硬删永久拒绝：无论有没有引用，`evaluateHardDelete` 都不存在「允许」分支。
 *   ② 内置（`CC`）不可删：走独立错误码 `BUILTIN_NOT_DELETABLE`，与是否有引用无关。
 *   ③ 应用层 `hardDeleteSkill`：拒绝前仍返回一次完整的引用清单（R6 AC3 逐字）。
 *   ④ 恢复：`已停用 → 已启用` 重新进可绑定池，且这条路径**不重新过双重门禁**
 *      （V8；这条边此前在 `security-gate.ts` 里被 F61 的「已启用只能从待审核」
 *      挡死，F66 把它按 `skill-status.ts` 已经声明好的第二前驱补通）。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateHardDelete,
  type ReferenceSnapshot,
} from "../../../src/domain/skill/reference-enumeration";
import { hardDeleteSkill } from "../../../src/application/skill/hard-delete-skill";
import { restoreSkill } from "../../../src/application/skill/restore-skill";
import { authorizeStatusTransition } from "../../../src/domain/skill/security-gate";
import { canTransition } from "../../../src/domain/skill/skill-status";
import { collectAudit } from "../../support/skill-fakes";
import type {
  ReferenceEnumerationPort,
  ReferenceSnapshotStorePort,
  SkillSourcePort,
} from "../../../src/application/skill/ports";

function emptySnapshot(skillId: string): ReferenceSnapshot {
  return {
    referenceSnapshotId: "snap-0",
    skillId,
    inFlightProjects: [],
    templateBindings: [],
    agentMounts: [],
    asyncTaskId: null,
  };
}

function busySnapshot(skillId: string): ReferenceSnapshot {
  return {
    referenceSnapshotId: "snap-1",
    skillId,
    inFlightProjects: ["proj-1", "proj-2"],
    templateBindings: ["tpl-design-thinking"],
    agentMounts: ["agent-voice"],
    asyncTaskId: null,
  };
}

describe("① 硬删永久拒绝：函数签名上就没有「允许」分支", () => {
  it("零引用也一样被拒——「此刻没人用」不等于「删除是安全的」", () => {
    const verdict = evaluateHardDelete({ source: "自建", references: emptySnapshot("sk-idle") });
    expect(verdict.rejected).toBe(true);
    expect(verdict.code).toBe("HARD_DELETE_FORBIDDEN");
    expect(verdict.references).toEqual(emptySnapshot("sk-idle"));
  });

  it("存在引用（含进行中项目/蓝本/agent 挂载）时同样被拒，且不区分引用多寡", () => {
    const verdict = evaluateHardDelete({ source: "晋升生成", references: busySnapshot("sk-voice") });
    expect(verdict.rejected).toBe(true);
    expect(verdict.code).toBe("HARD_DELETE_FORBIDDEN");
    expect(verdict.references.inFlightProjects).toEqual(["proj-1", "proj-2"]);
  });

  it("TypeScript 类型上：`HardDeleteVerdict.rejected` 是字面量 `true`，不是 `boolean`", () => {
    const verdict = evaluateHardDelete({ source: "自建", references: emptySnapshot("sk-x") });
    // 编译期已经保证；这里补一条运行期断言防止有人把类型改宽后仍然「看起来对」。
    const rejectedLiteralTrue: true = verdict.rejected;
    expect(rejectedLiteralTrue).toBe(true);
  });
});

describe("② 内置（CC）不可删：独立错误码，与引用无关", () => {
  it("来源为 CC 的内置 skill，即使零引用也走 `BUILTIN_NOT_DELETABLE`（不是 `HARD_DELETE_FORBIDDEN`）", () => {
    const verdict = evaluateHardDelete({ source: "CC", references: emptySnapshot("sk-builtin") });
    expect(verdict.code).toBe("BUILTIN_NOT_DELETABLE");
  });

  it("CC 且有引用：仍然是 `BUILTIN_NOT_DELETABLE`——来源判据优先于引用判据", () => {
    const verdict = evaluateHardDelete({ source: "CC", references: busySnapshot("sk-builtin") });
    expect(verdict.code).toBe("BUILTIN_NOT_DELETABLE");
  });

  it("非 CC 来源不会误触发内置判据（画布来源、晋升生成来源都走通用拒绝码）", () => {
    expect(evaluateHardDelete({ source: "画布", references: emptySnapshot("s") }).code).toBe(
      "HARD_DELETE_FORBIDDEN",
    );
    expect(evaluateHardDelete({ source: "晋升生成", references: emptySnapshot("s") }).code).toBe(
      "HARD_DELETE_FORBIDDEN",
    );
  });
});

describe("③ 应用层 hardDeleteSkill：拒绝前仍返回一次完整引用清单", () => {
  function enumerationPort(snapshot: ReferenceSnapshot): ReferenceEnumerationPort {
    return {
      async inFlightProjects() {
        return snapshot.inFlightProjects;
      },
      async templateBindings() {
        return snapshot.templateBindings;
      },
      async agentMounts() {
        return snapshot.agentMounts;
      },
    };
  }
  function snapshotStore(): ReferenceSnapshotStorePort {
    let latest: ReferenceSnapshot | null = null;
    return {
      async save(s) {
        latest = s;
      },
      async loadLatest() {
        return latest;
      },
    };
  }
  function sourcePort(v: Awaited<ReturnType<SkillSourcePort["sourceOf"]>>): SkillSourcePort {
    return { async sourceOf() { return v; } };
  }

  it("有引用的 skill：硬删被拒，响应体带出完整的三类清单", async () => {
    const busy = busySnapshot("sk-voice");
    const result = await hardDeleteSkill(
      { skillId: "sk-voice", newSnapshotId: () => busy.referenceSnapshotId },
      { enumeration: enumerationPort(busy), snapshots: snapshotStore(), source: sourcePort("自建") },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("code" in result && result.code === "HARD_DELETE_FORBIDDEN").toBe(true);
    if ("references" in result) {
      expect(result.references.inFlightProjects).toEqual(["proj-1", "proj-2"]);
      expect(result.references.templateBindings).toEqual(["tpl-design-thinking"]);
      expect(result.references.agentMounts).toEqual(["agent-voice"]);
    } else {
      throw new Error("拒绝响应必须带引用清单（R6 AC3）");
    }
  });

  it("skill 不存在（来源查不到）⇒ `SKILL_NOT_FOUND`，不编一个假清单", async () => {
    const result = await hardDeleteSkill(
      { skillId: "sk-ghost", newSnapshotId: () => "snap-x" },
      { enumeration: enumerationPort(emptySnapshot("sk-ghost")), snapshots: snapshotStore(), source: sourcePort(null) },
    );
    expect(result).toEqual({ ok: false, code: "SKILL_NOT_FOUND" });
  });

  it("来源为 CC：即便零引用，走 `BUILTIN_NOT_DELETABLE`", async () => {
    const empty = emptySnapshot("sk-builtin");
    const result = await hardDeleteSkill(
      { skillId: "sk-builtin", newSnapshotId: () => empty.referenceSnapshotId },
      { enumeration: enumerationPort(empty), snapshots: snapshotStore(), source: sourcePort("CC") },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result) {
      expect(result.code).toBe("BUILTIN_NOT_DELETABLE");
    }
  });
});

describe("④ 恢复：已停用 → 已启用 重新进可绑定池，不重新过门禁", () => {
  it("`skill-status.ts` 的状态机里，这条边本就存在（`canTransition`）", () => {
    expect(canTransition("已停用", "已启用")).toBe(true);
  });

  it("`security-gate.ts` 放行这条边，且不要求任何门禁记录（gates 全 null 也通过）", () => {
    const verdict = authorizeStatusTransition({
      from: "已停用",
      to: "已启用",
      gates: { scan: null, methodologyReview: null, acknowledgedRiskItemIds: [] },
    });
    expect(verdict.allowed).toBe(true);
  });

  it("首次启用的唯一前驱依旧是「待审核」——恢复没有打开一条新的绕过路径", () => {
    const verdict = authorizeStatusTransition({
      from: "草稿",
      to: "已启用",
      gates: { scan: null, methodologyReview: null, acknowledgedRiskItemIds: [] },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("GATE_NOT_PASSED");
  });

  it("应用层 `restoreSkill`：状态转回「已启用」", async () => {
    const audit = collectAudit();
    const result = await restoreSkill(
      { skillId: "sk-voice", principalId: "u-maintainer" },
      { audit },
    );
    expect(result).toEqual({ ok: true, status: "已启用" });
    // 恢复是合法迁移，不是绕过尝试——不该写安全审计。
    expect(audit.events).toEqual([]);
  });
});
