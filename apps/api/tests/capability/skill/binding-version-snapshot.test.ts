/**
 * F63 · **每条绑定记 skill 版本，现场用锁定的版本、不因发新版而漂移**
 * （`contracts/skills/domain.md` I-8 / I-9，裁决 D-30；UC-3.2 E1）。
 *
 * I-9 自带断言方式，逐字：
 *   「项目 A 锁 v2 → 发布 v3 → 断言 A 解析出的**契约正文**仍是 v2 的 `contentHash`」
 *
 * ⚠ 注意判据落在 **`contentHash`** 上而不是版本号字符串上。只比版本号时，一个
 *   「按版本号取正文、但正文表被就地改过」的实现照样绿 —— 而那正是
 *   `SkillVersion.contentHash` 那句「发布后永不改变」要挡的东西。所以下面
 *   每一条都同时断言**解析出来的正文哈希**。
 *
 * ⇒ 四组：
 *   ① 锁版本：发新版后解析仍是旧版正文；`behindLatest` 只是提示。
 *   ② 记版本：一条不记 `versionId` 的 skill 绑定构造不出来（I-8 的入口）。
 *   ③ E1：skill 被停用 —— **进行中的项目继续用锁定版本**，模板侧被标记并挡住新套用。
 *      两侧口径不同，所以是两个字段，不是一个布尔。
 *   ④ 升级是**显式动作**：`upgradeBindingToVersion` 之后才换，且只换那一条。
 */
import { describe, expect, it } from "vitest";
import {
  applyTemplateToProject,
  referenceHealth,
  resolveBoundVersion,
  upgradeBindingToVersion,
  withBinding,
  type SkillVersionCatalog,
} from "../../../src/domain/skill/orchestration";
import { parseSlotRef, skillRefOf, type SegmentBinding } from "../../../src/domain/skill/binding-slot";
import { applyWorkflowTemplate } from "../../../src/application/skill/apply-workflow-template";
import { templateBindingFlags } from "../../../src/application/skill/apply-workflow-template";
import {
  binding,
  mixedSlotTemplate,
  orchestrationStore,
  templateStore,
  visibility,
} from "../../support/skill-fakes";

const instanceOwner = { level: "instance", projectId: "p-1" } as const;
const templateOwner = { level: "template", templateId: "tpl-design-thinking" } as const;

/** 目录：`sk-voice` 此刻生效的是 v2。三个版本各有自己的、发布后不变的正文哈希。 */
function catalogAtV2(): SkillVersionCatalog {
  return {
    "sk-voice": {
      skillId: "sk-voice",
      status: "已启用",
      currentVersionId: "v2",
      contentHashByVersion: { v1: "hash-v1", v2: "hash-v2" },
    },
  };
}

/** 同一个 skill 发布了 v3 之后的目录。**旧版正文原样保留**。 */
function catalogAtV3(): SkillVersionCatalog {
  return {
    "sk-voice": {
      skillId: "sk-voice",
      status: "已启用",
      currentVersionId: "v3",
      contentHashByVersion: { v1: "hash-v1", v2: "hash-v2", v3: "hash-v3" },
    },
  };
}

const lockedAtV2 = (): SegmentBinding =>
  binding({
    bindingId: "ib-0",
    agendaSegmentId: "seg-02",
    owner: instanceOwner,
    slot: { kind: "skill", skillId: "sk-voice", versionId: "v2" },
  });

describe("① I-9 / D-30：锁 v2 → 发布 v3 → 现场解析出的仍是 v2 的正文", () => {
  it("版本号与**正文哈希**都停在 v2", () => {
    const b = lockedAtV2();
    const before = resolveBoundVersion(b, catalogAtV2());
    expect(before?.versionId).toBe("v2");
    expect(before?.contentHash).toBe("hash-v2");
    expect(before?.behindLatest).toBe(false);

    // 后台发了 v3。绑定这一侧一个字节都没动。
    const after = resolveBoundVersion(b, catalogAtV3());
    expect(after?.versionId, "解析跟着目录漂到 v3 了").toBe("v2");
    expect(after?.contentHash, "版本号没漂但正文漂了").toBe("hash-v2");
  });

  it("`behindLatest` 是提示不是信号：它变 true，解析结果照旧", () => {
    const b = lockedAtV2();
    const after = resolveBoundVersion(b, catalogAtV3());
    expect(after?.behindLatest).toBe(true);
    expect(after?.latestVersionId).toBe("v3");
    // 提示与解析必须是两个字段。合成一个之后，「有新版」就等于「用新版」。
    expect(after?.versionId).not.toBe(after?.latestVersionId);
  });

  it("目录里根本没有这个 skill 时，解析不编一个版本出来", () => {
    const after = resolveBoundVersion(lockedAtV2(), {});
    expect(after?.versionId).toBe("v2");
    // 正文取不到就是取不到 —— 返回 null，而不是回退到「最新的那个」。
    expect(after?.contentHash).toBeNull();
    expect(after?.behindLatest).toBe(false);
  });

  it("非 skill 槽不走 skill 的版本快照（解析返回 null）", () => {
    const canvas = binding({
      bindingId: "ib-1",
      agendaSegmentId: "seg-02",
      owner: instanceOwner,
      slot: { kind: "canvas-template", canvasTemplateId: "hmw" },
    });
    expect(resolveBoundVersion(canvas, catalogAtV3())).toBeNull();
    expect(skillRefOf(canvas)).toBeNull();
  });

  it("套用模板时把版本一起抄进实例，此后目录怎么变都不影响这场项目", async () => {
    const templates = templateStore(mixedSlotTemplate());
    const orchestrations = orchestrationStore(null);
    const r = await applyWorkflowTemplate(
      { projectId: "p-1", workflowTemplateId: "tpl-design-thinking", principalId: "u", hostConfirmed: true },
      {
        templates,
        orchestrations,
        // ⚠ 可绑定池说「此刻生效的是 v3」，而模板绑定锁的是 v2。
        //   套用**照抄绑定里的 v2**，不去拿池子里的 v3 —— 这一条就是 D-30。
        skills: visibility({ "sk-voice": { status: "已启用", currentVersionId: "v3" } }),
        newBindingId: (i) => `ib-${i}`,
      },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;

    const bound = r.orchestration.bindings.find((b) => b.slot.kind === "skill")!;
    expect(skillRefOf(bound)).toEqual({ skillId: "sk-voice", versionId: "v2" });
    expect(resolveBoundVersion(bound, catalogAtV3())?.contentHash).toBe("hash-v2");
  });
});

describe("② I-8：一条不记版本的 skill 绑定构造不出来", () => {
  it("缺 versionId / 空 versionId 都被拒", () => {
    expect(parseSlotRef({ kind: "skill", skillId: "sk-voice" }).ok).toBe(false);
    expect(parseSlotRef({ kind: "skill", skillId: "sk-voice", versionId: "" }).ok).toBe(false);
    expect(parseSlotRef({ kind: "skill", skillId: "sk-voice", versionId: null }).ok).toBe(false);
  });

  it("套用产生的每一条 skill 绑定都带非空 versionId", () => {
    const applied = applyTemplateToProject({
      template: mixedSlotTemplate(),
      projectId: "p-1",
      newBindingId: (i) => `ib-${i}`,
    });
    const skillBindings = applied.bindings.filter((b) => b.slot.kind === "skill");
    // 断言「扫到了东西」——0 条时下面那个 every 恒真，这条断言会空转。
    expect(skillBindings.length).toBeGreaterThan(0);
    for (const b of skillBindings) {
      const ref = skillRefOf(b)!;
      expect(ref.versionId, `${b.bindingId} 只记了 skillId`).toBeTruthy();
    }
  });
});

describe("③ E1：skill 被停用，实例侧与模板侧的口径不一样", () => {
  const disabled: SkillVersionCatalog = {
    "sk-voice": {
      skillId: "sk-voice",
      status: "已停用",
      currentVersionId: "v2",
      contentHashByVersion: { v1: "hash-v1", v2: "hash-v2" },
    },
  };

  it("进行中的项目继续用它锁定的版本（现场不当场哑掉）", () => {
    const b = lockedAtV2();
    const health = referenceHealth(b, disabled);
    expect(health.usableNow, "后台一停用，正在进行的现场就断了").toBe(true);
    // 而且解析出来的仍是锁定版本的正文。
    expect(resolveBoundVersion(b, disabled)?.contentHash).toBe("hash-v2");
  });

  it("模板侧同一条绑定被标记，并挡住拿它去开新项目", () => {
    const tb = binding({
      bindingId: "tb-1",
      agendaSegmentId: "seg-02",
      owner: templateOwner,
      slot: { kind: "skill", skillId: "sk-voice", versionId: "v2" },
    });
    const health = referenceHealth(tb, disabled);
    expect(health.usableNow).toBe(false);
    expect(health.flag).toBe("引用了已停用的 skill");
    expect(health.blocksNewApply).toBe(true);
  });

  it("两侧口径确实不同 —— 合成一个布尔必然做错其中一边", () => {
    const inst = referenceHealth(lockedAtV2(), disabled);
    const tpl = referenceHealth(
      binding({
        bindingId: "tb-1",
        agendaSegmentId: "seg-02",
        owner: templateOwner,
        slot: { kind: "skill", skillId: "sk-voice", versionId: "v2" },
      }),
      disabled,
    );
    expect(inst.usableNow).not.toBe(tpl.usableNow);
    // 标记两侧都要有：实例侧照常跑，但界面得让人看见它引用了个停用的东西。
    expect(inst.flag).toBe("引用了已停用的 skill");
  });

  it("健康时不乱标（门控不能恒红）", () => {
    const health = referenceHealth(lockedAtV2(), catalogAtV3());
    expect(health).toEqual({ usableNow: true, flag: null, blocksNewApply: false });
  });

  it("模板侧的标记清单只列有问题的那几条", () => {
    const tpl = mixedSlotTemplate();
    const flags = templateBindingFlags(tpl, disabled);
    // 只有 tb-1 是 skill 槽且引用了停用的 skill；画布模板与 agent 产物不进这张表。
    expect(flags).toEqual([{ bindingId: "tb-1", flag: "引用了已停用的 skill" }]);
    expect(templateBindingFlags(tpl, catalogAtV3())).toEqual([]);
  });

  it("套用一个引用了停用 skill 的模板 ⇒ 明确失败，零写入", async () => {
    const templates = templateStore(mixedSlotTemplate());
    const orchestrations = orchestrationStore(null);
    const r = await applyWorkflowTemplate(
      { projectId: "p-1", workflowTemplateId: "tpl-design-thinking", principalId: "u", hostConfirmed: true },
      {
        templates,
        orchestrations,
        skills: visibility({ "sk-voice": { status: "已停用", currentVersionId: "v2" } }),
        newBindingId: (i) => `ib-${i}`,
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_NOT_ENABLED");
    expect(orchestrations.saves).toEqual([]);
  });
});

describe("④ 升级是显式动作，默认不自动跟随", () => {
  it("升级前后：只有被升的那一条换版本，别的绑定不动", () => {
    const applied = applyTemplateToProject({
      template: mixedSlotTemplate(),
      projectId: "p-1",
      newBindingId: (i) => `ib-${i}`,
    });
    const target = applied.bindings.find((b) => b.slot.kind === "skill")!;
    const othersBefore = applied.bindings.filter((b) => b.bindingId !== target.bindingId);

    const upgraded = withBinding(applied, upgradeBindingToVersion(target, "v3"));
    const now = upgraded.bindings.find((b) => b.bindingId === target.bindingId)!;
    expect(skillRefOf(now)).toEqual({ skillId: "sk-voice", versionId: "v3" });
    expect(resolveBoundVersion(now, catalogAtV3())?.contentHash).toBe("hash-v3");

    for (const before of othersBefore) {
      const after = upgraded.bindings.find((b) => b.bindingId === before.bindingId)!;
      expect(after.slot).toEqual(before.slot);
    }
  });

  it("升级是纯函数：原绑定对象没被就地改（历史快照仍可读）", () => {
    const b = lockedAtV2();
    const up = upgradeBindingToVersion(b, "v3");
    expect(skillRefOf(b)).toEqual({ skillId: "sk-voice", versionId: "v2" });
    expect(skillRefOf(up)).toEqual({ skillId: "sk-voice", versionId: "v3" });
    expect(up).not.toBe(b);
  });

  it("对非 skill 槽调用升级是空操作，而不是塞一个 versionId 进去", () => {
    const canvas = binding({
      bindingId: "ib-1",
      agendaSegmentId: "seg-02",
      owner: instanceOwner,
      slot: { kind: "canvas-template", canvasTemplateId: "hmw" },
    });
    const up = upgradeBindingToVersion(canvas, "v3");
    expect(up.slot).toEqual({ kind: "canvas-template", canvasTemplateId: "hmw" });
    expect("versionId" in up.slot).toBe(false);
  });
});
