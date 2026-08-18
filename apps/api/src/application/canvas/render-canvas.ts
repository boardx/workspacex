/**
 * `renderCanvas`（#1493 / UC-7.3 第二块）—— Markdown → 分区/便签投影 + 渲染面。
 *
 * ## 鉴权与 getSource 同一条判定：项目成员即可，跨组只读放行（uc-7-3 A2）
 *
 * 渲染是读路径——「打开别组画布时以只读态呈现」要先渲染得出来。判定复用矩阵行
 * `read.ownGroup`（get-canvas-source.ts 文件头的论证逐字适用），deny 一律映契约唯一的
 * 拒绝码 `NO_PROJECT_ROLE`；`versionId?` 读历史版本，缺省 head，与 `getSource` 同款。
 *
 * ## I-8：被白名单挡下的块照常保留原文，只是不渲染
 *
 * 判定完整复用 `domain/canvas/mermaid-whitelist.ts` 的 `applyMermaidWhitelist`
 * （update-canvas-source.ts 用的同一套，不写第二份）：`ignoredBlocks` 带 type 与
 * 1-based `rawLineRange`，**本用例从头到尾没有一行代码改写 markdown**——源码只从
 * `findVersion` 读出、从不写回，「不丢内容」是结构性成立的，不靠自觉。
 * 组织白名单的持久层（`setMermaidWhitelist`）本仓尚未落地，缺省 = 12 型全放行
 * （与第一块同一句诚实声明）；`projectRenderFace` 把 enabled 收为参数，
 * I-8 的反证在 `tests/canvas/render-export-projection.test.ts` 用收紧的白名单打。
 *
 * ## `diagramModel` 沿用第一块的「诚实降级」
 *
 * mermaid 完整解析需要浏览器 DOM（ADR-100：apps/api 故意不开 DOM lib）。这里返回
 * `{kind:"mermaid-source", blocks}` ——**只含通过白名单的块**（被挡的块不进渲染面，
 * 这正是白名单「只关渲染」的那一半），与 update-canvas-source.ts 的降级同形。
 *
 * ## `sections` / `stickies` 的来源与如实缺省
 *
 * · 分区：实例冻结的 (templateKey, templateVersion) 那一行模板的 `sections` jsonb
 *   （契约 `SectionDef` 原形）；markdown 里手写的、模板没有的 `## 段落` 追加为派生分区
 *   （sectionId `md:<名字>`，required=false / capacity=null——文本里没有这两个事实）。
 * · 便签：`source-projection.ts` 的文档序投影（解析语义锚定引擎 `parseTemplateText`）。
 *   纯 markdown 里**没有来源**的契约字段如实填缺省，不假装有：
 *     - `authorRef: ""` —— 文本不记作者（便签级作者出现在 applyStickyChange 的旁路，
 *       本块未建）；空串是「无记录」，不是编一个用户。
 *     - `aiGenerated: false` —— AVA 角标的事实源在 AI 起草链（uc-7-2），文本无此标记。
 *     - `citationRef: null` —— 引述链未接入本路径。
 */
import { canvas as C } from "@repo/contracts";
import {
  applyMermaidWhitelist,
  type MermaidDiagramType,
} from "../../domain/canvas/mermaid-whitelist";
import { extractMermaidBlocks } from "@repo/fabric-markdown/markdown";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { CanvasError } from "./errors";
import type { CanvasInstanceRepository, TemplateSectionFacts } from "./instance-ports";
import { derivedSectionId, projectSource } from "./source-projection";
import { GET_CANVAS_SOURCE_ACTION } from "./get-canvas-source";

export interface RenderCanvasDeps {
  readonly auth: AuthorizeDeps;
  readonly instances: CanvasInstanceRepository;
}

export interface RenderCanvasInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly instanceId: string;
  readonly versionId?: string;
}

interface SectionOut {
  readonly sectionId: string;
  readonly name: string;
  readonly order: number;
  readonly required: boolean;
  readonly capacity: number | null;
}

interface StickyOut {
  readonly stickyId: string;
  readonly sectionId: string | null;
  readonly text: string;
  readonly color: string | null;
  readonly size: string | null;
  readonly authorRef: string;
  readonly aiGenerated: boolean;
  readonly citationRef: string | null;
}

export interface RenderCanvasOutput {
  readonly diagramModel: string;
  readonly sections: readonly SectionOut[];
  readonly stickies: readonly StickyOut[];
  readonly ignoredSyntaxCount: number;
  readonly ignoredBlocks: ReadonlyArray<{
    readonly type: string;
    readonly rawLineRange: { readonly from: number; readonly to: number };
  }>;
}

/**
 * 渲染面的纯投影（markdown + 冻结分区 + 白名单 → 契约 out 形状）。
 * 单独导出：I-8 反证与形状单测直接打它，e2e 打整条 HTTP 链，两边是同一个函数。
 */
export function projectRenderFace(
  markdown: string,
  templateSections: readonly TemplateSectionFacts[],
  enabled: readonly MermaidDiagramType[],
): RenderCanvasOutput {
  const projection = projectSource(markdown);

  // 分区：冻结模板的 SectionDef 按 order 排序；markdown 多出来的 `##` 追加为派生分区。
  const sections: SectionOut[] = [...templateSections]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ ...s }));
  const byName = new Map(sections.map((s) => [s.name, s]));
  let nextOrder = sections.reduce((m, s) => Math.max(m, s.order + 1), 0);
  for (const sec of projection.sections) {
    if (byName.has(sec.name)) continue;
    const derived: SectionOut = {
      sectionId: derivedSectionId(sec.name),
      name: sec.name,
      order: nextOrder++,
      required: false,
      capacity: null,
    };
    sections.push(derived);
    byName.set(sec.name, derived);
  }

  const stickies: StickyOut[] = projection.sections.flatMap((sec) =>
    sec.stickies.map((s) => ({
      stickyId: s.stickyId,
      sectionId: byName.get(sec.name)!.sectionId,
      text: s.text,
      color: s.color,
      size: null, // 文本语法没有尺寸标记（引擎便签是固定尺寸）——如实 null
      authorRef: "",
      aiGenerated: false,
      citationRef: null,
    })),
  );

  // I-8：白名单只决定「渲染面里有没有它」，从不改 markdown（见文件头）。
  const whitelist = applyMermaidWhitelist(markdown, enabled);
  const ignoredStarts = new Set(whitelist.ignoredBlocks.map((b) => b.rawLineRange.from));
  const renderable = extractMermaidBlocks(markdown).filter((b) => {
    if (b.lang !== "mermaid") return false;
    const fromLine = markdown.slice(0, b.start).split("\n").length;
    return !ignoredStarts.has(fromLine);
  });
  const diagramModel = JSON.stringify({
    kind: "mermaid-source",
    blocks: renderable.map((b) => ({ lang: b.lang, code: b.code })),
  });

  return {
    diagramModel,
    sections,
    stickies,
    ignoredSyntaxCount: whitelist.ignoredSyntaxCount,
    ignoredBlocks: whitelist.ignoredBlocks.map((b) => ({
      type: b.type,
      rawLineRange: { from: b.rawLineRange.from, to: b.rawLineRange.to },
    })),
  };
}

export async function renderCanvas(
  deps: RenderCanvasDeps,
  input: RenderCanvasInput,
): Promise<RenderCanvasOutput> {
  const instance = await deps.instances.findInstance(input.orgId, input.instanceId);
  if (instance === null) throw new CanvasError("INSTANCE_NOT_FOUND");

  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: instance.workshopId,
    object: { kind: "project", id: instance.workshopId },
    action: GET_CANVAS_SOURCE_ACTION,
  });
  if (!decision.allowed) throw new CanvasError("NO_PROJECT_ROLE");

  const version = await deps.instances.findVersion(input.orgId, input.instanceId, input.versionId);
  // 同 get-canvas-source.ts：指名的 (instance, version) 组合不存在 ⇒ INSTANCE_NOT_FOUND。
  if (version === null) throw new CanvasError("INSTANCE_NOT_FOUND");

  const content = await deps.instances.findTemplateContent(
    input.orgId, instance.templateKey, instance.templateVersion,
  );
  // 实例行带 FK 指向模板版本行（迁移 20260818090000），查不到只能是表级事故——如实炸
  // （instantiate-canvases-for-segment.ts ④ 的同型处置）。
  if (content === null) {
    throw new Error(
      `canvas template ${instance.templateKey}@${instance.templateVersion} 不存在，但实例 ${instance.instanceId} 冻结着它`,
    );
  }

  // 组织白名单持久层未落地 ⇒ 缺省 12 型全放行（契约闭集本身，不复制第二份清单）。
  return projectRenderFace(version.markdown, content.sections, C.MermaidDiagramType.options);
}
