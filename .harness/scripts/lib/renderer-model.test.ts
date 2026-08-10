import { describe, it, expect } from "vitest";
import { RendererRegistry, renderChecked, type Renderer, type RenderContext } from "./renderer-model";
import type { InstanceMetadata } from "./template-model";

const CTX: RenderContext = { repoRoot: "/repo", revision: "abcdef1234567" };

function makeInstance(overrides: Partial<InstanceMetadata> = {}): InstanceMetadata {
  return {
    template_id: "TPL-EVT-001",
    template_version: 1,
    instance_id: "EVT-999-0001",
    status: "active",
    scope: { project: "workspacex", phase: null },
    refs: [],
    sourceFile: ".harness/events/EVT-999-0001.yaml",
    ...overrides,
  };
}

function makeRenderer(overrides: Partial<Renderer> = {}): Renderer {
  return {
    rendererId: "evt-short-text",
    templateId: "TPL-EVT-001",
    render: (instance, ctx) => [
      {
        path: "generated/events/EVT-999-0001.md",
        content: "hello",
        meta: {
          sourceInstanceId: instance.instance_id,
          sourceTemplateId: instance.template_id,
          sourceRevision: ctx.revision,
        },
      },
    ],
    ...overrides,
  };
}

describe("RendererRegistry", () => {
  it("注册后可按 rendererId 与 templateId 查到", () => {
    const reg = new RendererRegistry();
    const r = makeRenderer();
    reg.register(r);
    expect(reg.get("evt-short-text")).toBe(r);
    expect(reg.forTemplate("TPL-EVT-001")).toEqual([r]);
    expect(reg.list()).toHaveLength(1);
  });

  it("同一模板可挂多个 renderer（不同 rendererId）", () => {
    const reg = new RendererRegistry();
    reg.register(makeRenderer());
    reg.register(makeRenderer({ rendererId: "evt-mermaid" }));
    expect(reg.forTemplate("TPL-EVT-001")).toHaveLength(2);
  });

  it("重复 rendererId 抛错，不静默覆盖", () => {
    const reg = new RendererRegistry();
    reg.register(makeRenderer());
    expect(() => reg.register(makeRenderer())).toThrow(/重复注册/);
  });

  it("非法 templateId 抛错", () => {
    const reg = new RendererRegistry();
    expect(() => reg.register(makeRenderer({ templateId: "not-a-template" }))).toThrow(/templateId 不合法/);
  });

  it("空 rendererId 抛错", () => {
    const reg = new RendererRegistry();
    expect(() => reg.register(makeRenderer({ rendererId: "  " }))).toThrow(/不能为空/);
  });

  it("未注册模板的 forTemplate 返回空数组（不是 undefined）", () => {
    const reg = new RendererRegistry();
    expect(reg.forTemplate("TPL-FTR-001")).toEqual([]);
  });
});

describe("renderChecked", () => {
  it("合法渲染：产出带完整来源指纹，issues 为空", () => {
    const { files, issues } = renderChecked(makeRenderer(), makeInstance(), CTX);
    expect(issues).toEqual([]);
    expect(files).toHaveLength(1);
    expect(files[0]?.meta).toEqual({
      sourceInstanceId: "EVT-999-0001",
      sourceTemplateId: "TPL-EVT-001",
      sourceRevision: "abcdef1234567",
    });
  });

  it("实例模板与 renderer 声明不符 → 拒绝渲染", () => {
    const { files, issues } = renderChecked(makeRenderer(), makeInstance({ template_id: "TPL-FTR-001" }), CTX);
    expect(files).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("不符");
  });

  it("反证：renderer 忘盖 sourceInstanceId 指纹 → 产出作废", () => {
    const bad = makeRenderer({
      render: (instance, ctx) => [
        {
          path: "generated/x.md",
          content: "x",
          meta: { sourceInstanceId: "WRONG-ID", sourceTemplateId: instance.template_id, sourceRevision: ctx.revision },
        },
      ],
    });
    const { files, issues } = renderChecked(bad, makeInstance(), CTX);
    expect(files).toEqual([]);
    expect(issues.some((i) => i.message.includes("sourceInstanceId"))).toBe(true);
  });

  it("反证：renderer 自造 revision（不等于 ctx.revision）→ 产出作废", () => {
    const bad = makeRenderer({
      render: (instance) => [
        {
          path: "generated/x.md",
          content: "x",
          meta: { sourceInstanceId: instance.instance_id, sourceTemplateId: instance.template_id, sourceRevision: "deadbeef" },
        },
      ],
    });
    const { files, issues } = renderChecked(bad, makeInstance(), CTX);
    expect(files).toEqual([]);
    expect(issues.some((i) => i.message.includes("sourceRevision"))).toBe(true);
  });

  it("反证：绝对路径 / .. 逃逸路径 → 产出作废", () => {
    for (const badPath of ["/etc/passwd", "../outside.md", ""]) {
      const bad = makeRenderer({
        render: (instance, ctx) => [
          {
            path: badPath,
            content: "x",
            meta: { sourceInstanceId: instance.instance_id, sourceTemplateId: instance.template_id, sourceRevision: ctx.revision },
          },
        ],
      });
      const { files, issues } = renderChecked(bad, makeInstance(), CTX);
      expect(files).toEqual([]);
      expect(issues.some((i) => i.message.includes("path"))).toBe(true);
    }
  });

  it("多处缺陷累积上报，不是撞到第一个就停", () => {
    const bad = makeRenderer({
      render: () => [
        {
          path: "/abs.md",
          content: "x",
          meta: { sourceInstanceId: "WRONG", sourceTemplateId: "TPL-XXX-999", sourceRevision: "deadbeef" },
        },
      ],
    });
    const { issues } = renderChecked(bad, makeInstance(), CTX);
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });
});
