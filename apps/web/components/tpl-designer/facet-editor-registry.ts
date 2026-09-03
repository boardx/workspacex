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
import { FacetTextEditor, type FacetSaveFn } from "./facet-content-editor";
import { TopicPanelEditor } from "./topic-panel-editor";
import { GroupingPanelEditor } from "./grouping-panel-editor";
import { AgendaPanelEditor } from "./agenda-panel-editor";
import { SurveyPanelEditor } from "./survey-panel-editor";
import { InterviewPanelEditor } from "./interview-panel-editor";
import { PreTasksPanelEditor } from "./pre-tasks-panel-editor";
import { VenuePanelEditor } from "./venue-panel-editor";
import { MaterialsPanelEditor } from "./materials-panel-editor";
import { PrintPanelEditor } from "./print-panel-editor";
import { AgentPanelEditor } from "./agent-panel-editor";
import { SkillPanelEditor } from "./skill-panel-editor";
import { OutputsPanelEditor } from "./outputs-panel-editor";
import { ReportPanelEditor } from "./report-panel-editor";

/**
 * 每项面板顶部「这一项是干什么的」解释段（原型 `designer-panels.tsx` 的 `<Intro>`）。
 *
 * ⚠ 为什么并进本文件而不是单开一个 `facet-intro-table.ts`：那样做过一版，
 * `lint-design-facet-single-source.mjs` 的规则 2b 立刻判它是「第三张 design-facet 表」
 * 并变红——而该门控的头注早就写明「会真正冲突的是『第三张也想叫路由表』」。
 * 门控是对的：I-5 说的就是**一张表一个文件**。key → 渲染什么、key → 解释段是
 * 同一张前端投影表的两列，不该拆成两个文件各列一遍 15 个 key。
 * 所以并进来，`SOURCE_RELS` 不需要加第三个豁免。
 *
 * 防漂移：`blueprint-designer-prototype-fidelity.test.tsx` 拿 `lib/mock/tpl.ts` 的
 * `*_PANEL.intro` 逐条 `toEqual`，原型文案一改这里不跟着改就会红并指名是哪个 key。
 */
export const FACET_INTRO: Readonly<Record<string, string>> = {
  "topic-and-background":
    "套用后，项目的「定题与分组」页会拿这两个字段开局：主题是一句可判定的问题，背景是这一场的约束与已知结论。蓝本定的是句式与要素，不是内容。",
  "flow-agenda":
    "环节按半场编排，每半场自成一个闭环，有自己的产出与收口。每个环节要说清三件事：产出什么、三种角色各干什么、绑哪个画布与 Skill。没写产出物的环节不能保存——那是闲聊不是环节。",
  "grouping-rule":
    "套用后自动生成分组卡片：几组、每组多少人、每组认领哪个场景、组长怎么选。场景清单是这里最值钱的部分——它决定四个组不会讨论同一件事。",
  survey:
    "蓝本预置问卷骨架和发放时机，不是具体题目。套用时 AI 按这次的议题把占位题目补成具体问法。",
  "interview-and-subjects":
    "蓝本规定要访谁、访多少场、提纲骨架。访谈是会前最贵的一步，写进蓝本能避免每次重新设计。",
  "pre-tasks":
    "每项任务必须挂到具体环节，并写清「不做会怎样」。挂不上环节的任务就是无意义的作业，参与者能感觉到。",
  "venue-and-format":
    "场地不是后勤细节，它决定分组能不能真的分开讨论。写成清单，套用时直接变成待办。",
  "project-materials":
    "现场用的东西一次列清。套用后自动变成一张准备清单，并按实际组数换算数量。",
  "print-materials":
    "打印件和线上画布必须同构，否则贴完纸没法数字化，白干一遍。",
  "agent-orchestration":
    "不是把所有 agent 都拉进来，而是规定每个环节谁在场、能做什么。同时在场的 AI 超过两个，现场会变吵。",
  "skill-binding":
    "Skill 绑在环节上而不是绑在人上。到了那个环节，对应的 skill 自动可用，引导师不用记它叫什么。",
  outputs:
    "项目结束时必须存在的东西。每件产出都要指定生成方式与去向——去向决定它会不会被人再看一眼。",
  "report-template":
    "报告的骨架写死，内容留空。结论先行、每条结论必须挂证据——这两条是模板的作用，不是写作风格偏好。",
};

/** 未登记的 key（第 16 项「基本配置」不是 designFacetKey）返回 null，调用方不渲染。 */
export function getFacetIntro(designFacetKey: string): string | null {
  return FACET_INTRO[designFacetKey] ?? null;
}

export interface FacetEditorProps {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
  readonly onSave: FacetSaveFn;
}

const STRUCTURED_FACET_EDITORS: Record<string, ComponentType<FacetEditorProps>> = {
  "topic-and-background": TopicPanelEditor,
  "grouping-rule": GroupingPanelEditor,
  "flow-agenda": AgendaPanelEditor,
  survey: SurveyPanelEditor,
  "interview-and-subjects": InterviewPanelEditor,
  "pre-tasks": PreTasksPanelEditor,
  "venue-and-format": VenuePanelEditor,
  "project-materials": MaterialsPanelEditor,
  "print-materials": PrintPanelEditor,
  "agent-orchestration": AgentPanelEditor,
  "skill-binding": SkillPanelEditor,
  outputs: OutputsPanelEditor,
  "report-template": ReportPanelEditor,
};

/**
 * 未登记的 key 落回通用编辑器——**纯兜底**。
 *
 * ⚠ 定义表里的 13 个 designFacetKey（2026-08-31 起：`roles-and-perms`/
 *   `group-capabilities` 已按产品决策移除，原 15 项降为 13 项）现在**一个都不会**
 *   走到这里（F204–F207 补齐）。
 * 这个分支保留是为了「表里新增了一项、但还没写它的编辑器」时不至于白屏；
 * 真发生了会被那条机械门控抓住（遍历 DESIGN_FACET_CATALOG 断言无一落回 FacetTextEditor），
 * 而不是靠人发现。别把它读成「大多数项还是自由文本」——那是 F204 之前的状态。
 */
export function getFacetEditor(designFacetKey: string): ComponentType<FacetEditorProps> {
  return STRUCTURED_FACET_EDITORS[designFacetKey] ?? FacetTextEditor;
}
