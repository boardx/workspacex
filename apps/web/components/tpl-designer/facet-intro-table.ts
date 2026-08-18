/**
 * 每个配置项面板顶部的「这一项是干什么的」解释段——**唯一定义处**。
 *
 * ## 为什么单独一张表，而不是各编辑器自己写一段
 *
 * 原型 `apps/web/components/tpl/designer-panels.tsx` 的 `<Intro>` 在 16 个面板顶部
 * 各出现一次，是签核过的设计元素（不是可有可无的装饰）。改造成真实编辑器时，
 * 前 4 项（主题与背景 / 流程 Agenda / 分组规则 / 角色与权限）**整段丢了**，
 * 后 11 项虽然写了这段话，却是各自在组件里手抄一份、样式也与原型的 `<Intro>` 不同。
 * 两种情况都不合格：前者是漏做，后者是「同一事实声明在两处」（根 AGENTS.md 已因此
 * 漂移九次的那条）。
 *
 * 现在收敛成这一张表 + 由 `blueprint-designer-shell.tsx` 的 `FacetPanel` 统一渲染，
 * 15 项一次性对齐，编辑器组件里不再各写各的。
 *
 * ## 防漂移是机械的，不是靠人记得
 *
 * `blueprint-designer-prototype-fidelity.test.tsx` 直接 import `lib/mock/tpl.ts` 的
 * `*_PANEL.intro` 逐条 `toEqual` 本表——原型文案一改，这里不跟着改就会红，
 * 并指名是哪个 key 漂了。
 */
export const FACET_INTRO: Readonly<Record<string, string>> = {
  "topic-and-background":
    "套用后，项目的「定题与分组」页会拿这两个字段开局：主题是一句可判定的问题，背景是这一场的约束与已知结论。蓝本定的是句式与要素，不是内容。",
  "flow-agenda":
    "环节按半场编排，每半场自成一个闭环，有自己的产出与收口。每个环节要说清三件事：产出什么、三种角色各干什么、绑哪个画布与 Skill。没写产出物的环节不能保存——那是闲聊不是环节。",
  "grouping-rule":
    "套用后自动生成分组卡片：几组、每组多少人、每组认领哪个场景、组长怎么选。场景清单是这里最值钱的部分——它决定四个组不会讨论同一件事。",
  "roles-and-perms":
    "分组规则写在蓝本里，现场才不会临时纠结。按职能混编还是按议题自选，直接改变讨论质量。",
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
  "group-capabilities":
    "现场每个小组能直接调用的东西。开得越多越散——蓝本的作用是替引导师先关掉不需要的。",
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
