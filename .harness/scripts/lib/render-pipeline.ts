/**
 * render-pipeline.ts —— PROP-HARNESS-MODEL-001 Epic E2（HMV2-017 的管道层）：
 * 把 E2 前四件的原语串成一条"渲染 → 门控 → 盖头"的纯组合管道。
 *
 * 组装关系（全部是已合并的原语，本文件零新判定逻辑）：
 *   1. HMV2-013 `renderChecked`      —— 渲染 + 来源指纹完整性校验
 *   2. HMV2-014 `checkRenderedFiles` —— 未解析占位符门控
 *   3. HMV2-015 `wrapWithHeader`     —— 盖元数据头（含正文哈希）
 *   （HMV2-016 drift gate 在下游：产物落盘入 git 后由 templates doctor 复检）
 *
 * 失败语义：任何一步 issues 非空 → 整份实例的产出作废（files 为空），错误
 * 逐条带阶段前缀上报。**不做部分成功**——一份实例渲染出 3 份文件、其中 1 份
 * 有占位符残留时，3 份全弃：半套产物落盘比不落盘更糟（读者无法分辨哪份可信），
 * 同 renderChecked"产出不可信就作废"的既有约定。
 *
 * 本文件不做 IO、不碰注册表、不定落盘路径——那些是 CLI 层（templates-render.ts）
 * 的事，其中落盘根目录约定属于架构口径，见 #422 的 HMV2-017 裁决请求。
 */
import type { InstanceMetadata } from "./template-model";
import type { Renderer, RenderContext, RenderedFile } from "./renderer-model";
import { renderChecked } from "./renderer-model";
import { checkRenderedFiles } from "./placeholder-gate";
import { wrapWithHeader } from "./generated-metadata";

export interface PipelineIssue {
  /** 哪一步拦下的：render（013 完整性）/ placeholder（014 门控）/ wrap（015 盖头）。 */
  stage: "render" | "placeholder" | "wrap";
  path: string;
  message: string;
}

export interface PipelineOutput {
  /** 最终可落盘内容（已盖元数据头）。issues 非空时恒为空数组。 */
  files: { path: string; finalContent: string }[];
  issues: PipelineIssue[];
}

/**
 * 对一份实例走完整管道。ctx.revision 建议由调用方传当前 HEAD 的 exact SHA——
 * 这里不猜默认值，猜错的 revision 会让 drift 判定失去意义。
 */
export function runRenderPipeline(
  renderer: Renderer,
  instance: InstanceMetadata,
  ctx: RenderContext,
): PipelineOutput {
  const issues: PipelineIssue[] = [];

  const rendered = renderChecked(renderer, instance, ctx);
  for (const i of rendered.issues) {
    issues.push({ stage: "render", path: i.path, message: i.message });
  }
  if (issues.length > 0) return { files: [], issues };

  for (const p of checkRenderedFiles(rendered.files)) {
    issues.push({
      stage: "placeholder",
      path: p.path,
      message: `第 ${p.finding.line} 行残留未解析占位符 ${JSON.stringify(p.finding.placeholder)}（${p.finding.kind}）`,
    });
  }
  if (issues.length > 0) return { files: [], issues };

  const files: { path: string; finalContent: string }[] = [];
  for (const f of rendered.files) {
    try {
      files.push({
        path: f.path,
        finalContent: wrapWithHeader(f.path, f.content, {
          rendererId: renderer.rendererId,
          sourceInstanceId: f.meta.sourceInstanceId,
          sourceTemplateId: f.meta.sourceTemplateId,
          sourceRevision: f.meta.sourceRevision,
        }),
      });
    } catch (e) {
      // wrapWithHeader 对未登记扩展名抛错（宁可失败不产出测不了漂移的生成物）——
      // 转成结构化 issue，让 CLI 一次性报出所有问题文件而不是逐个撞。
      issues.push({ stage: "wrap", path: f.path, message: (e as Error).message });
    }
  }
  if (issues.length > 0) return { files: [], issues };

  return { files, issues: [] };
}

/** 批量版：多份实例 × 各自 renderer。产物与 issues 逐实例聚合，互不拖累。 */
export function runRenderPipelineBatch(
  jobs: { renderer: Renderer; instance: InstanceMetadata }[],
  ctx: RenderContext,
): { outputs: Map<string, PipelineOutput> } {
  const outputs = new Map<string, PipelineOutput>();
  for (const job of jobs) {
    outputs.set(job.instance.instance_id, runRenderPipeline(job.renderer, job.instance, ctx));
  }
  return { outputs };
}
