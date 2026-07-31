/**
 * F63 · **模板套用写入项目实例、不回写**（`contracts/skills/domain.md` I-17 /
 * UC-3.2 R3 步骤 1 与 8 / AC2「改动只影响这场项目，不动后台模板本体」）。
 *
 * I-17 自带断言方式，逐字：
 *   「改实例编排后断言模板的 `contentHash` / 绑定集合不变；
 *    `[另存为组织模板]` 产生**新**模板而非覆盖」
 *
 * ⇒ 本文件把「不回写」拆成**四条方向不同**的断言，因为只做第一条会放过一整类坏实现：
 *
 *   ① 正向：改实例 → 模板本体指纹与绑定集合不变。
 *   ② **反向**：改模板本体 → 已套用的实例不变。
 *      ⚠ 这条是重点。①对一个「实例与模板共享同一个数组」的浅拷贝实现**同样是绿的** ——
 *        因为实例侧的编辑函数都是纯函数，压根没去动那个共享数组。
 *        只有从模板那头改，才会顺着共享引用漏到实例上。
 *   ③ 结构：application 层**根本没有能改已存在模板的端口方法**（端口方法名集合断言）。
 *   ④ 另存为组织模板：产出**新 id**，来源模板一次都没被读、更没被写。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyWorkflowTemplate } from "../../../src/application/skill/apply-workflow-template";
import { upsertSegmentBinding } from "../../../src/application/skill/upsert-segment-binding";
import { saveAsOrgTemplate } from "../../../src/application/skill/save-as-org-template";
import { TEMPLATE_PORTS_ALLOWED_METHODS } from "../../../src/application/skill/ports";
import {
  orchestrationFingerprint,
  sourceLabelOf,
  withBinding,
  withTrigger,
} from "../../../src/domain/skill/orchestration";
import { bindingsOfKind } from "../../../src/domain/skill/binding-slot";
import {
  binding,
  mixedSlotTemplate,
  orchestrationStore,
  orgTemplateStore,
  templateStore,
  visibility,
} from "../../support/skill-fakes";

const PORTS_SRC = fileURLToPath(new URL("../../../src/application/skill/ports.ts", import.meta.url));

const POOL = visibility({
  "sk-voice": { status: "已启用", currentVersionId: "v3" },
  "sk-extract": { status: "已启用", currentVersionId: "v1" },
});

async function applied() {
  const templates = templateStore(mixedSlotTemplate());
  const orchestrations = orchestrationStore(null);
  const r = await applyWorkflowTemplate(
    {
      projectId: "p-1",
      workflowTemplateId: "tpl-design-thinking",
      principalId: "u-facilitator",
      hostConfirmed: true,
    },
    { templates, orchestrations, skills: POOL, newBindingId: (i) => `ib-${i}` },
  );
  if (!r.ok) throw new Error(`套用失败：${r.code} ${r.reason}`);
  return { templates, orchestrations, instance: r.orchestration, sourceLabel: r.sourceLabel };
}

describe("R3 步骤 1：一次性写入这场项目，并记来源版本", () => {
  it("环节链、绑定、三角色分工全部落到实例上，且归属是 instance", async () => {
    const { instance } = await applied();
    expect(instance.segments.map((s) => s.agendaSegmentId)).toEqual(["seg-02", "seg-03"]);
    expect(instance.roleCells.map((c) => c.role)).toEqual(["引导师", "组长", "组员"]);
    // 每一条绑定都改归了实例：留一条 template 归属的，就是一条指向模板的活引用。
    expect(instance.bindings.every((b) => b.owner.level === "instance")).toBe(true);
    expect(instance.bindings.every((b) => b.owner.level === "instance" && b.owner.projectId === "p-1")).toBe(true);
  });

  it("记来源版本，界面上是「来自后台 v2」", async () => {
    const { instance, sourceLabel } = await applied();
    expect(instance.sourceTemplateId).toBe("tpl-design-thinking");
    expect(instance.sourceTemplateVersion).toBe(2);
    expect(sourceLabel).toBe("来自后台 v2");
    expect(sourceLabelOf(instance)).toBe("来自后台 v2");
  });

  it("混合槽三支一起被搬过来，且搬过来之后仍然分得开", async () => {
    const { instance } = await applied();
    expect(bindingsOfKind(instance.bindings, "skill").map((b) => b.slot.skillId)).toEqual(["sk-voice"]);
    expect(bindingsOfKind(instance.bindings, "canvas-template").map((b) => b.slot.canvasTemplateId)).toEqual(["hmw"]);
    expect(bindingsOfKind(instance.bindings, "agent-output").map((b) => b.slot.agentId)).toEqual(["scout"]);
  });

  it("实例绑定另发 id，但记着它来自哪条模板绑定（痕迹，不是通道）", async () => {
    const { instance, templates } = await applied();
    expect(instance.bindings.map((b) => b.bindingId)).toEqual(["ib-0", "ib-1", "ib-2"]);
    expect(instance.bindings.map((b) => b.originTemplateBindingId)).toEqual(["tb-1", "tb-2", "tb-3"]);
    // 血缘指向的确实是模板本体现存的那几条。
    expect(templates.body.current.bindings.map((b) => b.bindingId)).toEqual(["tb-1", "tb-2", "tb-3"]);
  });

  it("O-03：未经主持人确认 ⇒ 零写入", async () => {
    const templates = templateStore(mixedSlotTemplate());
    const orchestrations = orchestrationStore(null);
    const r = await applyWorkflowTemplate(
      { projectId: "p-1", workflowTemplateId: "tpl-design-thinking", principalId: "u", hostConfirmed: false },
      { templates, orchestrations, skills: POOL, newBindingId: (i) => `ib-${i}` },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("ORPHAN_BINDING_UNRESOLVED");
    expect(orchestrations.saves).toEqual([]);
    // 连模板都不该读：未确认就去读，日志上会出现一次不存在的操作。
    expect(templates.loads).toEqual([]);
  });

  it("已有实例编排时不静默覆盖，指向 F64 的逐条处置", async () => {
    const { templates, orchestrations } = await applied();
    const before = orchestrations.saves.length;
    const r = await applyWorkflowTemplate(
      { projectId: "p-1", workflowTemplateId: "tpl-design-thinking", principalId: "u", hostConfirmed: true },
      { templates, orchestrations, skills: POOL, newBindingId: (i) => `x-${i}` },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("ORPHAN_BINDING_UNRESOLVED");
    expect(orchestrations.saves).toHaveLength(before);
  });
});

describe("① 正向：改实例，模板本体纹丝不动（I-17 / AC2）", () => {
  it("换绑一个 skill 之后，模板的指纹与绑定集合不变", async () => {
    const { templates, orchestrations, instance } = await applied();
    const templateBefore = orchestrationFingerprint(templates.body.current);
    const templateBindingsBefore = templates.body.current.bindings.map((b) => b.bindingId);

    const r = await upsertSegmentBinding(
      {
        target: { level: "instance", projectId: "p-1" },
        principalId: "u-facilitator",
        agendaSegmentId: "seg-02",
        bindingId: "ib-new",
        slot: { kind: "skill", skillId: "sk-extract", versionId: "v1" },
        deliverRoles: ["引导师"],
        trigger: "手动触发",
        expectedFingerprint: null,
      },
      { orchestrations, skills: POOL, fingerprintOf: orchestrationFingerprint },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;

    // 实例**确实变了**——不然下面那条「模板没变」是空转的。
    expect(r.orchestration.bindings).toHaveLength(instance.bindings.length + 1);
    expect(orchestrationFingerprint(r.orchestration)).not.toBe(orchestrationFingerprint(instance));

    // 模板本体一格没动。
    expect(orchestrationFingerprint(templates.body.current)).toBe(templateBefore);
    expect(templates.body.current.bindings.map((b) => b.bindingId)).toEqual(templateBindingsBefore);
  });

  it("改实例某条绑定的触发方式，模板那条仍是原值（同一条绑定的两级取值不同）", async () => {
    const { templates, instance } = await applied();
    const target = instance.bindings.find((b) => b.originTemplateBindingId === "tb-3")!;
    expect(target.trigger).toBe("手动触发");

    const changed = withBinding(instance, withTrigger(target, "常驻"));
    expect(changed.bindings.find((b) => b.bindingId === target.bindingId)?.trigger).toBe("常驻");

    const templateSide = templates.body.current.bindings.find((b) => b.bindingId === "tb-3");
    expect(templateSide?.trigger, "改实例漏到了模板本体上").toBe("手动触发");
  });

  it("显式往模板级写 ⇒ TEMPLATE_WRITEBACK_FORBIDDEN，且零写入", async () => {
    const { orchestrations } = await applied();
    const before = orchestrations.saves.length;
    const r = await upsertSegmentBinding(
      {
        target: { level: "template", templateId: "tpl-design-thinking" },
        principalId: "u-facilitator",
        agendaSegmentId: "seg-02",
        bindingId: "tb-x",
        slot: { kind: "skill", skillId: "sk-extract", versionId: "v1" },
        deliverRoles: ["引导师"],
        trigger: "手动触发",
        expectedFingerprint: null,
      },
      { orchestrations, skills: POOL, fingerprintOf: orchestrationFingerprint },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("TEMPLATE_WRITEBACK_FORBIDDEN");
    expect(r.reason).toContain("另存为组织模板");
    expect(orchestrations.saves).toHaveLength(before);
  });
});

describe("② 反向：改模板本体，已套用的实例不跟着变", () => {
  it("模板加一条绑定，实例的绑定集合不变（共享数组的实现在这里红）", async () => {
    const { templates, instance } = await applied();
    const idsBefore = instance.bindings.map((b) => b.bindingId);
    const fpBefore = orchestrationFingerprint(instance);

    // 后台管理员在模板本体上加了一条。
    templates.body.current = {
      ...templates.body.current,
      version: 3,
      bindings: [
        ...templates.body.current.bindings,
        binding({
          bindingId: "tb-4",
          agendaSegmentId: "seg-03",
          owner: { level: "template", templateId: "tpl-design-thinking" },
          slot: { kind: "skill", skillId: "sk-extract", versionId: "v1" },
        }),
      ],
    };

    expect(instance.bindings.map((b) => b.bindingId)).toEqual(idsBefore);
    expect(orchestrationFingerprint(instance)).toBe(fpBefore);
    // 来源版本记的仍是套用当时那个 v2 —— 它是**引用不是拷贝**，不随模板漂移。
    expect(instance.sourceTemplateVersion).toBe(2);
    expect(sourceLabelOf(instance)).toBe("来自后台 v2");
  });

  it("模板**原地改**某条绑定的载荷，实例那条不变（浅拷贝在这里红）", async () => {
    const { templates, instance } = await applied();
    const instanceSlotBefore = { ...instance.bindings[0]!.slot };

    // 刻意用最脏的写法：直接原地改模板绑定对象上的字段。
    // 深拷贝时这什么也影响不到；共享对象引用时实例会当场跟着变。
    const mutable = templates.body.current.bindings[0] as unknown as Record<string, unknown>;
    mutable["slot"] = { kind: "skill", skillId: "sk-extract", versionId: "v9" };
    mutable["trigger"] = "常驻";
    (templates.body.current.roleCells[0] as unknown as Record<string, unknown>)["text"] = "改过的分工";

    expect(instance.bindings[0]!.slot).toEqual(instanceSlotBefore);
    expect(instance.bindings[0]!.trigger).toBe("默认开启");
    expect(instance.roleCells[0]!.text).toBe("计时 · 提议收敛 · 看四组进度");
  });

  it("模板的 deliverRoles 数组被 push，实例那条不变（数组也要是新的）", async () => {
    const { templates, instance } = await applied();
    const rolesBefore = [...instance.bindings[1]!.deliverRoles];
    (templates.body.current.bindings[1]!.deliverRoles as string[]).push("引导师");
    expect(instance.bindings[1]!.deliverRoles).toEqual(rolesBefore);
  });
});

describe("③ 结构：application 层拿不到任何能改已存在模板的端口方法", () => {
  it("三个编排端口的方法名集合与白名单逐字相等", () => {
    const src = readFileSync(PORTS_SRC, "utf8");
    for (const [iface, allowed] of Object.entries(TEMPLATE_PORTS_ALLOWED_METHODS)) {
      const m = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`, "m").exec(src);
      expect(m, `${iface} 不在 ports.ts 里——白名单在护一个不存在的东西`).not.toBeNull();
      if (m === null) continue;
      const methods = [...m[1]!.matchAll(/^\s{2}(\w+)\s*\(/gm)].map((x) => x[1]);
      expect(new Set(methods), `${iface} 的方法集合变了：多出来的那个是回写的入口`).toEqual(
        new Set(allowed),
      );
    }
  });

  it("白名单里没有任何写模板本体的动词", () => {
    // 白名单本身也会被改。钉住「模板端口的可写动词只有 create」这条性质，
    // 而不是钉住某个字符串列表长什么样。
    expect(TEMPLATE_PORTS_ALLOWED_METHODS.WorkflowTemplateReadPort).toEqual(["load"]);
    expect(TEMPLATE_PORTS_ALLOWED_METHODS.OrgTemplateCreatePort).toEqual(["create"]);
    for (const verb of ["save", "update", "patch", "write", "upsert", "delete"]) {
      expect(
        TEMPLATE_PORTS_ALLOWED_METHODS.WorkflowTemplateReadPort as readonly string[],
      ).not.toContain(verb);
      expect(TEMPLATE_PORTS_ALLOWED_METHODS.OrgTemplateCreatePort as readonly string[]).not.toContain(
        verb,
      );
    }
  });

  it("`saveAsOrgTemplate` 的依赖里根本没有模板读端口（拿不到就写不了）", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../../src/application/skill/save-as-org-template.ts", import.meta.url)),
      "utf8",
    );
    const deps = /export interface SaveAsOrgTemplateDeps \{([\s\S]*?)\n\}/m.exec(src);
    expect(deps).not.toBeNull();
    expect(deps![1]).not.toContain("WorkflowTemplateReadPort");
  });
});

describe("④ [另存为组织模板]：新建一个，不覆盖原来那个", () => {
  it("产出新 templateId，原模板 id 原样返回且内容未被触碰", async () => {
    const { orchestrations, templates, instance } = await applied();
    const templateBefore = orchestrationFingerprint(templates.body.current);
    // ⚠ 套用那一步**读过**一次模板，所以基线不是 0 —— 记下当时的次数，
    //   断言另存**没有再读**。写成 `toEqual([])` 会把套用那次算进来（第一版就是这么错的）。
    const loadsBefore = templates.loads.length;
    const orgTemplates = orgTemplateStore();

    const r = await saveAsOrgTemplate(
      {
        projectId: "p-1",
        orgId: "org-1",
        name: "我们这场调好的五步",
        newTemplateId: "tpl-new-1",
        hostConfirmed: true,
      },
      { orchestrations, orgTemplates, newBindingId: (i) => `nb-${i}` },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;

    expect(r.workflowTemplateId).toBe("tpl-new-1");
    expect(r.workflowTemplateId).not.toBe(instance.sourceTemplateId);
    expect(r.sourceTemplateIdUntouched).toBe("tpl-design-thinking");
    // 新建了**一个**，而且它是新 id。
    expect(orgTemplates.created.map((t) => t.templateId)).toEqual(["tpl-new-1"]);
    // 原模板本体：另存过程中一次都没被再读，指纹不变。
    expect(templates.loads).toHaveLength(loadsBefore);
    expect(orchestrationFingerprint(templates.body.current)).toBe(templateBefore);
  });

  it("另存的内容 ＝ 当前实例编排（指纹相等），且新模板从 v1 起", async () => {
    const { orchestrations, instance } = await applied();
    const orgTemplates = orgTemplateStore();
    const r = await saveAsOrgTemplate(
      { projectId: "p-1", orgId: "org-1", name: "n", newTemplateId: "tpl-new-1", hostConfirmed: true },
      { orchestrations, orgTemplates, newBindingId: (i) => `nb-${i}` },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fingerprint).toBe(orchestrationFingerprint(instance));
    expect(r.body.version).toBe(1);
    // 新模板的绑定归属是它自己，且不再挂着来自旧模板的血缘。
    expect(r.body.bindings.every((b) => b.owner.level === "template")).toBe(true);
    expect(r.body.bindings.every((b) => b.originTemplateBindingId === null)).toBe(true);
  });

  it("另存**之后**再改实例，新模板也不跟着变（新模板同样是本体不是视图）", async () => {
    const { orchestrations } = await applied();
    const orgTemplates = orgTemplateStore();
    await saveAsOrgTemplate(
      { projectId: "p-1", orgId: "org-1", name: "n", newTemplateId: "tpl-new-1", hostConfirmed: true },
      { orchestrations, orgTemplates, newBindingId: (i) => `nb-${i}` },
    );
    const newTemplateFp = orchestrationFingerprint(orgTemplates.created[0]!);

    const r = await upsertSegmentBinding(
      {
        target: { level: "instance", projectId: "p-1" },
        principalId: "u-facilitator",
        agendaSegmentId: "seg-02",
        bindingId: "ib-new",
        slot: { kind: "skill", skillId: "sk-extract", versionId: "v1" },
        deliverRoles: ["引导师"],
        trigger: "手动触发",
        expectedFingerprint: null,
      },
      { orchestrations, skills: POOL, fingerprintOf: orchestrationFingerprint },
    );
    expect(r.ok).toBe(true);
    expect(orchestrationFingerprint(orgTemplates.created[0]!)).toBe(newTemplateFp);
  });

  it("分到与来源模板同一个 id ⇒ 判定为覆盖，写出去之前就拦住", async () => {
    const { orchestrations } = await applied();
    const orgTemplates = orgTemplateStore();
    const r = await saveAsOrgTemplate(
      {
        projectId: "p-1",
        orgId: "org-1",
        name: "n",
        newTemplateId: "tpl-design-thinking",
        hostConfirmed: true,
      },
      { orchestrations, orgTemplates, newBindingId: (i) => `nb-${i}` },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("TEMPLATE_WRITEBACK_FORBIDDEN");
    expect(orgTemplates.created).toEqual([]);
  });

  it("O-03：未经主持人确认 ⇒ 零写入", async () => {
    const { orchestrations } = await applied();
    const orgTemplates = orgTemplateStore();
    const r = await saveAsOrgTemplate(
      { projectId: "p-1", orgId: "org-1", name: "n", newTemplateId: "tpl-new-1", hostConfirmed: false },
      { orchestrations, orgTemplates, newBindingId: (i) => `nb-${i}` },
    );
    expect(r.ok).toBe(false);
    expect(orgTemplates.created).toEqual([]);
  });
});

describe("指纹本身可信（否则上面每条「不变」都是空转）", () => {
  it("内容相同、键序不同 ⇒ 指纹相同", () => {
    const a = { segments: [], bindings: [], roleCells: [{ agendaSegmentId: "s", role: "组长" as const, text: "t" }] };
    const b = { roleCells: [{ text: "t", role: "组长" as const, agendaSegmentId: "s" }], bindings: [], segments: [] };
    expect(orchestrationFingerprint(a)).toBe(orchestrationFingerprint(b));
  });

  it("内容变一个字 ⇒ 指纹不同（不是一个恒等函数）", async () => {
    const { instance } = await applied();
    const changed = { ...instance, roleCells: [{ ...instance.roleCells[0]!, text: "改了" }, ...instance.roleCells.slice(1)] };
    expect(orchestrationFingerprint(changed)).not.toBe(orchestrationFingerprint(instance));
  });
});
