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
import { listTemplates, type ListTemplatesDeps } from "../canvas/list-templates";

/** prompt 拼接只需要这四个字段——不是 `CanvasTemplateListing` 的全部（`version`/`status`/
 *  `builtin`/`visibility`/`underlyingType`/`usageCount` 都是列表页用的展示字段，模型不需要）。 */
export interface CanvasTemplateGuidanceInfo {
  readonly key: string;
  readonly displayName: string;
  /**
   * 分区——现查现拼，不是写死的常量。见文件头「动态」那节。
   *
   * ⚠ `type` 决定它是**正文分区**还是**表头字段**：`短文本` 是表头（persona 的
   *   姓名/年龄/职位…），其余（便利贴列表 / 长文本）是正文。2026-08-26 之前库里
   *   没有这个事实，所以表头只能去 `@repo/fabric-markdown` 单独取；现在它在库里，
   *   见下方 `listPublished` 的注释。
   *
   * ⚠ `layout.max`——分区自己配置的**条数上限**（template-admin 里显示的
   *   「N 列 · M 条」的那个 M）。之前这里的类型只声明了 `name`/`type`，
   *   `listPublished` 却透传了完整的 `SectionDef`（`layout` 一直在运行时数据里，
   *   只是类型把它挡在外面看不见）——于是 `buildCanvasTemplateGuidance` 只能给出
   *   一句放之四海皆准的「3~6 条」，模型不知道这个模板具体配的上限是多少，写
   *   4 条也完全在那句模糊指引的允许范围内，跟后台配置的容量对不上（真实 bug，
   *   2026-08-30 人类实测复现：template-admin 配的「3 列 · 6 条」，chat 生成的
   *   画像每个分区只有 4 条）。现在把 `layout` 也声明出来，指引按分区各自的
   *   `max` 说清楚要求，不再统一套用一句通用文案。
   */
  readonly sections: readonly {
    readonly name: string;
    readonly type?: string;
    readonly layout?: { readonly max?: number } | null;
  }[];
  /**
   * 表头字段名（如 persona 的「姓名/性别/年龄…」）。
   *
   * 这条线不接的后果是真实 bug：没有这段指引，模型产出的 persona 围栏只有便签、
   * 没有表头字段值，前端渲染出的画像卡片姓名/年龄/职位一律空白——2026-08-19 人类
   * 实测复现过。
   *
   * ## 2026-08-26：来源从 package 改为**库里的 `短文本` 分区**
   *
   * 原先它取 `@repo/fabric-markdown` 的 `TemplateSpec.fields`。当时那是唯一有这份
   * 事实的地方：契约的 `SectionDef[]` 里没有字段概念。
   *
   * ⚠ 那天的回填把表头字段**落成了 `type: "短文本"` 的分区**（为了让人类能查看和
   *   修改它们）。于是同一批名字同时出现在两处，拼出来的指引变成
   *   `persona〔姓名/…/用户描述/…〕，表头字段〔姓名/…〕`——而格式说明要求分区写
   *   `## 姓名`、表头写 `姓名: 值`，模型会两边都写或者选错一边。**产出结构错了，
   *   而指引本身读起来完全通顺**，这正是它难被发现的原因。
   *
   * 所以改成从 `短文本` 分区推。**不再读 package**：同一件事实两处声明是本仓已经
   * 栽过五次的形状，而这次两处还会打架。副作用是组织自建模板也能有表头字段了
   * （只要它有短文本分区）——那是对的，不是意外。
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
 * ⚠ 2026-08-26 起**不再读** `@repo/fabric-markdown` 取 `fields`：那份事实现在在库里
 *   （表头字段 = `type: "短文本"` 的分区）。同一件事实两处声明是本仓栽过五次的形状，
 *   而回填之后这两处还会打架——见 `CanvasTemplateGuidanceInfo.fields` 的注释。
 */
export function createCanvasTemplateGuidancePort(deps: ListTemplatesDeps): CanvasTemplateGuidancePort {
  return {
    listPublished: async (orgId, userId) => {
      const { templates } = await listTemplates(deps, { userId, orgId, filter: "published" });
      // ⚠ 原样透传 `sections`（含 `type`/`layout`）。表头/正文的切分、`layout.max` 怎么
      //   写进指引文案，全部交给 `buildCanvasTemplateGuidance` 一处做——在这里先切一遍、
      //   拼接处再切一遍，就是同一条规则的第二份副本。
      return templates.map((t) => ({
        key: t.key,
        displayName: t.displayName,
        sections: t.sections,
      }));
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
/**
 * 稳定哨兵行，抽成常量而不是内联字面量——`loopback-model-provider.ts` 需要判定
 * 「这段指引真的被拼进了 system prompt」，与 `RUN_SCRIPT_PROTOCOL_PROMPT` /
 * `FOLLOWUP_SUGGESTIONS_SYSTEM_PROMPT` 同一条既有纪律：唯一事实源是产品代码里的
 * 这一个常量，判定方 import 它，不在测试侧另抄一份字面量（本仓已因字面量重复漂移过
 * 五次，见 AGENTS.md「同一事实不得声明在两处」）。
 */
export const CANVAS_GUIDANCE_HEADER = "## 工作坊协作画布（canvas 围栏）";

/**
 * 推理内容的标记（2026-09-10 人类实测：devapp 上生成的商业模式画布「关键合作伙伴」
 * 「收入来源」「成本结构」三块是空的）。
 *
 * ## 为什么"补全"和"不编造"不矛盾
 *
 * 之前的指引只说了「每个分区都必须写」，没说**用户没聊到的分区怎么办**。模型面对
 * 一个对话里根本没提过的分区（商业模式画布的成本结构，用户只聊了产品想法），在
 * 「必须写」与「不许瞎编」之间，选了跳过——于是画布上凭空缺一块。人类要的既不是
 * 空白、也不是把推测冒充成用户说过的话，而是**补上并标注出处**：标了 `（推理）`
 * 的条目，用户一眼能分辨哪些是自己说过的、哪些是 AI 替他补的，可以直接在画布上改
 * 或删——这是工作坊画布的用法（便签本来就是给人改的），空白框才是没法改的那个。
 *
 * ⚠ 抽成常量而不是内联字面量：指引文案、单测判定共用同一个字符串，与
 *   `CANVAS_GUIDANCE_HEADER` 同一条纪律（AGENTS.md「同一事实不得声明在两处」）。
 */
export const CANVAS_INFERRED_MARKER = "（推理）";

export function buildCanvasTemplateGuidance(
  templates: readonly CanvasTemplateGuidanceInfo[],
): string | null {
  if (templates.length === 0) return null;
  const lines = [
    CANVAS_GUIDANCE_HEADER,
    "除了 mermaid 图表（flowchart / 时序图 / 思维导图等标准图表，单人产出、渲染即完成），"
      + "你还可以用 ```canvas 围栏产出**工作坊协作画布**——这是团队用便签协作填写的结构化模板，"
      + "不是另一种画图方式，也不是普通图表。canvas 围栏是它的产出语法：把内容按模板的分区整理成"
      + "要点，前端会把它渲染成可贴便签、可多人协作的画布。只在内容真的适合按「协作模板的固定"
      + "分区」组织时才用；单纯讲清楚一个流程或结构，仍然优先用 mermaid 图表。",
    "本组织已配置（已发布）的协作模板：",
    ...templates.map((t) => {
      // issue #3333：指引里列出的分区必须与渲染时**实际会画出来**的分区一致，否则
      // 模型会按指引老老实实把内容写全，前端却没有对应的框可画——多出来的内容要么
      // 挤进"便签暂存·待归类"，要么干脆看不见，用户看到的结果与后台编辑好的模板
      // 对不上（`fence-template-resolver.ts`/`template-simulate-dialog.tsx` 用
      // `hasPlacedSection` 判定：只要有分区放置了，未放置的分区就不参与渲染）。
      // 这里镜像同一条判据：至少有一个分区放置了 ⇒ 只把"已放置"的分区列进指引；
      // 一个都没放置（老模板从没走过拖拽编辑器，`layout` 全部缺失）⇒ 仍列出全部
      // 分区，与全量退回自动布局、全部分区都会被画出来的渲染行为一致。
      const placed = t.sections.some((s) => s.layout != null)
        ? t.sections.filter((s) => s.layout != null)
        : t.sections;
      // 表头 vs 正文的**唯一**切分处。判据是分区自己的 `type`（库里的事实），
      // 不是另一份清单——见 `CanvasTemplateGuidanceInfo.fields` 的注释。
      const header = placed.filter((s) => s.type === "短文本").map((s) => s.name);
      // 「文本对象」（标题/固定文案块）是设计时静态装帧，不是要 AI 填的正文分区
      // （同 `SectionDef.content` 文档），不进 `bodySections`，也不要求 AI 产出它的内容。
      const bodySections = placed.filter((s) => s.type !== "短文本" && s.type !== "文本对象");
      /**
       * ⚠ 2026-09-10 人类实测：产出的围栏里写着 `## 阶段2行为（最多4条）`，渲染出来
       *   整块是空的。根因就在这里——条数上限此前被拼进**分区名本身**
       *   （`${s.name}(最多${max}条)`），而下面那句指引说「分区名必须与该模板列出的
       *   分区名逐字一致」。模型两条都照做了：它逐字复制了列出的那个名字，连括号一起。
       *   `lookupSectionItems` 按真名精确匹配，`## 阶段2行为（最多4条）` 对不上
       *   `阶段2行为`，那个分区的要点被静默丢弃 —— 与 #2549 / #2576 / #2653 同一种
       *   「静默丢内容」的形状，只是这次是我们自己把陷阱写进了提示词。
       *
       *   改法：〔〕里**只放真名**，条数上限另起一行单独说（下面 `capsNote`）。
       *   名字这件事从此只有一个写法，模型没有第二种可复制的形态。
       */
      const body = bodySections.map((s) => s.name);
      const caps = bodySections
        .map((s) => ({ name: s.name, max: s.layout?.max }))
        .filter((c): c is { name: string; max: number } => c.max != null && c.max > 0);
      const capsNote = caps.length > 0
        ? `，条数上限〔${caps.map((c) => `${c.name}=${c.max}条`).join("/")}〕`
        : "";
      // 兼容 2026-08-26 回填之前建的模板：它们的分区没有 `type`，全部落进 `body`，
      // 于是 `fields` 仍可由调用方显式给（老路径），拼接行为与改动前逐字一致。
      const fields = header.length > 0 ? header : (t.fields ?? []);
      const fieldsNote = fields.length > 0 ? `，表头字段〔${fields.join("/")}〕` : "";
      return `- ${t.key}〔${body.join("/")}〕${fieldsNote}${capsNote}`;
    }),
    "格式：",
    "```canvas",
    "模板: <key>",
    "字段名: 字段值",
    "## 分区名",
    "- 要点",
    "```",
    "只用上面列出的模板 key；分区名必须与该模板列出的分区名逐字一致，不要自己发明分区或模板。",
    "⚠ `## ` 后面**只写分区名本身**——不要加括号、条数、编号、序号或任何补充说明。"
      + "「条数上限〔…〕」是另一处给你的信息，不是名字的一部分：写成 `## 阶段2行为（最多4条）` "
      + "会让这个分区匹配不上，整块渲染成空白（2026-09-10 人类实测就是这么丢的）。"
      + "正确写法是 `## 阶段2行为`。",
    "⚠ **分区名要一个字不差地照抄，包括顺序、分隔符和数字写法。**〔〕里用 `/` 隔开的是"
      + "**不同的分区**，`/` 本身不是名字的一部分；除此之外每个名字里的字符（中点 `·`、"
      + "空格、中英文、编号）都属于名字。三种真实栽过的写法，一种都不要出现："
      + "① **换顺序**——名字是两个维度交叉出来的（如 `行为 · 阶段1` = 泳道 × 阶段）时，"
      + "不要重排成 `阶段1行为`；② **丢分隔符**——`行为 · 阶段1` 不要写成 `行为阶段1`；"
      + "③ **换数字写法**——`阶段1` 不要写成 `阶段一`。"
      + "（2026-09-10 人类实测：一张 20 格的旅程图三种全犯，整张画布一条内容都没渲染出来。）",
    "⚠ 上面〔〕里列出的每一个分区名都必须在围栏里出现一次 `## 分区名` 并写要点、" +
      "每一个「表头字段」也都必须给出字段值——少写一个分区、或者写了标题却不给要点，" +
      "前端会把它渲染成一块空白区域（issue #2605 实测：「开场引入」有标题没内容，" +
      "用户看到的是画布里凭空缺一块）。写完整段围栏后，逐一对照〔〕里的分区名清单" +
      "与表头字段清单检查有没有漏掉的，漏了就补上，不要因为这个分区“不好写”就跳过。",
    "⚠ **对话里没聊到的分区/字段不是跳过的理由**——那正是画布出现空白块的原因。" +
      "遇到用户没明说的内容，基于已有上下文（这次对话讲过的目标与场景、项目背景、" +
      `同一张画布其他分区已经写下的内容、该模板本身的行业常识）**推理**出合理内容填上，` +
      `并在这一条要点（或这一个字段值）的**末尾**加上 \`${CANVAS_INFERRED_MARKER}\` 标记，` +
      "例如：`- 与本地物流服务商共建履约网络" + CANVAS_INFERRED_MARKER + "`。" +
      "整张画布必须是填满的：宁可给一条标注了来源的合理推理，也不要留一块空白框——" +
      "标注过的推理用户可以直接在画布上改或删，空白框他只能自己从头写。",
    `⚠ 只有推理出来的内容才标 \`${CANVAS_INFERRED_MARKER}\`；用户在对话里明确说过的内容` +
      "照原样写、不要标——满屏都是标记等于没有标记，用户就分不出哪些还需要他确认了。" +
      "也不要因为标了这个记号就写得敷衍：推理内容同样要具体、可讨论，" +
      "不要写「待补充」「暂无」「需进一步调研」这类占位词充数——那和空白框没有区别。",
    "⚠ **画布画的是对话里那个业务主题，不是这段对话本身**——2026-09-10 人类实测：前面在聊"
      + "一家餐馆的员工旅程，接着让产出 SWOT，产出的却是「画布严格遵循 journey-map 模板定义」"
      + "「PESTEL 分析需将已有内容重新归类映射」这类条目：模板对了、格式对了、**主语全错**。"
      + "动笔前先认准这张画布的**分析对象**——用户在聊的那个业务主体（某家餐馆、某个产品、"
      + "某个团队），它是每一条要点的主语。",
    "「怎么生成这张画布」「模板字段/分区/渲染/工具好不好用」「AI 产出的质量与迭代过程」"
      + "属于**元讨论**：哪怕它在对话里真实出现过、甚至占了大半篇幅，也一律不进画布。"
      + "每写一条要点自检一次——这条讲的是那个业务主体，还是在讲我们刚才这次协作过程？"
      + "是后者就删掉重写。同一段对话里已经产出过的其他画布是这个业务主体的**素材**，"
      + "新画布接着分析同一个主体，不是去分析「上一张画布做得怎么样」。",
    "每个分区尽量给 3~6 条要点，别不管三七二十一每个分区只给 1 条——" +
      "画布是给团队协作用的，条目太少留白太多不像样；确实没那么多可写的内容时给少一点也可以，" +
      "但不要在内容明明够写的情况下偷懒只给一条。",
    "⚠ 「条数上限〔分区名=N条〕」是这个模板在后台配置的容量——那不是随便写的建议，"
      + "是这块画布实际能放下的条数，按 N 尽量写满，不要明显少于 N（比如上限是 6 条，只写 3~4 条"
      + "就是没写够）；没有列出上限的分区仍按上面那句「3~6 条」的通用区间来写。"
      + "再说一遍：这个 N 只影响你写几条，**不进 `## ` 那一行**。",
    "如果该模板列了「表头字段」，在 `模板: <key>` 之后、第一个 `## 分区` 之前，逐行写"
      + "「字段名: 字段值」（字段名必须与列出的表头字段逐字一致）——这些是模板顶部的表头信息"
      + "（如用户画像的姓名/年龄/职位），不写就会渲染成空白表头，所以内容里但凡出现能对应上的"
      + "信息就要写进去；对话里没提到的表头字段同样按上面那条推理补全并标 `"
      + CANVAS_INFERRED_MARKER + "`（如 `年龄: 32 岁" + CANVAS_INFERRED_MARKER + "`），"
      + "不要整行省略；没有表头字段的模板（未在上面列出「表头字段」）不要凭空产出这类行。",
    "⚠ `模板: <key>` 必须是 ```canvas 围栏内的第一行，一个字都不能漏、也不能挪到后面——"
      + "漏写这一行不是「降级显示」，是前端完全无法解析，用户只会看到一条报错，"
      + "整段内容白写。写完整段围栏后，回头检查第一行是不是逐字的 `模板: <key>`。",
  ];
  return lines.join("\n");
}
