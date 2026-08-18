/**
 * designFacetKey → 结构化编辑器组件 的路由表——**唯一定义处**（I-5：一张表一个文件）。
 *
 * ⚠ 不要在别处（比如 `blueprint-designer-shell.tsx`）再写一份
 *   `selectedKey === "..."` 判断链——`lint-design-facet-single-source.mjs` 的
 *   规则 2b 专门抓这种「跨行第二份表」（同一文件里出现 ≥3 个不同 facet key
 *   字面量），加第 4 个结构化编辑器时曾真实撞过（F202 复核发现）。
 *   新增结构化编辑器只改这一个文件：往 `STRUCTURED_FACET_EDITORS` 加一行。
 *
 * 这张表回答的是「哪个 key 对应哪个 React 组件」，跟
 * `apps/api/src/domain/templates/design-facet-table.ts`（回答「这些 key 分别叫什么/
 * 属于哪组/是否必填」）是两件不同的事——不是同一份事实的第二份拷贝，只是恰好都
 * 需要提到 facet key 字面量，所以同样要收敛到单一文件。
 */
import type { ComponentType } from "react";
import { FacetTextEditor, PermissionMatrixEditor, type FacetSaveFn } from "./facet-content-editor";
import { TopicPanelEditor } from "./topic-panel-editor";
import { GroupingPanelEditor } from "./grouping-panel-editor";
import { AgendaPanelEditor } from "./agenda-panel-editor";
import { SurveyPanelEditor } from "./survey-panel-editor";
import { InterviewPanelEditor } from "./interview-panel-editor";
import { PreTasksPanelEditor } from "./pre-tasks-panel-editor";
import { VenuePanelEditor } from "./venue-panel-editor";
import { MaterialsPanelEditor } from "./materials-panel-editor";
import { PrintPanelEditor } from "./print-panel-editor";
import { CapsPanelEditor } from "./caps-panel-editor";
import { AgentPanelEditor } from "./agent-panel-editor";
import { SkillPanelEditor } from "./skill-panel-editor";
import { OutputsPanelEditor } from "./outputs-panel-editor";
import { ReportPanelEditor } from "./report-panel-editor";

export interface FacetEditorProps {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
  readonly onSave: FacetSaveFn;
}

const STRUCTURED_FACET_EDITORS: Record<string, ComponentType<FacetEditorProps>> = {
  "roles-and-perms": PermissionMatrixEditor,
  "topic-and-background": TopicPanelEditor,
  "grouping-rule": GroupingPanelEditor,
  "flow-agenda": AgendaPanelEditor,
  survey: SurveyPanelEditor,
  "interview-and-subjects": InterviewPanelEditor,
  "pre-tasks": PreTasksPanelEditor,
  "venue-and-format": VenuePanelEditor,
  "project-materials": MaterialsPanelEditor,
  "print-materials": PrintPanelEditor,
  "group-capabilities": CapsPanelEditor,
  "agent-orchestration": AgentPanelEditor,
  "skill-binding": SkillPanelEditor,
  outputs: OutputsPanelEditor,
  "report-template": ReportPanelEditor,
};

/**
 * 未登记的 key 落回通用编辑器——**纯兜底**。
 *
 * ⚠ 定义表里的 15 个 designFacetKey 现在**一个都不会**走到这里（F204–F207 补齐）。
 * 这个分支保留是为了「表里新增了一项、但还没写它的编辑器」时不至于白屏；
 * 真发生了会被那条机械门控抓住（遍历 DESIGN_FACET_CATALOG 断言无一落回 FacetTextEditor），
 * 而不是靠人发现。别把它读成「大多数项还是自由文本」——那是 F204 之前的状态。
 */
export function getFacetEditor(designFacetKey: string): ComponentType<FacetEditorProps> {
  return STRUCTURED_FACET_EDITORS[designFacetKey] ?? FacetTextEditor;
}
