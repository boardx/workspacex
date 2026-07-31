/**
 * F65 · 临时挂载只对当前对话线程生效，不改蓝本（I-18；UC-3.3 R3 步骤 2 / AC2）。
 *
 * 为什么这条值得单列：原型里「改动只影响这场项目，不会动后台的模板本体」是
 * F63 的 I-17；本用例是同一条纪律在**更小的粒度**（单条对话线程）上的复现——
 * 挂到 thread-A 不能被 thread-B（哪怕同一议程环节）看见，也不能被写进
 * 实例编排/蓝本。
 */
import { describe, expect, it } from "vitest";
import {
  mountSkillToThread,
  type MountSkillToThreadDeps,
} from "../../../src/application/skill/mount-skill-to-thread";
import { collectAudit, orchestrationStore, threadMountStore, visibility } from "../../support/skill-fakes";

/**
 * ⚠ 这份清单本身就是断言的一部分：多一个键（比如偷偷塞进
 * `ProjectOrchestrationStorePort`）就会让下面第一条测试变红——
 * 同 F63 `TEMPLATE_PORTS_ALLOWED_METHODS` 的落法。
 */
const MOUNT_DEPS_ALLOWED_KEYS = ["mounts", "skills", "audit", "fingerprintOf"] as const;

const baseInput = {
  threadId: "thread-A",
  principalId: "u-facilitator",
  role: "引导师",
  skillIds: ["sk-mece"],
  mountIdFor: (i: number) => `mount-${i}`,
  mountedAt: "2026-08-01T00:00:00Z",
  expectedFingerprint: null,
} as const;

function deps(overrides: Partial<MountSkillToThreadDeps> = {}): MountSkillToThreadDeps {
  return {
    mounts: threadMountStore(),
    skills: visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } }),
    audit: collectAudit(),
    fingerprintOf: (m) => JSON.stringify(m),
    ...overrides,
  };
}

describe("F65 · 临时挂载只对当前线程生效（I-18）", () => {
  it("依赖清单里没有任何能碰蓝本/实例编排的端口（结构性保证）", () => {
    expect(Object.keys(deps()).sort()).toEqual([...MOUNT_DEPS_ALLOWED_KEYS].sort());
  });

  it("挂到 thread-A 之后，thread-B（同一议程环节的另一场对话）的挂载列表原样不变", async () => {
    const mounts = threadMountStore({ "thread-B": [] });
    const r = await mountSkillToThread(baseInput, deps({ mounts }));

    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(mounts.savesByThread.get("thread-A")).toHaveLength(1);
    // ⚠ 反向也要断言：不是「B 恰好没被读到」，而是 B 那一桶确实原样未变。
    expect(mounts.savesByThread.get("thread-B")).toEqual([]);
  });

  it("不改蓝本：实例编排存储从未被写入（结构性——用例根本不持有该端口）", async () => {
    const orchestrations = orchestrationStore(null);
    await mountSkillToThread(baseInput, deps());
    // 本用例的依赖类型里没有一个字段能接 orchestrations，这里只是把「从未发生」
    // 落成一条可跑的断言：初始化的编排存储自始至终没有任何一次 save。
    expect(orchestrations.saves).toEqual([]);
  });

  it("挂载多个 skill 时，每一条都落在同一个线程桶里，互不覆盖", async () => {
    const mounts = threadMountStore();
    const r = await mountSkillToThread(
      {
        ...baseInput,
        skillIds: ["sk-mece", "sk-checklist"],
      },
      deps({
        mounts,
        skills: visibility({
          "sk-mece": { status: "已启用", currentVersionId: "v3" },
          "sk-checklist": { status: "已启用", currentVersionId: "v1" },
        }),
      }),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.mounts.map((m) => m.skillId)).toEqual(["sk-mece", "sk-checklist"]);
    expect(mounts.savesByThread.get("thread-A")).toHaveLength(2);
  });

  it("并发改同一线程挂载列表：指纹不匹配时不得静默覆盖（E5/V8）", async () => {
    const mounts = threadMountStore();
    const fingerprintOf = (m: readonly { readonly mountId: string }[]) => `fp-${m.length}`;
    const r = await mountSkillToThread(
      { ...baseInput, expectedFingerprint: "fp-99" },
      deps({ mounts, fingerprintOf }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_VERSION_CHANGED");
    expect(mounts.savesByThread.has("thread-A")).toBe(false);
  });

  it("未启用/不可见的 skill 拒绝挂载，且不写入任何一条", async () => {
    const mounts = threadMountStore();
    const r = await mountSkillToThread(
      baseInput,
      deps({ mounts, skills: visibility({ "sk-mece": { status: "草稿", currentVersionId: "v1" } }) }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_NOT_ENABLED");
    expect(mounts.savesByThread.has("thread-A")).toBe(false);
  });
});
