import { describe, it, expect } from "vitest";
import { runRenderPipeline, runRenderPipelineBatch } from "./render-pipeline";
import { parseGeneratedHeader, verifyContentHash } from "./generated-metadata";
import type { Renderer, RenderContext } from "./renderer-model";
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

function makeRenderer(body: string, overrides: Partial<Renderer> = {}): Renderer {
  return {
    rendererId: "evt-short-text",
    templateId: "TPL-EVT-001",
    render: (instance, ctx) => [
      {
        path: ".harness/generated/events/EVT-999-0001.md",
        content: body,
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

describe("runRenderPipeline — 全链路", () => {
  it("干净渲染：产出已盖头，且头可解析、哈希可验、指纹回指实例", () => {
    const { files, issues } = runRenderPipeline(makeRenderer("# 事件摘要\n正文\n"), makeInstance(), CTX);
    expect(issues).toEqual([]);
    expect(files).toHaveLength(1);
    const { parsed, issues: parseIssues } = parseGeneratedHeader(files[0]!.path, files[0]!.finalContent);
    expect(parseIssues).toEqual([]);
    expect(parsed?.header.sourceInstanceId).toBe("EVT-999-0001");
    expect(parsed?.header.rendererId).toBe("evt-short-text");
    expect(parsed?.header.sourceRevision).toBe(CTX.revision);
    expect(verifyContentHash(parsed!).ok).toBe(true);
    expect(parsed?.body).toBe("# 事件摘要\n正文\n");
  });

  it("反证（render 段）：指纹缺失 → stage=render，产出为空", () => {
    const bad = makeRenderer("x", {
      render: (instance, ctx) => [
        {
          path: ".harness/generated/x.md",
          content: "x",
          meta: { sourceInstanceId: "WRONG", sourceTemplateId: instance.template_id, sourceRevision: ctx.revision },
        },
      ],
    });
    const { files, issues } = runRenderPipeline(bad, makeInstance(), CTX);
    expect(files).toEqual([]);
    expect(issues.every((i) => i.stage === "render")).toBe(true);
  });

  it("反证（placeholder 段）：渲染产出残留 {{...}} → stage=placeholder，产出为空", () => {
    const { files, issues } = runRenderPipeline(makeRenderer("标题：{{TITLE}}\n"), makeInstance(), CTX);
    expect(files).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ stage: "placeholder" });
    expect(issues[0]?.message).toContain("{{TITLE}}");
  });

  it("反证（wrap 段）：未登记扩展名 → stage=wrap，产出为空", () => {
    const bad = makeRenderer("{}", {
      render: (instance, ctx) => [
        {
          path: ".harness/generated/x.json",
          content: "{}",
          meta: { sourceInstanceId: instance.instance_id, sourceTemplateId: instance.template_id, sourceRevision: ctx.revision },
        },
      ],
    });
    const { files, issues } = runRenderPipeline(bad, makeInstance(), CTX);
    expect(files).toEqual([]);
    expect(issues[0]).toMatchObject({ stage: "wrap" });
  });

  it("不做部分成功：3 份产出中 1 份带占位符 → 3 份全弃", () => {
    const multi = makeRenderer("", {
      render: (instance, ctx) => ["a", "b", "c"].map((n) => ({
        path: `.harness/generated/${n}.md`,
        content: n === "b" ? "残留 {{X}}" : "干净",
        meta: { sourceInstanceId: instance.instance_id, sourceTemplateId: instance.template_id, sourceRevision: ctx.revision },
      })),
    });
    const { files, issues } = runRenderPipeline(multi, makeInstance(), CTX);
    expect(files).toEqual([]);
    expect(issues).toHaveLength(1);
  });
});

describe("runRenderPipelineBatch", () => {
  it("逐实例聚合，坏实例不拖累好实例", () => {
    const good = makeInstance();
    const bad = makeInstance({ instance_id: "EVT-999-0002", template_id: "TPL-FTR-001" });
    const renderer = makeRenderer("正文");
    const { outputs } = runRenderPipelineBatch(
      [
        { renderer, instance: good },
        { renderer, instance: bad },
      ],
      CTX,
    );
    expect(outputs.get("EVT-999-0001")?.files).toHaveLength(1);
    expect(outputs.get("EVT-999-0002")?.files).toEqual([]);
    expect(outputs.get("EVT-999-0002")?.issues[0]?.stage).toBe("render");
  });
});
