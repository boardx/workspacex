import { describe, expect, it } from "vitest";
import { canvas } from "@repo/contracts";
import { getTemplate, templateToModel } from "@repo/fabric-markdown/templates";

/**
 * F100 —— 「绑定 / 实例固化 / 围栏语法一律以 `key` 为准」（I-3）。
 *
 * ## 这份测试在防什么
 *
 * O-09 留下的真实风险不是「displayName 写错」，而是**有人拿 displayName 去当 key 用**。
 * 后台列表显示 `business-model`，于是绑定面板把 `business-model` 发给 `bindTemplateToSegment`；
 * 或者 AI 生成的 ```` ```canvas ```` 围栏写成 `模板: user-journey`。
 * 两者都会在**运行时**才炸，而运行时 = 现场工作坊切环节的那一秒。
 *
 * 所以这里断言两件事：
 *   ① 五个 displayName（与 key 不同的那五个）**不是**合法 key —— 库和契约都拒绝它；
 *   ② 改 displayName 不影响既有绑定 —— 用 key 建立的绑定/实例记录逐字不变。
 *
 * ## 非空/平凡守卫
 *
 * 「五个 displayName 都不是合法 key」这句话，在「差异集合为空」时平凡为真。
 * 所以先断言差异集合非空、且每一项确实 `displayName !== key`，再断言它们不可当 key 用。
 */

/** key ≠ displayName 的那些条目。派生自契约单源，**不另抄一份**。 */
const divergent = Object.entries(canvas.BUILTIN_CANVAS_TEMPLATES).filter(
  ([key, displayName]) => key !== displayName,
);

describe("F100 · 绑定以 key 为准，不认 displayName（I-3）", () => {
  it("差异集合非空 —— 否则本文件所有断言平凡为真", () => {
    expect(
      divergent.length,
      "key 与 displayName 无一处不同：本测试文件失去判别力，整份都是空转",
    ).toBeGreaterThan(0);
    for (const [key, displayName] of divergent) {
      expect(displayName, `${key} 被列为差异项却与 key 同值`).not.toBe(key);
    }
  });

  it("displayName 不是合法 key —— 库注册表查不到它", () => {
    for (const [key, displayName] of divergent) {
      expect(getTemplate(key), `key=${key} 在库注册表里必须存在`).toBeDefined();
      expect(
        getTemplate(displayName),
        `displayName=${displayName} 竟然能当 key 查到模板 —— 那 key 就不是唯一契约了`,
      ).toBeUndefined();
    }
  });

  it("displayName 不是合法 key —— 契约 zod 枚举拒绝它", () => {
    for (const [key, displayName] of divergent) {
      expect(canvas.BuiltinTemplateKeyEnum.safeParse(key).success, `key=${key} 应被接受`).toBe(true);
      expect(
        canvas.BuiltinTemplateKeyEnum.safeParse(displayName).success,
        `displayName=${displayName} 被 zod 当成合法 key 接受了`,
      ).toBe(false);
    }
  });

  it("```canvas 围栏的 `模板:` 行读的是 key；写 displayName 直接抛错，不静默降级", () => {
    for (const [key, displayName] of divergent) {
      const model = templateToModel(`模板: ${key}\n\n## 任意分区\n- 一张便签\n`);
      expect(model.meta?.templateKey, `围栏 模板: ${key} 固化的 templateKey 不对`).toBe(key);

      expect(
        () => templateToModel(`模板: ${displayName}\n\n## 任意分区\n- 一张便签\n`),
        `围栏写 displayName=${displayName} 竟然解析成功 —— 那就有两套围栏语法了`,
      ).toThrow(/未知画布模板/);
    }
  });

  it("bindTemplateToSegment 的入参字段叫 templateKey，且 .strict() 拒绝 displayName 混入", () => {
    const op = canvas.operations.bindTemplateToSegment;
    const ok = op.in.safeParse({
      agendaSegmentId: "seg-1",
      templateKey: "bmc",
      templateVersion: 1,
    });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);

    // 多塞一个 displayName 必须被 .strict() 拒绝：绑定面里根本不该出现展示层字段。
    const leaked = op.in.safeParse({
      agendaSegmentId: "seg-1",
      templateKey: "bmc",
      templateVersion: 1,
      displayName: "business-model",
    });
    expect(leaked.success, "displayName 混进绑定入参却被接受 —— 展示层泄漏进了契约层").toBe(false);

    // 出参同理：绑定记录里没有 displayName 这一列。
    const outLeaked = op.out.safeParse({
      bindingId: "b-1",
      templateKey: "bmc",
      boundTemplateVersion: 1,
      displayName: "business-model",
    });
    expect(outLeaked.success, "绑定出参带上了 displayName").toBe(false);
  });

  it("instantiateForSegment 固化的是 templateKey + 版本，出参里没有 displayName", () => {
    const op = canvas.operations.instantiateForSegment;
    const ok = op.out.safeParse({
      instances: [
        {
          instanceId: "i-1",
          groupId: "g-1",
          templateKey: "journey-map",
          templateVersion: 3,
          sourceArtifactId: "a-1",
        },
      ],
    });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);

    const leaked = op.out.safeParse({
      instances: [
        {
          instanceId: "i-1",
          groupId: "g-1",
          templateKey: "journey-map",
          templateVersion: 3,
          sourceArtifactId: "a-1",
          displayName: "user-journey",
        },
      ],
    });
    expect(leaked.success, "实例固化记录带上了 displayName —— 改展示名会污染既有实例").toBe(false);
  });

  it("改 displayName 不影响既有绑定：展示层换名后，key 与围栏解析结果逐字不变", () => {
    // 「改 displayName」在契约层的形状 = builtinDisplayName 的返回值变了。
    // 这里用一张改过名的展示映射模拟，证明绑定侧读到的东西一个字都没动。
    const renamedDisplay = new Map(
      Object.entries(canvas.BUILTIN_CANVAS_TEMPLATES).map(([k, v]) => [k, `${v}-改名后`]),
    );

    const bindings = [
      { agendaSegmentId: "seg-3", templateKey: "bmc", templateVersion: 2 },
      { agendaSegmentId: "seg-4", templateKey: "empathy", templateVersion: 1 },
    ];

    for (const b of bindings) {
      // 展示名确实变了（否则这条测试在空转）
      expect(renamedDisplay.get(b.templateKey)).not.toBe(canvas.builtinDisplayName(b.templateKey));
      // 而绑定与围栏解析毫无变化
      expect(canvas.operations.bindTemplateToSegment.in.safeParse(b).success).toBe(true);
      expect(getTemplate(b.templateKey)?.key).toBe(b.templateKey);
      expect(
        templateToModel(`模板: ${b.templateKey}\n\n## 任意分区\n- 一张便签\n`).meta?.templateKey,
      ).toBe(b.templateKey);
    }
  });
});
