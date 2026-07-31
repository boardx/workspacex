/**
 * F65 · 临时挂载与蓝本绑定「来源可区分」；摘除不回溯历史消息角标
 * （UC-3.3 R7「必须与蓝本绑定在来源上可区分」/ I-19 / AC3）。
 *
 * ⚠ 可区分是**结构性的**（来自两个互不相交的存储面/字段集），不是靠一个
 * `source: "temp"` 字符串标签——同 `binding-slot.ts` 「刻意没有 label 字段」
 * 的落法：一旦允许一个装饰性字符串字段存在，下游迟早会拿它做判断，
 * 而那正是「糊成一个字符串」的复活形态。
 */
import { describe, expect, it } from "vitest";
import { mountSkillToThread } from "../../../src/application/skill/mount-skill-to-thread";
import { unmountSkillFromThread } from "../../../src/application/skill/unmount-skill-from-thread";
import { tagMessage, type MessageSkillTag } from "../../../src/domain/skill/thread-mount";
import { skillRefOf } from "../../../src/domain/skill/binding-slot";
import { binding, collectAudit, threadMountStore, visibility } from "../../support/skill-fakes";

const MOUNT_FIELDS = ["mountId", "threadId", "skillId", "versionId", "mountedAt", "removedAt"];

async function mountOne(threadId: string, mounts = threadMountStore()) {
  const r = await mountSkillToThread(
    {
      threadId,
      principalId: "u-f",
      role: "引导师",
      skillIds: ["sk-mece"],
      mountIdFor: (i) => `mount-${i}`,
      mountedAt: "2026-08-01T00:00:00Z",
      expectedFingerprint: null,
    },
    {
      mounts,
      skills: visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } }),
      audit: collectAudit(),
      fingerprintOf: (m) => JSON.stringify(m),
    },
  );
  if (!r.ok) throw new Error(`fixture 挂载失败：${r.code}`);
  return { mounts, mount: r.mounts[0]! };
}

describe("F65 · 临时挂载与蓝本绑定：字段集互不相交", () => {
  it("ThreadSkillMount 恰有这六个字段，且没有任何绑定条目的字段", async () => {
    const { mount } = await mountOne("thread-1");
    expect(Object.keys(mount).sort()).toEqual([...MOUNT_FIELDS].sort());
    expect("bindingId" in mount).toBe(false);
    expect("agendaSegmentId" in mount).toBe(false);
    expect("owner" in mount).toBe(false);
  });

  it("反向：蓝本绑定条目没有 mountId/threadId——两支主键字段互斥非空", () => {
    const segBound = binding({
      bindingId: "tb-1",
      agendaSegmentId: "seg-02",
      owner: { level: "instance", projectId: "proj-1" },
      slot: { kind: "skill", skillId: "sk-mece", versionId: "v2" },
    });
    expect("mountId" in segBound).toBe(false);
    expect("threadId" in segBound).toBe(false);
    expect(skillRefOf(segBound)).toEqual({ skillId: "sk-mece", versionId: "v2" });
  });

  it("同一个 skill 既被蓝本绑定又被临时挂载：两条记录独立共存，互不覆盖", async () => {
    // 蓝本绑定锁的是套用/换绑当时的版本（v2）——I-9 同一条纪律；
    // 临时挂载拿的是**此刻**的生效版本（v3，来自 SkillVisibilityPort.currentVersionId）。
    const segBound = binding({
      bindingId: "tb-1",
      agendaSegmentId: "seg-02",
      owner: { level: "instance", projectId: "proj-1" },
      slot: { kind: "skill", skillId: "sk-mece", versionId: "v2" },
    });

    const { mounts, mount } = await mountOne("thread-1");

    expect(segBound.slot.kind === "skill" ? segBound.slot.versionId : null).toBe("v2");
    expect(mount.versionId).toBe("v3");
    // 两条记录活在两个互不相交的存储面：一个在（假设的）实例编排的 bindings 数组里，
    // 一个在 ThreadMountStorePort 的桶里——本测试没有、也不需要一个能同时改写两者的接口。
    expect(mounts.savesByThread.get("thread-1")?.[0]?.skillId).toBe("sk-mece");
  });
});

describe("F65 · 摘除不回溯历史消息角标（I-19/AC3）", () => {
  it("摘掉挂载后，此前用它生成的消息角标原样保留", async () => {
    const { mounts, mount } = await mountOne("thread-1");

    let tags: readonly MessageSkillTag[] = [];
    tags = tagMessage(tags, {
      messageId: "msg-1",
      threadId: "thread-1",
      skillId: mount.skillId,
      versionId: mount.versionId,
    });
    const tagsBeforeUnmount = tags;

    const r = await unmountSkillFromThread(
      { threadId: "thread-1", mountId: mount.mountId, removedAt: "2026-08-01T01:00:00Z" },
      { mounts },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);

    // `unmountSkillFromThread` 的依赖清单里没有任何端口指向 `tags`——
    // 这里把「结构上碰不到」落成一条可跑的断言：引用与内容都原样未变。
    expect(tags).toBe(tagsBeforeUnmount);
    expect(tags).toEqual([
      { messageId: "msg-1", threadId: "thread-1", skillId: "sk-mece", versionId: "v3" },
    ]);
  });

  it("摘除是打时间戳，不是删行：挂载记录本身仍在，只是 removedAt 非空", async () => {
    const { mounts, mount } = await mountOne("thread-1");

    await unmountSkillFromThread(
      { threadId: "thread-1", mountId: mount.mountId, removedAt: "2026-08-01T01:00:00Z" },
      { mounts },
    );

    const stored = mounts.savesByThread.get("thread-1");
    expect(stored).toHaveLength(1);
    expect(stored?.[0]?.removedAt).toBe("2026-08-01T01:00:00Z");
    expect(stored?.[0]?.mountId).toBe(mount.mountId);
  });

  it("摘除不存在的 mountId 时明确拒绝，不静默生成一条空成功", async () => {
    const mounts = threadMountStore();
    const r = await unmountSkillFromThread(
      { threadId: "thread-1", mountId: "no-such-mount", removedAt: "t" },
      { mounts },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_NOT_FOUND");
  });
});
