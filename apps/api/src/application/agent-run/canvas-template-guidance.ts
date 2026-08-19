/**
 * 「让 chat 用上后台画布模板」方案的**后端块**（issue #1493）—— 发起模型调用前，把本组织
 * 已发布的画布模板清单注入 system prompt，指导模型用 canvas 围栏产出结构化工作坊画布。
 *
 * ## 与 `VISUALIZATION_GUIDANCE`（execute-run.ts）同构，但不是同一份指引
 *
 * mermaid 指引是**静态**的（12 种图类型是 `@repo/contracts` 的固定枚举，不随组织变化）；
 * canvas 指引是**动态**的——分区名直接来自数据库读出的 `SectionDef[].name`，这正是本次要
 * 解决的问题：后台改模板（发布新版/改分区），chat 不能靠一份写死在代码里的清单继续回答旧结构。
 * 因此本文件没有 `VISUALIZATION_GUIDANCE` 那种 `export const XXX_GUIDANCE = [...].join(...)`
 * 的静态常量形态，而是一个读了模板之后**当场拼**的纯函数 `buildCanvasTemplateGuidance`。
 *
 * ## 不重新写查询逻辑：直接复用 `listTemplates` 用例
 *
 * 「哪些模板可见」是 F100/F101（I-5）已经判过的一条规则（`statusesFor` + capability
 * visibility），`list-templates.ts` 头注逐字写着「共用是为了避免第二处过滤声明」。这里若自己
 * 拼一条 `WHERE status = 'published'` 的仓储调用，就是那条纪律点名要避免的第二份副本——
 * `createCanvasTemplateGuidancePort` 因此只是给 `listTemplates` 包一层「按 published 过滤、
 * 摘出 prompt 需要的字段」的薄适配器，判定逻辑一个字节都不重复。
 *
 * ## 用谁的可见性视角：触发这次 run 的那个人（`requesterUserId`）
 *
 * `listTemplates` 的可见性判定（`decideCapabilityVisibility`）需要一个 `userId` 才能算出
 * `team-only` 模板要不要放行。`ClaimedAgentRun.requesterUserId`（F159 已经在用同一个字段做
 * 计量归属）就是这次 run 背后的那个真人——用他的组织角色 + 团队去判，而不是绕开可见性判定
 * 读全组织的库，是与后台模板库、绑定选择器**同一套语义**：一个团队专属模板不应该因为换了
 * 「问 chat」这条路径就对别的团队可见。
 *
 * ## 个人对话与项目对话一视同仁（issue #1493 §6）
 *
 * `listPublished` 只吃 `orgId` + `requesterUserId`，两者在个人线程与项目线程的 claimed run
 * 上都一定存在（`ClaimedAgentRun.projectId` 才是那个可空字段，这里完全不碰它）——个人对话与
 * 项目对话因此天然拿到同一段注入，不需要为个人对话单独分支。
 *
 * ## 失败降级，不 fail run（同 L2/L3/F190 既有纪律）
 *
 * 本文件自身的函数不吞错——`listPublished` 该抛就抛（同 `FileRetrievalPort.search`/
 * `ToolTraceContextPort.recent` 的既有纪律，调用点 `execute-run.ts` 负责降级）。canvas 模板
 * 读取失败与「这个组织没配模板」是同一个可见后果：这一段提示词不出现，run 照常完成——绝不能
 * 因为模板表抖动一下就让整轮聊天失败。
 */
import type { OrgId } from "../../domain/org-id";
import { getTemplate } from "@repo/fabric-markdown/templates";
import { listTemplates, type ListTemplatesDeps } from "../canvas/list-templates";

/** prompt 拼接只需要这四个字段——不是 `CanvasTemplateListing` 的全部（`version`/`status`/
 *  `builtin`/`visibility`/`underlyingType`/`usageCount` 都是列表页用的展示字段，模型不需要）。 */
export interface CanvasTemplateGuidanceInfo {
  readonly key: string;
  readonly displayName: string;
  /** 分区名——现查现拼，不是写死的常量。见文件头「动态」那节。 */
  readonly sections: readonly { readonly name: string }[];
  /**
   * 表头字段名（如 persona 的「姓名/性别/年龄…」）。**只有内置模板有**——`SectionDef[]`
   * 是本仓画布模板契约的唯一模型，字段清单从来没进过它（组织自建模板走
   * `auto-template-layout.ts` 的自动排版器，同样没有字段概念）。内置模板的字段清单
   * 唯一权威在 `@repo/fabric-markdown` 每个 `TemplateSpec.fields`——`undefined`/空数组
   * 时不提字段，模型只按分区产出，与改动前完全一致。
   *
   * 这条线不接的后果是真实 bug，不是纸面推演：没有这段指引，模型产出的 persona 围栏
   * 只有便签、没有表头字段值，前端渲染出的画像卡片姓名/年龄/职位等一律空白——
   * 2026-08-19 人类实测在 chat 里生成的 persona 画布复现了这个问题。
   */
  readonly fields?: readonly string[];
}

export interface CanvasTemplateGuidancePort {
  /** 该组织当前**已发布**、且对 `userId` 可见的画布模板。抛错允许——调用点负责降级。 */
  readonly listPublished: (
    orgId: OrgId,
    userId: string,
  ) => Promise<readonly CanvasTemplateGuidanceInfo[]>;
}

/**
 * `ExecuteAgentRunDeps.canvasTemplates` 的生产实现——薄适配器，不新开查询。
 * `kernel.module.ts` 用与 `CanvasTemplateController` 完全相同的三个依赖
 * （`IdentityRepository` / `CanvasTemplateRepository` / `DecisionIdFactory`）构造它。
 *
 * `fields` 从 `@repo/fabric-markdown/templates`（`templates-entry.ts`，纯 Node 安全，
 * 不碰 fabric/mermaid——与 `persona-summary.ts`/`export-canvas-source.ts` 同一条既有
 * 导入纪律）现查现拼：`getTemplate(t.key)` 命中即内置模板，取其 `fields`；组织自建
 * 模板的 key 在那份注册表里查不到，`getTemplate` 返回 `undefined`，`fields` 随之
 * 缺省——不是遗漏，是「组织自建模板确实没有字段」这条既有事实的如实反映。
 */
export function createCanvasTemplateGuidancePort(deps: ListTemplatesDeps): CanvasTemplateGuidancePort {
  return {
    listPublished: async (orgId, userId) => {
      const { templates } = await listTemplates(deps, { userId, orgId, filter: "published" });
      return templates.map((t) => {
        const fields = getTemplate(t.key)?.fields;
        return {
          key: t.key,
          displayName: t.displayName,
          sections: t.sections,
          ...(fields && fields.length > 0 ? { fields } : {}),
        };
      });
    },
  };
}

/**
 * 拼一段 canvas 围栏指引。空列表（组织没配任何已发布模板）返回 `null`——**不注入**一份
 * 空清单让模型自己编（issue #1493 §3 明确要求二选一，这里选「不注入」：`VISUALIZATION_GUIDANCE`
 * 已经无条件覆盖了纯 mermaid 场景，多一句「当前组织未配置画布模板」的静态提示不会改变模型
 * 行为，只会占 token）。
 *
 * ## 与 `VISUALIZATION_GUIDANCE` 是**两类不同的东西**，措辞必须让模型分得清（人类澄清）
 *
 * mermaid 系列（flowchart/时序图/类图/思维导图/甘特图等 12 种）是**标准图表**——单人产出、
 * 渲染即完成，不接受协作编辑。canvas 模板（persona/用户旅程图/同理心地图/SWOT/商业模式画布…，
 * 内置 19 个 + 组织自建）是**工作坊协作画布**——团队用便签在分区框里协作填写的结构化模板，
 * canvas 围栏只是它的产出语法，不是「另一种画图方式」。两段指引若合并成一段模糊的「可视化
 * 能力」说明，模型会分不清什么时候该产 mermaid、什么时候该产 canvas 围栏，混着说会选错格式——
 * 因此本段标题刻意不用「可视化」三个字（那是 mermaid 那段的标题词），并在正文第一句就点出
 * 「不是图表，是协作模板」这条边界，两段指引在 `buildSystemPrompt` 里各自成段、彼此独立。
 */
export function buildCanvasTemplateGuidance(
  templates: readonly CanvasTemplateGuidanceInfo[],
): string | null {
  if (templates.length === 0) return null;
  const lines = [
    "## 工作坊协作画布（canvas 围栏）",
    "除了 mermaid 图表（flowchart / 时序图 / 思维导图等标准图表，单人产出、渲染即完成），"
      + "你还可以用 ```canvas 围栏产出**工作坊协作画布**——这是团队用便签协作填写的结构化模板，"
      + "不是另一种画图方式，也不是普通图表。canvas 围栏是它的产出语法：把内容按模板的分区整理成"
      + "要点，前端会把它渲染成可贴便签、可多人协作的画布。只在内容真的适合按「协作模板的固定"
      + "分区」组织时才用；单纯讲清楚一个流程或结构，仍然优先用 mermaid 图表。",
    "本组织已配置（已发布）的协作模板：",
    ...templates.map((t) => {
      const fieldsNote = t.fields && t.fields.length > 0 ? `，表头字段〔${t.fields.join("/")}〕` : "";
      return `- ${t.key}〔${t.sections.map((s) => s.name).join("/")}〕${fieldsNote}`;
    }),
    "格式：",
    "```canvas",
    "模板: <key>",
    "字段名: 字段值",
    "## 分区名",
    "- 要点",
    "```",
    "只用上面列出的模板 key；分区名必须与该模板列出的分区名逐字一致，不要自己发明分区或模板。",
    "如果该模板列了「表头字段」，在 `模板: <key>` 之后、第一个 `## 分区` 之前，逐行写"
      + "「字段名: 字段值」（字段名必须与列出的表头字段逐字一致）——这些是模板顶部的表头信息"
      + "（如用户画像的姓名/年龄/职位），不写就会渲染成空白表头，所以内容里但凡出现能对应上的"
      + "信息就要写进去；没有表头字段的模板（未在上面列出「表头字段」）不要凭空产出这类行。",
  ];
  return lines.join("\n");
}
