/**
 * 「新建画布 → 选模板」画廊的 **mock 目录**（UI 先行原型，ADR-003 / ADR-023 签核第 ① 件材料）。
 *
 * ⚠ 纯前端 mock，**不接后端**。本轮不新建「用户选了哪个模板」的写路径——后端目前也没有它。
 *   这里只把 `packages/fabric-markdown` 里**已迁移就绪**的 19 个工作坊模板 +（mindmap / 空白）
 *   两个起点，投影成一个可点、可预览的画廊。
 *
 * ## 不造第二份事实源（CLAUDE.md「同一事实不得声明在两处」）
 *   · 模板 **key** 的权威 = 各 `registerTemplate({ key })` 调用（`listTemplates()` 读得到）。
 *   · 模板 **中文标题** 的权威 = 各 `TemplateSpec.title`（`getTemplate(key).title`）。
 *   本文件**不抄** key 列表、也**不抄**标题字面量——分类归属、一句话用途（blurb）、图标字形
 *   是**新的展示层事实**（画廊独有），才写在这里。标题一律从 `getTemplate` 现取。
 */
import { getTemplate, listTemplates } from "@repo/fabric-markdown";

export type TemplateCategoryId = "user" | "strategy" | "story" | "blank";

export interface TemplateCatalogEntry {
  /** fabric-markdown 注册表 key（persona / swot / journey-map …），或伪起点 blank / mindmap。 */
  key: string;
  /** 分类归属（画廊分组，展示层事实）。 */
  category: TemplateCategoryId;
  /** 单字形图标（占位缩略，展示层事实——不渲染完整画布缩略图，见 design-note）。 */
  glyph: string;
  /** 一句话用途（画廊独有文案，展示层事实）。 */
  blurb: string;
}

export interface TemplateCategory {
  id: TemplateCategoryId;
  label: string;
  hint: string;
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { id: "user", label: "用户研究", hint: "理解用户是谁、要完成什么、旅程如何" },
  { id: "strategy", label: "战略分析", hint: "看清市场、商业模式与增长节奏" },
  { id: "story", label: "叙事沟通", hint: "把洞察讲成一个能对齐的故事" },
  { id: "blank", label: "从空白起手", hint: "不套框架，自己搭结构" },
];

/**
 * 分类归属 + blurb + glyph（展示层事实）。**只列 key 与新增字段**——标题从注册表取。
 * blank / mindmap 是「起点」而非注册模板，单独定义初始 markdown（见下方 STARTER_MD）。
 */
const CATALOG_META: TemplateCatalogEntry[] = [
  // 用户研究类
  { key: "persona", category: "user", glyph: "🧑", blurb: "给目标用户一张有血有肉的画像卡" },
  { key: "empathy", category: "user", glyph: "💭", blurb: "从「说做想感」四象限走进用户内心" },
  { key: "jtbd", category: "user", glyph: "🎯", blurb: "用户到底雇你的产品来完成什么工作" },
  { key: "journey-map", category: "user", glyph: "🗺️", blurb: "逐阶段还原用户体验的高峰与低谷" },
  { key: "value-proposition", category: "user", glyph: "🎁", blurb: "让产品的价值刚好落在用户痛点上" },
  { key: "adlib", category: "user", glyph: "📣", blurb: "一句话填空，说清你的价值主张" },
  { key: "hmw", category: "user", glyph: "❓", blurb: "把痛点翻译成「我们可以怎样」的机会" },
  // 战略分析类
  { key: "pestel", category: "strategy", glyph: "🌐", blurb: "从政经社技环法六维扫描外部环境" },
  { key: "swot", category: "strategy", glyph: "⚖️", blurb: "优势/劣势/机会/威胁四格盘点自身" },
  { key: "bmc", category: "strategy", glyph: "🧩", blurb: "九宫格一页看透一门生意怎么转" },
  { key: "mvp", category: "strategy", glyph: "🧪", blurb: "把假设变成可验证的最小实验" },
  { key: "three-horizons", category: "strategy", glyph: "📈", blurb: "在守成、扩张与探索间分配注意力" },
  { key: "ai-strategy", category: "strategy", glyph: "🤖", blurb: "梳理 AI 能力落到业务的切入点" },
  { key: "ai-bmc", category: "strategy", glyph: "🧠", blurb: "为 AI 原生业务重画的商业模式画布" },
  // 叙事沟通类
  { key: "freytag", category: "story", glyph: "🎭", blurb: "用戏剧金字塔组织有张力的叙事" },
  { key: "burger", category: "story", glyph: "🍔", blurb: "汉堡结构让沟通有开场、有料、有收尾" },
  { key: "golden-circle", category: "story", glyph: "🟡", blurb: "从 Why 出发，讲清为什么值得相信" },
  { key: "three-lenses", category: "story", glyph: "🔍", blurb: "用三重透镜检视同一个决策" },
  { key: "storyboard", category: "story", glyph: "🎬", blurb: "分格画面预演一段体验或方案" },
];

/**
 * 「起点」（非注册模板）：空白画布与空白思维导图。
 * mindmap 起点专为演示 `interactions/mindmap-editor.ts` 的 Tab=子节点 / Enter=同级节点。
 */
export const STARTER_ENTRIES: Array<TemplateCatalogEntry & { title: string; starterMd: string }> = [
  {
    key: "mindmap",
    category: "blank",
    glyph: "🌿",
    title: "思维导图 Mindmap",
    blurb: "空白中心主题起步 · Tab 加子节点、Enter 加同级",
    starterMd: [
      "```mermaid",
      "mindmap",
      "  root((新思维导图))",
      "    分支一",
      "      要点 A",
      "      要点 B",
      "    分支二",
      "    分支三",
      "```",
    ].join("\n"),
  },
  {
    key: "blank",
    category: "blank",
    glyph: "⬜",
    title: "空白画布 Blank",
    blurb: "不套任何框架，从一个占位节点自由发挥",
    starterMd: ["```mermaid", "flowchart LR", '  start["双击改我 · 从这里开始"]', "```"].join("\n"),
  },
];

/** 画廊完整条目（注册模板 + 起点）。标题懒取自注册表，避免二次声明。 */
export interface GalleryItem extends TemplateCatalogEntry {
  /** 中文标题（注册模板取 `getTemplate(key).title`；起点取自身 title）。 */
  title: string;
  /** 是否为注册的 fabric-markdown 模板（false = 起点）。 */
  isTemplate: boolean;
}

export function galleryItems(): GalleryItem[] {
  const templates = CATALOG_META.map((m) => {
    const spec = getTemplate(m.key);
    return { ...m, title: spec?.title ?? m.key, isTemplate: true };
  });
  const starters = STARTER_ENTRIES.map((s) => ({
    key: s.key,
    category: s.category,
    glyph: s.glyph,
    blurb: s.blurb,
    title: s.title,
    isTemplate: false,
  }));
  return [...templates, ...starters];
}

/** 断言：画廊覆盖注册表里的每一个 key（漏一个就说明迁移的模板没进画廊）。 */
export function coverageGap(): string[] {
  const inGallery = new Set(CATALOG_META.map((m) => m.key));
  return listTemplates()
    .map((t) => t.key)
    .filter((k) => !inGallery.has(k));
}

/**
 * 选中一个条目 → 产出**能直接喂给 `CanvasStage` 的初始 markdown**。
 * 这是「选了模板 → 画布从那个模板起手」这条链路的接点：真实组件、真实解析。
 *
 * @param seeded 为 true 时对少数演示模板填入拟真内容（信息密度演示），否则空框起手。
 */
export function starterMarkdownFor(key: string, seeded = false): string {
  const starter = STARTER_ENTRIES.find((s) => s.key === key);
  if (starter) return starter.starterMd;
  if (key === "persona") {
    return [
      "```persona",
      seeded
        ? [
            "标题: 王敏 · 园区能源主管",
            "职位: 工商业园区 运营负责人",
            "",
            "## 用户描述",
            "- 43 岁，管理一个 12 万㎡ 的工商业园区",
            "- 对电费账单敏感，但不懂储能技术细节",
            "## 目标和需求",
            "- 把峰谷电费差价变成可预期的成本节约",
            "- 一页能看懂的回本测算，好向老板汇报",
            "## 行为与偏好",
            "- 先看同行案例，再看数字",
            "- 微信里问，不爱填表单",
            "## 痛点和挑战",
            "- 回本周期看不清，不敢拍板",
            "- 并网审批各地口径不一",
            "## 动机",
            "- 今年的降本 KPI 压力",
            "## 影响因素",
            "- 老板的风险偏好、财务的口径",
          ].join("\n")
        : "标题: （点标题填写画像姓名）",
      "```",
    ].join("\n");
  }
  // 通用注册模板：一个 `模板: <key>` 围栏即渲染出该模板的锁定框架。
  const body = seeded && key === "journey-map"
    ? [
        `模板: ${key}`,
        "阶段1: 认知",
        "阶段2: 考虑",
        "阶段3: 决策",
        "阶段4: 使用",
        "阶段5: 拥护",
        "## 行为 · 阶段1",
        "- 刷到同行降本案例 #green",
        "## 行为 · 阶段2",
        "- 找了三家供应商比价",
        "## 触点 · 阶段3",
        "- 要一份能给老板看的测算 #blue",
        "## 痛点 · 阶段2",
        "- 担心回本测算不靠谱 #pink",
        "## 行为 · 阶段4",
        "- 上线后盯着每月账单",
        "## 机会 · 阶段5",
        "- 愿意在园区群里推荐",
      ].join("\n")
    : `模板: ${key}`;
  return ["```canvas", body, "```"].join("\n");
}
