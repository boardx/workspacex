/**
 * F63 · **混合槽可区分**（`contracts/skills/domain.md` I-15 / UC-3.2 R3 步骤 3）。
 *
 * I-15 自带断言方式，逐字：
 *   「断言绑定行**可按 `slotKind` 分别取出** skill / 画布模板 / agent 产物，
 *    且**各自主键字段互斥非空**」
 *
 * ⇒ 本文件断言的是**性质**不是数量：
 *   ① 三支能分别取出，且取出来的东西带着**各自的**主键（不是同一个字符串）；
 *   ② 三支的载荷字段名两两不相交 —— 「互斥」这半句；
 *   ③ 越界写入被拒（往 skill 槽塞画布模板 ⇒ `SLOT_KIND_MISMATCH`）；
 *   ④ **同名不同类**：三条绑定人类可读名全一样时，仍然分得开。
 *      这一条是专门造来打「数数量」的：`toHaveLength(3)` 在一个
 *      把三者存成同一个字符串的实现上同样是绿的。
 */
import { describe, expect, it } from "vitest";
import { skills } from "@repo/contracts";
import {
  BINDING_SLOT_KINDS,
  BINDING_TRIGGERS,
  CONTRACT_UNTYPED_BINDING_FIELDS,
  DELIVER_ROLES,
  SKILL_PER_SEGMENT_HINT_THRESHOLD,
  SLOT_PAYLOAD_KEYS,
  bindingWarnings,
  bindingsOfKind,
  isBindingTrigger,
  isDeliverRole,
  parseSlotRef,
  skillRefOf,
  type SegmentBinding,
} from "../../../src/domain/skill/binding-slot";
import { upsertSegmentBinding } from "../../../src/application/skill/upsert-segment-binding";
import { orchestrationFingerprint } from "../../../src/domain/skill/orchestration";
import { binding, orchestrationStore, visibility } from "../../support/skill-fakes";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO = fileURLToPath(new URL("../../../../..", import.meta.url));
const owner = { level: "instance", projectId: "p-1" } as const;

/** 三条绑定，**人类可读名全叫「hmw」** —— 唯一的区别只在数据模型里。 */
function sameNameDifferentKinds(): readonly SegmentBinding[] {
  return [
    binding({
      bindingId: "b-1",
      agendaSegmentId: "seg-02",
      owner,
      slot: { kind: "skill", skillId: "hmw", versionId: "v2" },
    }),
    binding({
      bindingId: "b-2",
      agendaSegmentId: "seg-02",
      owner,
      slot: { kind: "canvas-template", canvasTemplateId: "hmw" },
    }),
    binding({
      bindingId: "b-3",
      agendaSegmentId: "seg-02",
      owner,
      slot: { kind: "agent-output", agentId: "hmw", outputKey: "hmw" },
    }),
  ];
}

describe("槽类型是封闭三值，且与契约同源（不是手抄的第二份）", () => {
  it("取值集合等于契约的 `SlotKind`", () => {
    // 集合相等而不是长度相等：`toHaveLength(3)` 在
    // {skill, canvas-template, 画布模板} 上同样绿。
    expect(new Set(BINDING_SLOT_KINDS)).toEqual(new Set(skills.SlotKind.options));
    expect(new Set(BINDING_SLOT_KINDS)).toEqual(
      new Set(["skill", "canvas-template", "agent-output"]),
    );
  });

  it("未声明的槽类型进不来", () => {
    for (const bad of ["canvas", "skills", "", "SKILL", "画布模板"]) {
      const r = parseSlotRef({ kind: bad, skillId: "s", versionId: "v" });
      expect(r.ok, `${bad} 不该被接受为槽类型`).toBe(false);
      if (!r.ok) expect(r.code).toBe("SLOT_KIND_MISMATCH");
    }
  });
});

describe("I-15 ①②：三支能分别取出，且主键字段互斥", () => {
  it("同名三条绑定仍然分得开，各自带着自己的主键", () => {
    const bs = sameNameDifferentKinds();

    const asSkill = bindingsOfKind(bs, "skill");
    const asCanvas = bindingsOfKind(bs, "canvas-template");
    const asAgent = bindingsOfKind(bs, "agent-output");

    // 断言的是**性质**：取出来的那一条带的是 skill 的主键 ＋ 版本，
    // 而不是「取出来了一条」。
    expect(asSkill.map((b) => b.bindingId)).toEqual(["b-1"]);
    expect(asSkill[0]?.slot.skillId).toBe("hmw");
    expect(asSkill[0]?.slot.versionId).toBe("v2");

    expect(asCanvas.map((b) => b.bindingId)).toEqual(["b-2"]);
    expect(asCanvas[0]?.slot.canvasTemplateId).toBe("hmw");
    // 画布模板槽**没有版本这一说**（它的版本归 07-canvas）。
    expect("versionId" in asCanvas[0]!.slot).toBe(false);

    expect(asAgent.map((b) => b.bindingId)).toEqual(["b-3"]);
    expect(asAgent[0]?.slot.agentId).toBe("hmw");
    expect(asAgent[0]?.slot.outputKey).toBe("hmw");
  });

  it("`skillRefOf` 对非 skill 支返回 null —— 「不是 skill」与「skill 但没记版本」不许同形", () => {
    const [sk, canvas, agent] = sameNameDifferentKinds();
    expect(skillRefOf(sk!)).toEqual({ skillId: "hmw", versionId: "v2" });
    expect(skillRefOf(canvas!)).toBeNull();
    expect(skillRefOf(agent!)).toBeNull();
  });

  it("三支的载荷字段名两两不相交（「互斥非空」那半句）", () => {
    const pairs: [string, string][] = [
      ["skill", "canvas-template"],
      ["skill", "agent-output"],
      ["canvas-template", "agent-output"],
    ];
    for (const [a, b] of pairs) {
      const ka = new Set<string>(SLOT_PAYLOAD_KEYS[a as keyof typeof SLOT_PAYLOAD_KEYS]);
      const overlap = SLOT_PAYLOAD_KEYS[b as keyof typeof SLOT_PAYLOAD_KEYS].filter((k) =>
        ka.has(k),
      );
      expect(overlap, `${a} 与 ${b} 共用了字段 ${overlap.join(",")}：那就是糊成一行的入口`).toEqual(
        [],
      );
    }
    // 反过来也钉住：字段表必须覆盖三支，少一支就等于漏检一类越界。
    expect(new Set(Object.keys(SLOT_PAYLOAD_KEYS))).toEqual(new Set(BINDING_SLOT_KINDS));
  });

  it("三支的实际载荷对象，键集合与字段表逐字一致", () => {
    // 字段表是给 `parseSlotRef` 用的判据；它与真实对象一旦漂移，越界检测就形同虚设。
    for (const b of sameNameDifferentKinds()) {
      const keys = Object.keys(b.slot).filter((k) => k !== "kind");
      expect(new Set(keys)).toEqual(new Set(SLOT_PAYLOAD_KEYS[b.slot.kind]));
    }
  });
});

describe("I-15 ③：越界写入被拒，不是「多余字段忽略掉」", () => {
  it("skill 槽带画布模板主键 ⇒ SLOT_KIND_MISMATCH", () => {
    const r = parseSlotRef({
      kind: "skill",
      skillId: "sk-1",
      versionId: "v1",
      canvasTemplateId: "hmw",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SLOT_KIND_MISMATCH");
    expect(r.reason).toContain("canvasTemplateId");
  });

  it("画布模板槽带 skillId ⇒ 同样被拒（反方向也要挡）", () => {
    const r = parseSlotRef({ kind: "canvas-template", canvasTemplateId: "hmw", skillId: "sk-1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SLOT_KIND_MISMATCH");
  });

  it("agent 产物槽缺 outputKey ⇒ 被拒（载荷不齐 ≠ 一个空字符串）", () => {
    const r = parseSlotRef({ kind: "agent-output", agentId: "scout" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("outputKey");
  });

  it("I-8 在入口：skill 槽缺 versionId ⇒ 连构造都构造不出来", () => {
    const r = parseSlotRef({ kind: "skill", skillId: "sk-1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("versionId");
    // 空串也不行：一条 `versionId = ""` 的绑定在库里长得像「记了版本」。
    expect(parseSlotRef({ kind: "skill", skillId: "sk-1", versionId: "" }).ok).toBe(false);
  });

  it("干净的三支都放行（门控不能恒拒）", () => {
    expect(parseSlotRef({ kind: "skill", skillId: "sk-1", versionId: "v1" })).toEqual({
      ok: true,
      ref: { kind: "skill", skillId: "sk-1", versionId: "v1" },
    });
    expect(parseSlotRef({ kind: "canvas-template", canvasTemplateId: "hmw" }).ok).toBe(true);
    expect(parseSlotRef({ kind: "agent-output", agentId: "scout", outputKey: "briefing" }).ok).toBe(
      true,
    );
  });
});

describe("下发角色与触发方式是封闭集合（domain.md 表格）", () => {
  it("四个下发角色，且「全场共用」不是三角色的并集别名", () => {
    expect(new Set(DELIVER_ROLES)).toEqual(new Set(["引导师", "组长", "组员", "全场共用"]));
    for (const bad of ["主持人", "观察员", "all", ""]) expect(isDeliverRole(bad)).toBe(false);
  });

  it("三种触发方式，对应画布左栏 [运行] / [已开] / 无按钮", () => {
    expect(new Set(BINDING_TRIGGERS)).toEqual(new Set(["手动触发", "默认开启", "常驻"]));
    for (const bad of ["自动", "manual", ""]) expect(isBindingTrigger(bad)).toBe(false);
  });

  it("契约侧此刻确实没给这两个字段类型（未收敛的松紧差，钉住等人裁）", () => {
    const src = readFileSync(join(REPO, "packages/contracts/src/skills.ts"), "utf8");
    // 契约的 SkillBinding 里这两行逐字如此。有人把它收紧成 z.enum 之后这里会红 ——
    // 那时该做的是把 domain 侧改成派生，而不是让两份枚举各自活着。
    expect(src).toContain("deliverRoles: z.array(z.string()),");
    expect(src).toContain("trigger: z.string(),");
    expect(CONTRACT_UNTYPED_BINDING_FIELDS.domainMdShape.trigger).toEqual(BINDING_TRIGGERS);
    expect(CONTRACT_UNTYPED_BINDING_FIELDS.domainMdShape.deliverRoles).toEqual(DELIVER_ROLES);
  });
});

describe("用例层：换绑走同一道门，且提示不阻断（V7）", () => {
  const seed = {
    projectId: "p-1",
    sourceTemplateId: "tpl-1",
    sourceTemplateVersion: 2,
    segments: [{ agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 }],
    bindings: [] as SegmentBinding[],
    roleCells: [],
  };

  const deps = (bindings: SegmentBinding[] = []) => ({
    orchestrations: orchestrationStore({ ...seed, bindings }),
    skills: visibility({
      "sk-voice": { status: "已启用" as const, currentVersionId: "v3" },
      "sk-draft": { status: "草稿" as const, currentVersionId: "v1" },
    }),
    fingerprintOf: orchestrationFingerprint,
  });

  const req = (slot: Record<string, unknown>, bindingId = "b-new") => ({
    target: { level: "instance" as const, projectId: "p-1" },
    principalId: "u-facilitator",
    agendaSegmentId: "seg-02",
    bindingId,
    slot,
    deliverRoles: ["全场共用"],
    trigger: "默认开启",
    expectedFingerprint: null,
  });

  it("往 skill 槽塞画布模板主键 ⇒ 拒，且**零写入**", async () => {
    const d = deps();
    const r = await upsertSegmentBinding(
      req({ kind: "skill", skillId: "sk-voice", versionId: "v2", canvasTemplateId: "hmw" }),
      d,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SLOT_KIND_MISMATCH");
    // 返回码对但已经写进去了，是本仓最常见的假绿。
    expect(d.orchestrations.saves).toEqual([]);
  });

  it("绑非「已启用」的 skill ⇒ SKILL_NOT_ENABLED，零写入", async () => {
    const d = deps();
    const r = await upsertSegmentBinding(req({ kind: "skill", skillId: "sk-draft", versionId: "v1" }), d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_NOT_ENABLED");
    expect(d.orchestrations.saves).toEqual([]);
  });

  it("可见性范围外 ⇒ SKILL_NOT_FOUND（404 非 403，不泄露存在性）", async () => {
    const d = deps();
    const r = await upsertSegmentBinding(req({ kind: "skill", skillId: "sk-secret", versionId: "v1" }), d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SKILL_NOT_FOUND");
    expect(r.reason).not.toContain("无权");
  });

  it("绑画布模板**不走 skill 的启用判定** —— 可区分在业务上的第一个用处", async () => {
    const d = deps();
    // `hmw` 在可见性表里根本不存在。如果三支共用一条判定，这里会 SKILL_NOT_FOUND。
    const r = await upsertSegmentBinding(req({ kind: "canvas-template", canvasTemplateId: "hmw" }), d);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.binding.slot).toEqual({ kind: "canvas-template", canvasTemplateId: "hmw" });
    expect(d.orchestrations.saves).toHaveLength(1);
  });

  it("超 6 个 **skill** 才提示，且提示不阻断；画布模板不占这个额度", async () => {
    const many: SegmentBinding[] = Array.from({ length: 6 }, (_, i) =>
      binding({
        bindingId: `b-${i}`,
        agendaSegmentId: "seg-02",
        owner,
        slot: { kind: "skill", skillId: `sk-${i}`, versionId: "v1" },
      }),
    );
    // 先证明「加一条画布模板不会触发提示」——数的是 skill 不是绑定总数。
    const d1 = deps([...many]);
    const r1 = await upsertSegmentBinding(req({ kind: "canvas-template", canvasTemplateId: "hmw" }), d1);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.warnings).toEqual([]);

    // 再证明「第 7 个 skill 会提示，但仍然写进去了」。
    const d2 = deps([...many]);
    const r2 = await upsertSegmentBinding(req({ kind: "skill", skillId: "sk-voice", versionId: "v3" }), d2);
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
    if (!r2.ok) return;
    expect(r2.warnings).toHaveLength(1);
    expect(r2.warnings[0]).toContain(String(SKILL_PER_SEGMENT_HINT_THRESHOLD));
    // 关键：提示了**并且**写成功了。写成错误码就是把引导师卡在现场。
    expect(d2.orchestrations.saves).toHaveLength(1);
  });

  it("纯函数版的提示阈值同样只数 skill", () => {
    const sevenSkills = Array.from({ length: 7 }, (_, i) =>
      binding({
        bindingId: `b-${i}`,
        agendaSegmentId: "seg-02",
        owner,
        slot: { kind: "skill", skillId: `sk-${i}`, versionId: "v1" },
      }),
    );
    expect(bindingWarnings(sevenSkills)).toHaveLength(1);
    const sixSkillsPlusTen = [
      ...sevenSkills.slice(0, 6),
      ...Array.from({ length: 10 }, (_, i) =>
        binding({
          bindingId: `c-${i}`,
          agendaSegmentId: "seg-02",
          owner,
          slot: { kind: "canvas-template", canvasTemplateId: `tpl-${i}` },
        }),
      ),
    ];
    expect(bindingWarnings(sixSkillsPlusTen), "画布模板被算进了 skill 额度").toEqual([]);
  });

  it("非法下发角色 / 触发方式 ⇒ 拒，零写入", async () => {
    const d = deps();
    const r = await upsertSegmentBinding(
      { ...req({ kind: "canvas-template", canvasTemplateId: "hmw" }), deliverRoles: ["主持人"] },
      d,
    );
    expect(r.ok).toBe(false);
    const d2 = deps();
    const r2 = await upsertSegmentBinding(
      { ...req({ kind: "canvas-template", canvasTemplateId: "hmw" }), trigger: "自动" },
      d2,
    );
    expect(r2.ok).toBe(false);
    expect(d.orchestrations.saves).toEqual([]);
    expect(d2.orchestrations.saves).toEqual([]);
  });
});
