/**
 * workflow-event-renderer-adapter.ts —— HMV2-017 的收编件：把 H3A-035 的
 * TPL-EVT-001 短文本 renderer（`renderWorkflowEvent`，纯函数）包进 HMV2-013
 * 的 `Renderer` 接口，成为 RendererRegistry 的**第一个真实注册项**。
 *
 * 口径依据：#422 的 HMV2-017 提案主案①（无异议协议，同 HMV2-015 先例）——
 * render 命令不挂空注册表上线；收编**零改动** renderWorkflowEvent 的渲染逻辑，
 * 同 #641 收编 TPL-EVD-001 的先例。这同时兑现 checklist HMV2-025 行早已标注的
 * "未来收编进这张表"。
 *
 * 形状桥接（如实说明）：WorkflowEvent envelope（H3A-033）与 E1 的
 * InstanceMetadata 不同构——envelope 没有 status/scope/refs 三个字段。
 * 桥接规则：status 恒为 "active"（事件是 append-only 的既成事实，没有
 * deprecated 生命周期）；scope.phase 恒为 null（Workflow Event 属于任务流，
 * 不属于某个 phase，同 TPL-MOD-001 不带 scope 的同款理由）；refs 取
 * evidence_refs（语义最接近：都是"这份实例引用了哪些外部证据"）。
 * 这三条是本文件的桥接决策，不是两份 schema 原文规定——写在这里备查。
 *
 * 落盘路径约定：`.harness/generated/events/<instance_id>.md`——#422 提案
 * 主案②的根目录约定（git 跟踪，天然进 HMV2-016 drift gate 扫描面）。
 */
import type { WorkflowEvent } from "./workflow-event-model";
import { renderWorkflowEvent } from "./workflow-event-renderer";
import type { InstanceMetadata } from "./template-model";
import type { Renderer } from "./renderer-model";
import { WORKFLOW_EVENT_TEMPLATE_ID } from "./workflow-event-model";

export const GENERATED_EVENTS_DIR = ".harness/generated/events";

/** envelope → InstanceMetadata 桥接（规则见文件头注释）。 */
export function toInstanceMetadata(event: WorkflowEvent): InstanceMetadata {
  return {
    template_id: event.template_id,
    template_version: event.template_version,
    instance_id: event.instance_id,
    status: "active",
    scope: { project: "workspacex", phase: null },
    refs: [...event.evidence_refs],
    sourceFile: event.sourceFile,
  };
}

/**
 * 构造收编 renderer。用 Map 按 instance_id 持有完整 WorkflowEvent——
 * `Renderer.render` 只拿得到 InstanceMetadata 公共骨架，渲染却需要 kind 特有
 * 字段（delta/blockers/…），所以 adapter 在构造时闭包住事件全集，渲染时按
 * instance_id 取回。查不到 = 调用方把不属于这批事件的实例喂了进来，抛错
 * 让 renderChecked 上层直接失败，不静默渲染空内容。
 */
export function makeWorkflowEventRenderer(events: WorkflowEvent[]): Renderer {
  const byId = new Map(events.map((e) => [e.instance_id, e]));
  return {
    rendererId: "evt-short-text",
    templateId: WORKFLOW_EVENT_TEMPLATE_ID,
    render(instance, ctx) {
      const event = byId.get(instance.instance_id);
      if (!event) {
        throw new Error(`evt-short-text：实例 ${instance.instance_id} 不在本批事件集合里，拒绝渲染`);
      }
      const lines = renderWorkflowEvent(event);
      return [
        {
          path: `${GENERATED_EVENTS_DIR}/${instance.instance_id}.md`,
          content: `${lines.join("\n")}\n`,
          meta: {
            sourceInstanceId: instance.instance_id,
            sourceTemplateId: instance.template_id,
            sourceRevision: ctx.revision,
          },
        },
      ];
    },
  };
}
