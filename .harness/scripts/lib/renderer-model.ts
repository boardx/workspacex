/**
 * renderer-model.ts —— PROP-HARNESS-MODEL-001 Epic E2（HMV2-013）：Typed renderer API。
 *
 * 背景与授权：coord-main 2026-08-11 夜间裁决 E2 由 dev-chat-e2e 代跑（留档
 * issue #422），API 形状即该裁决随附的架构口径主案：**按 template_id 注册的
 * 类型化 renderer 注册表**。三条设计理由（同 #422 原文）：
 *   1. `RenderedFile.meta` 自带 source+revision——P6"生成内容带来源"落在类型上
 *      而不是约定上，直接为 HMV2-015（generated 元数据落盘格式）/016（drift
 *      gate 比对）铺路；
 *   2. 注册表按 template_id 路由，templates doctor 的"renderer 存在"检查
 *      （Proposal §12 第 7 条）未来就是查这张表，不用扫文件猜；
 *   3. 既有 H3A-035 的 TPL-EVT-001 短文本 renderer 不冲突——它是未来这张表的
 *      第一个收编对象，本条目刻意不动它（一条 item 一个 PR）。
 *
 * 范围纪律（HMV2-013 只做这一条）：本文件只定义 API + 注册表 + 校验辅助。
 * 未解析占位符门控是 HMV2-014；生成文件头部元数据的落盘格式是 HMV2-015；
 * drift gate 是 HMV2-016；`templates render` CLI 是 HMV2-017。都不在这里。
 *
 * 风格跟随 template-model.ts：纯 TS + 手写校验，不引 zod；校验累积上报全部
 * 问题，不是撞到第一个就停。
 */
import type { InstanceMetadata } from "./template-model";
import { TEMPLATE_ID_RE } from "./template-model";

/**
 * 一份由 renderer 产出的派生文件。`content` 是完整文件内容；`meta` 是它的
 * 来源指纹——消费方（HMV2-015 的落盘器、HMV2-016 的 drift gate）靠它回答
 * "这份生成物出自哪个实例的哪个修订"，缺了指纹的生成物无法做漂移判定。
 */
export interface RenderedFile {
  /** 相对仓库根的目标路径（POSIX 分隔符）。落不落盘由调用方决定，本层不做 IO。 */
  path: string;
  content: string;
  meta: {
    /** 来源实例（InstanceMetadata.instance_id）。 */
    sourceInstanceId: string;
    /** 来源模板（TPL-xxx-NNN）——冗余存一份，便于 drift gate 不回查注册表也能归类。 */
    sourceTemplateId: string;
    /** 来源数据的修订标识（通常是 exact commit SHA；调用方经 RenderContext 传入）。 */
    sourceRevision: string;
  };
}

/** 渲染上下文：调用方（未来的 HMV2-017 CLI）负责提供，renderer 只读不改。 */
export interface RenderContext {
  repoRoot: string;
  /** 本次渲染所依据的数据修订（exact commit SHA），renderer 原样盖进 meta.sourceRevision。 */
  revision: string;
}

/**
 * 类型化 renderer：声明自己消费哪种模板（templateId），把一份该模板的实例
 * 渲染成 0..N 份派生文件。一个模板类型可以有多个 renderer（如同一份 Feature
 * 实例既渲染成 Markdown 摘要又渲染成 Mermaid 节点），用 `rendererId` 区分。
 */
export interface Renderer<T extends InstanceMetadata = InstanceMetadata> {
  /** 全注册表唯一，命名惯例 `<template小写域码>-<用途>`，如 "evt-short-text"。 */
  rendererId: string;
  /** 消费的模板类型（TPL-xxx-NNN）。 */
  templateId: string;
  render(instance: T, ctx: RenderContext): RenderedFile[];
}

export interface RendererIssue {
  path: string;
  message: string;
}

/**
 * Renderer 注册表。刻意做成显式实例（而不是模块级单例）：单测各自 new 一张表
 * 互不污染；未来 HMV2-017 的 CLI 在启动时组装一张生产表。
 */
export class RendererRegistry {
  private byRendererId = new Map<string, Renderer>();
  private byTemplateId = new Map<string, Renderer[]>();

  /**
   * 注册。重复 rendererId / 非法 templateId 直接抛错而不是静默覆盖——注册
   * 发生在工具启动期，此时炸掉是最便宜的失败点；静默覆盖则会让"renderer
   * 存在"检查（§12 第 7 条）在错误的表上通过。
   */
  register(renderer: Renderer): void {
    if (!TEMPLATE_ID_RE.test(renderer.templateId)) {
      throw new Error(`renderer "${renderer.rendererId}" 的 templateId 不合法：${JSON.stringify(renderer.templateId)}`);
    }
    if (renderer.rendererId.trim().length === 0) {
      throw new Error("rendererId 不能为空");
    }
    if (this.byRendererId.has(renderer.rendererId)) {
      throw new Error(`rendererId 重复注册："${renderer.rendererId}"`);
    }
    this.byRendererId.set(renderer.rendererId, renderer);
    const list = this.byTemplateId.get(renderer.templateId) ?? [];
    list.push(renderer);
    this.byTemplateId.set(renderer.templateId, list);
  }

  get(rendererId: string): Renderer | undefined {
    return this.byRendererId.get(rendererId);
  }

  /** 某模板类型的全部 renderer（无则空数组）。§12 第 7 条"renderer 存在"检查的数据源。 */
  forTemplate(templateId: string): Renderer[] {
    return [...(this.byTemplateId.get(templateId) ?? [])];
  }

  list(): Renderer[] {
    return [...this.byRendererId.values()];
  }
}

/**
 * 渲染一份实例并校验产出的完整性。集中三类检查（累积上报，不早退）：
 *   1. 实例的 template_id 必须等于 renderer 声明消费的 templateId——防止
 *      "拿 Feature 实例喂给 Event renderer"这类接线错误静默产出垃圾；
 *   2. 每份产出的 meta.sourceInstanceId/sourceTemplateId 必须回指这份实例——
 *      防止 renderer 实现忘了盖指纹或盖错（没有指纹，HMV2-016 无从比对）；
 *   3. meta.sourceRevision 必须等于 ctx.revision——指纹里的修订只能来自
 *      调用方给定的修订，renderer 不得自造。
 * 返回 issues 非空时产出不可信，调用方不得落盘。
 */
export function renderChecked(
  renderer: Renderer,
  instance: InstanceMetadata,
  ctx: RenderContext,
): { files: RenderedFile[]; issues: RendererIssue[] } {
  const issues: RendererIssue[] = [];
  if (instance.template_id !== renderer.templateId) {
    issues.push({
      path: instance.sourceFile,
      message: `实例模板 ${instance.template_id} 与 renderer "${renderer.rendererId}" 声明消费的 ${renderer.templateId} 不符`,
    });
    return { files: [], issues };
  }
  const files = renderer.render(instance, ctx);
  files.forEach((f, i) => {
    const p = `${renderer.rendererId}#files[${i}]`;
    if (f.meta.sourceInstanceId !== instance.instance_id) {
      issues.push({ path: p, message: `meta.sourceInstanceId=${JSON.stringify(f.meta.sourceInstanceId)} 未回指实例 ${instance.instance_id}` });
    }
    if (f.meta.sourceTemplateId !== instance.template_id) {
      issues.push({ path: p, message: `meta.sourceTemplateId=${JSON.stringify(f.meta.sourceTemplateId)} 未回指模板 ${instance.template_id}` });
    }
    if (f.meta.sourceRevision !== ctx.revision) {
      issues.push({ path: p, message: `meta.sourceRevision=${JSON.stringify(f.meta.sourceRevision)} 不等于 ctx.revision=${JSON.stringify(ctx.revision)}` });
    }
    if (f.path.trim().length === 0 || f.path.startsWith("/") || f.path.includes("..")) {
      issues.push({ path: p, message: `path 必须是相对仓库根的安全路径，实得 ${JSON.stringify(f.path)}` });
    }
  });
  return { files: issues.length === 0 ? files : [], issues };
}
