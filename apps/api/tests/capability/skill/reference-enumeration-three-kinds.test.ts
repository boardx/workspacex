/**
 * F66 · **停用前置：引用枚举三类 + 空态可分辨 + 停用前置校验**
 * （契约 `listReferences`/`disableSkill`，UC-3.4 R3 分支 B 步骤 6、R6 AC4、R7）。
 *
 * 四组：
 *   ① 三类分别枚举，`listReferences` 用例把三类结果聚合进一份带 id 的清单并落库。
 *   ② 空态可分辨：三类真的都是零条（`isConfirmedEmpty`）≠ 异步部分结果。
 *   ③ R7「无清单不得停用」：`disableSkill` 校验 `referenceSnapshotId` 是不是最新一次。
 *   ④ 三类互不相交：一类挂了不该让断言退化成对同一个数组重复判断。
 */
import { describe, expect, it } from "vitest";
import { listReferences } from "../../../src/application/skill/list-references";
import { disableSkill } from "../../../src/application/skill/disable-skill";
import {
  hasAnyReference,
  isConfirmedEmpty,
  isReferenceSnapshotFresh,
  type ReferenceSnapshot,
} from "../../../src/domain/skill/reference-enumeration";
import { collectAudit } from "../../support/skill-fakes";
import type {
  ReferenceEnumerationPort,
  ReferenceSnapshotStorePort,
} from "../../../src/application/skill/ports";

function enumerationPort(data: {
  inFlight?: readonly string[];
  templates?: readonly string[];
  agents?: readonly string[];
}): ReferenceEnumerationPort {
  return {
    async inFlightProjects() {
      return data.inFlight ?? [];
    },
    async templateBindings() {
      return data.templates ?? [];
    },
    async agentMounts() {
      return data.agents ?? [];
    },
  };
}

function snapshotStore(): ReferenceSnapshotStorePort & { readonly saved: ReferenceSnapshot[] } {
  const saved: ReferenceSnapshot[] = [];
  let latest: ReferenceSnapshot | null = null;
  return {
    saved,
    async save(s) {
      saved.push(s);
      latest = s;
    },
    async loadLatest() {
      return latest;
    },
  };
}

describe("① 三类分别枚举并聚合成一份清单", () => {
  it("三类各自来自各自的端口方法，互不相交地拼进同一份清单", async () => {
    const enumeration = enumerationPort({
      inFlight: ["proj-1", "proj-2"],
      templates: ["tpl-design-thinking"],
      agents: ["agent-voice"],
    });
    const snapshots = snapshotStore();
    const result = await listReferences(
      { skillId: "sk-voice", newSnapshotId: () => "snap-1" },
      { enumeration, snapshots },
    );

    expect(result).toEqual({
      referenceSnapshotId: "snap-1",
      skillId: "sk-voice",
      inFlightProjects: ["proj-1", "proj-2"],
      templateBindings: ["tpl-design-thinking"],
      agentMounts: ["agent-voice"],
      asyncTaskId: null,
    });
    expect(hasAnyReference(result)).toBe(true);
  });

  it("枚举结果**落库**，供后续停用校验引用（不是纯只读、算完即丢）", async () => {
    const enumeration = enumerationPort({});
    const snapshots = snapshotStore();
    const r = await listReferences(
      { skillId: "sk-voice", newSnapshotId: () => "snap-2" },
      { enumeration, snapshots },
    );
    expect(snapshots.saved).toEqual([r]);
  });
});

describe("② 空态可分辨：真的没有 ≠ 还没查完", () => {
  it("三类都是零条且非异步 ⇒ 真·空态", async () => {
    const snapshots = snapshotStore();
    const r = await listReferences(
      { skillId: "sk-idle", newSnapshotId: () => "snap-empty" },
      { enumeration: enumerationPort({}), snapshots },
    );
    expect(hasAnyReference(r)).toBe(false);
    expect(isConfirmedEmpty(r)).toBe(true);
  });

  it("`asyncTaskId` 非空时，即便三类当前都是空数组，也**不是**确认空态（部分结果）", () => {
    const partial: ReferenceSnapshot = {
      referenceSnapshotId: "snap-partial",
      skillId: "sk-big-org",
      inFlightProjects: [],
      templateBindings: [],
      agentMounts: [],
      asyncTaskId: "task-42",
    };
    expect(hasAnyReference(partial)).toBe(false);
    expect(isConfirmedEmpty(partial)).toBe(false); // 关键：不能把「还没查完」读成「没有引用」
  });

  it("有任何一类非空 ⇒ 一定不是确认空态", () => {
    const withOne: ReferenceSnapshot = {
      referenceSnapshotId: "snap-x",
      skillId: "sk-voice",
      inFlightProjects: [],
      templateBindings: ["tpl-1"],
      agentMounts: [],
      asyncTaskId: null,
    };
    expect(isConfirmedEmpty(withOne)).toBe(false);
  });
});

describe("③ R7：无清单不得停用——referenceSnapshotId 必须是最新一次", () => {
  it("从未枚举过（没有任何快照）⇒ 停用被拒 `REFERENCES_NOT_ENUMERATED`", async () => {
    const snapshots = snapshotStore();
    const audit = collectAudit();
    const result = await disableSkill(
      {
        skillId: "sk-voice",
        principalId: "u-maintainer",
        referenceSnapshotId: "snap-never-existed",
        mode: "drain",
        archive: true,
        replacementSkillId: null,
        // #459：本条在 R7 那道门就返回了，状态机根本走不到；字段是类型要求。
        currentStatus: "已启用",
      },
      { snapshots, audit },
    );
    expect(result).toEqual({ ok: false, code: "REFERENCES_NOT_ENUMERATED" });
  });

  it("带一个**过期**的 referenceSnapshotId（不是最新一次）⇒ 同样被拒", async () => {
    const snapshots = snapshotStore();
    await snapshots.save({
      referenceSnapshotId: "snap-old",
      skillId: "sk-voice",
      inFlightProjects: [],
      templateBindings: [],
      agentMounts: [],
      asyncTaskId: null,
    });
    // 又枚举了一次，产生了更新的一份——`snap-old` 从此不再是「最新」。
    await snapshots.save({
      referenceSnapshotId: "snap-new",
      skillId: "sk-voice",
      inFlightProjects: ["proj-9"],
      templateBindings: [],
      agentMounts: [],
      asyncTaskId: null,
    });
    const audit = collectAudit();
    const result = await disableSkill(
      {
        skillId: "sk-voice",
        principalId: "u-maintainer",
        referenceSnapshotId: "snap-old",
        mode: "drain",
        archive: true,
        replacementSkillId: null,
        currentStatus: "已启用",
      },
      { snapshots, audit },
    );
    expect(result).toEqual({ ok: false, code: "REFERENCES_NOT_ENUMERATED" });
  });

  it("带**最新**一次的 referenceSnapshotId ⇒ 停用放行，状态转 `已停用`", async () => {
    const snapshots = snapshotStore();
    await snapshots.save({
      referenceSnapshotId: "snap-current",
      skillId: "sk-voice",
      inFlightProjects: ["proj-1"],
      templateBindings: [],
      agentMounts: [],
      asyncTaskId: null,
    });
    const audit = collectAudit();
    const result = await disableSkill(
      {
        skillId: "sk-voice",
        principalId: "u-maintainer",
        referenceSnapshotId: "snap-current",
        mode: "drain",
        archive: true,
        replacementSkillId: null,
        // #459：`from` 现在来自库，不再硬编码成 `已启用`。这条用例测的是
        // 「清单最新 ⇒ R7 那道门放行」，所以它要的正是一个**本就可停用**的
        // 状态；写死 `已启用` 在这里是**测试夹具**，不是被修掉的那个假设。
        currentStatus: "已启用",
      },
      { snapshots, audit },
    );
    expect(result).toEqual({ ok: true, status: "已停用", archived: true });
  });

  it("`isReferenceSnapshotFresh` 是这条校验的领域内核，独立可断言", () => {
    const latest: ReferenceSnapshot = {
      referenceSnapshotId: "snap-latest",
      skillId: "sk-voice",
      inFlightProjects: [],
      templateBindings: [],
      agentMounts: [],
      asyncTaskId: null,
    };
    expect(isReferenceSnapshotFresh("snap-latest", latest)).toBe(true);
    expect(isReferenceSnapshotFresh("snap-stale", latest)).toBe(false);
  });
});

describe("④ 三类互不相交：断言必须逐类，不能糊成一句「有没有引用」", () => {
  it("只有 agent 挂载非空时，其余两类各自仍是空数组（不是同一份数据的三个别名）", async () => {
    const r = await listReferences(
      { skillId: "sk-voice", newSnapshotId: () => "snap-agent-only" },
      { enumeration: enumerationPort({ agents: ["agent-1"] }), snapshots: snapshotStore() },
    );
    expect(r.agentMounts).toEqual(["agent-1"]);
    expect(r.inFlightProjects).toEqual([]);
    expect(r.templateBindings).toEqual([]);
  });
});
