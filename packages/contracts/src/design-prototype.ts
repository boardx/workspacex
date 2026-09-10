/**
 * UC-17.8 B5.3 —— 设计详情「原型画布」的**结构化 JSON 组件树**。
 *
 * ## 为什么是组件树，不是 HTML 字符串
 *
 * 2026-09-06 人类决策（推翻 B5.2 时「B5.3 仅登记不做」）：画布内容由模型生成，载体选
 * **结构化 JSON 组件树**而非单文件 HTML——
 *   · 前端用真实设计 token（`.dark` 那份）渲染，不需要 iframe 沙箱、不引入任意脚本；
 *   · 树是可校验的：每个节点过 `.strict()`，模型编造的属性/类型进不了库；
 *   · 「之后再做增量修改」（人类原话）在树上是天然的——节点级替换而不是文本 diff。
 * 代价是表达力受限于本文件的原语闭集；这是刻意的，原型要的是**结构与交互意图**，
 * 不是像素级还原。
 *
 * ## 本轮只做「整页重生成」
 *
 * 模型每次写回 `prototype` 时给出**全部页面的完整树**（`DesignPrototypeWriteback` = 屏幕
 * 数组，给出即整体替换）。没有 patch 语义、没有节点 id——增量修改是下一轮的事，届时再给
 * 节点加 `id` 与 `PrototypePatch`；现在加 id 只会是没有生产者的字段。
 *
 * ## 与 `DesignProject.frames` 的关系（单一事实源）
 *
 * `frames: string[]` 仍是画布页**标签**的唯一来源；`DesignProject.prototype: PrototypeNode[]`
 * 是**按位置**对应每一页的树：`prototype[i]` 属于 `frames[i]`。不变量（`DesignProject` 的
 * `superRefine` 机械门控）：`prototype.length === 0`（还没生成）或 `=== frames.length`。
 * 写回时模型给的是 `{frame, root}[]`（对模型友好：一页一个对象），服务端拆成
 * `frames` + `prototype` **一次原子写入**——不会出现标签改了、树没改的中间态。
 * 只写回 `frames`（只改标签）会**清空** `prototype`：旧树属于旧的页面划分。
 *
 * ## 边界
 *
 * 深度 ≤ `PROTOTYPE_MAX_DEPTH`、单页节点 ≤ `PROTOTYPE_MAX_NODES`、页数 ≤ 20（与 `frames` 同源
 * `DesignChatWriteback.frames` 的上限）。超限整页拒——一页被拒 ⇒ 整个 `prototype` 写回被拒
 * （逐字段判的粒度是字段，不是页：半套原型比没有更糟）。
 */
import { z } from "zod";

export const PROTOTYPE_MAX_DEPTH = 8;
export const PROTOTYPE_MAX_NODES = 300;
export const PROTOTYPE_MAX_SCREENS = 20;

/** 原语闭集。新增类型要同时改 `apps/web/components/design-loop/prototype-canvas.tsx` 的渲染表——那边用 `Record<PrototypeNodeType, …>` 穷举，漏了编译不过。 */
export const PrototypeNodeType = z.enum([
  "stack", "card", "navbar", "text", "button", "input", "image", "list", "divider", "spacer", "tabs", "badge", "avatar",
  // 迭代 6 扩充：底部导航 / 开关 / 复选 / 筛选 chip / 进度 / 指标 / hero 头图 / 网格容器
  "bottomnav", "switch", "checkbox", "chip", "progress", "stat", "hero", "grid",
]);
export type PrototypeNodeType = z.infer<typeof PrototypeNodeType>;

/**
 * 迭代 1（增量修改）：节点 id。可选——模型整页给出时可以不写，服务端 `ensurePrototypeIds` 补齐；
 * 一旦落库每个节点都有、且在**整个项目**内唯一（跨页），patch 用它寻址，不需要再说是哪一页。
 */
export const PrototypeNodeId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export type PrototypeNodeId = z.infer<typeof PrototypeNodeId>;
const Id = PrototypeNodeId.optional();

const Scale = z.enum(["none", "sm", "md", "lg"]);
/**
 * 迭代 13（delta §6）—— 圆角与尺寸的档位。
 *
 * 档位而不是像素：给了 px 输入，人和模型就会造出 13px / 7px 这种落在设计系统之外的值，
 * 而这套原语能看起来像一个产品，靠的正是"只有这几档"。四档已经够表达层级差别。
 */
const Radius = z.enum(["none", "sm", "md", "lg", "full"]);
const Size = z.enum(["sm", "md", "lg"]);
const Label = z.string().min(1).max(200);
const Items = z.array(Label).min(1).max(30);

const StackProps = z.object({
  direction: z.enum(["row", "column"]).optional(),
  gap: Scale.optional(),
  padding: Scale.optional(),
  align: z.enum(["start", "center", "end", "between"]).optional(),
  /** 占满父容器剩余空间（聊天消息流那种「中间可滚动区」）。 */
  fill: z.boolean().optional(),
}).strict();
const CardProps = z.object({ title: Label.optional(), radius: Radius.optional(), padding: Scale.optional() }).strict();
const NavbarProps = z.object({ title: Label, left: Label.optional(), right: Label.optional() }).strict();
const TextProps = z.object({
  content: z.string().min(1).max(1000),
  variant: z.enum(["title", "subtitle", "body", "caption", "label"]).optional(),
  muted: z.boolean().optional(),
  align: z.enum(["start", "center", "end"]).optional(),
}).strict();
const ButtonProps = z.object({
  label: Label,
  variant: z.enum(["primary", "secondary", "ghost", "danger"]).optional(),
  full: z.boolean().optional(),
  size: Size.optional(),
  radius: Radius.optional(),
}).strict();
const InputProps = z.object({
  placeholder: Label.optional(),
  label: Label.optional(),
  value: z.string().max(500).optional(),
  multiline: z.boolean().optional(),
}).strict();
const ImageProps = z.object({ alt: Label, ratio: z.enum(["square", "video", "wide", "portrait"]).optional() }).strict();
const ListProps = z.object({ items: Items, leading: z.enum(["none", "dot", "check", "avatar"]).optional() }).strict();
const SpacerProps = z.object({ size: Scale.optional() }).strict();
/** `active` 必须指向 `items` 里真实存在的一项（Codex：越界会渲染成「没有选中项」）。 */
const indexWithin = <T extends { items: readonly string[]; active?: number }>(p: T): boolean => p.active === undefined || p.active < p.items.length;
const TabsPropsBase = z.object({ items: Items, active: z.number().int().min(0).optional() }).strict();
const TabsProps = TabsPropsBase.refine(indexWithin, { message: "active must index an existing item", path: ["active"] });
const BadgeProps = z.object({ label: Label, tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional() }).strict();
const AvatarProps = z.object({ name: Label, size: Size.optional() }).strict();
const BottomNavPropsBase = z.object({ items: z.array(Label).min(2).max(6), active: z.number().int().min(0).optional() }).strict();
const BottomNavProps = BottomNavPropsBase.refine(indexWithin, { message: "active must index an existing item", path: ["active"] });
const SwitchProps = z.object({ label: Label, on: z.boolean().optional() }).strict();
const CheckboxProps = z.object({ label: Label, checked: z.boolean().optional() }).strict();
const ChipProps = z.object({ label: Label, selected: z.boolean().optional() }).strict();
const ProgressProps = z.object({ value: z.number().min(0).max(100), label: Label.optional() }).strict();
const StatProps = z.object({ label: Label, value: Label, delta: Label.optional(), tone: z.enum(["neutral", "success", "danger"]).optional() }).strict();
const HeroProps = z.object({ title: Label, subtitle: z.string().max(400).optional(), cta: Label.optional() }).strict();
const GridProps = z.object({ columns: z.union([z.literal(2), z.literal(3)]).optional(), gap: Scale.optional() }).strict();

/** 叶子节点：无 `children`。 */
const Leaf = z.discriminatedUnion("type", [
  z.object({ id: Id, type: z.literal("navbar"), props: NavbarProps }).strict(),
  z.object({ id: Id, type: z.literal("text"), props: TextProps }).strict(),
  z.object({ id: Id, type: z.literal("button"), props: ButtonProps }).strict(),
  z.object({ id: Id, type: z.literal("input"), props: InputProps }).strict(),
  z.object({ id: Id, type: z.literal("image"), props: ImageProps }).strict(),
  z.object({ id: Id, type: z.literal("list"), props: ListProps }).strict(),
  z.object({ id: Id, type: z.literal("divider") }).strict(),
  z.object({ id: Id, type: z.literal("spacer"), props: SpacerProps.optional() }).strict(),
  z.object({ id: Id, type: z.literal("tabs"), props: TabsProps }).strict(),
  z.object({ id: Id, type: z.literal("badge"), props: BadgeProps }).strict(),
  z.object({ id: Id, type: z.literal("avatar"), props: AvatarProps }).strict(),
  z.object({ id: Id, type: z.literal("bottomnav"), props: BottomNavProps }).strict(),
  z.object({ id: Id, type: z.literal("switch"), props: SwitchProps }).strict(),
  z.object({ id: Id, type: z.literal("checkbox"), props: CheckboxProps }).strict(),
  z.object({ id: Id, type: z.literal("chip"), props: ChipProps }).strict(),
  z.object({ id: Id, type: z.literal("progress"), props: ProgressProps }).strict(),
  z.object({ id: Id, type: z.literal("stat"), props: StatProps }).strict(),
  z.object({ id: Id, type: z.literal("hero"), props: HeroProps }).strict(),
]);

export type PrototypeNode =
  | z.infer<typeof Leaf>
  | { readonly id?: PrototypeNodeId; readonly type: "stack"; readonly props?: z.infer<typeof StackProps>; readonly children: readonly PrototypeNode[] }
  | { readonly id?: PrototypeNodeId; readonly type: "card"; readonly props?: z.infer<typeof CardProps>; readonly children: readonly PrototypeNode[] }
  | { readonly id?: PrototypeNodeId; readonly type: "grid"; readonly props?: z.infer<typeof GridProps>; readonly children: readonly PrototypeNode[] };

/** 容器类型闭集（有 `children`）。所有遍历只认它，加容器只改这里 + `PrototypeNode` 的 union。 */
export const PROTOTYPE_CONTAINER_TYPES = ["stack", "card", "grid"] as const;
export type PrototypeContainer = Extract<PrototypeNode, { children: readonly PrototypeNode[] }>;
export function isPrototypeContainer(n: PrototypeNode): n is PrototypeContainer {
  return (PROTOTYPE_CONTAINER_TYPES as readonly string[]).includes(n.type);
}

/**
 * 递归节点。容器（`stack`/`card`）必有 `children`（可空数组），叶子没有。
 * 深度/节点数上限在 `PrototypeScreen` 上整页判，不在这里逐节点判（zod 递归里拿不到深度）。
 */
export const PrototypeNode: z.ZodType<PrototypeNode> = z.lazy(() =>
  z.union([
    Leaf,
    z.object({ id: Id, type: z.literal("stack"), props: StackProps.optional(), children: z.array(PrototypeNode).max(PROTOTYPE_MAX_NODES) }).strict(),
    z.object({ id: Id, type: z.literal("card"), props: CardProps.optional(), children: z.array(PrototypeNode).max(PROTOTYPE_MAX_NODES) }).strict(),
    z.object({ id: Id, type: z.literal("grid"), props: GridProps.optional(), children: z.array(PrototypeNode).max(PROTOTYPE_MAX_NODES) }).strict(),
  ]),
);

/** 度量一棵树：节点总数与最大深度（根 = 深度 1）。渲染层与文档导出也用它，不各自再写一份遍历。 */
export function measurePrototype(root: PrototypeNode): { readonly nodes: number; readonly depth: number } {
  let nodes = 0;
  let depth = 0;
  const walk = (n: PrototypeNode, d: number): void => {
    nodes += 1;
    if (d > depth) depth = d;
    if (isPrototypeContainer(n)) for (const c of n.children) walk(c, d + 1);
  };
  walk(root, 1);
  return { nodes, depth };
}

/**
 * **解析前**的迭代深度探测——对还没过契约的原始值（`unknown`）算 `children` 嵌套深度，
 * 不递归、不信任形状。理由：`PrototypeNode` 是递归 zod schema，一条几千层的 `stack` 链会在
 * `safeParse` 里把调用栈打爆（`RangeError`），而 `PrototypeScreen.refine` 的深度上限要等递归
 * 解析**完成**才有机会判——顺序反了。所以调用方（`parseWriteback`）先用这个函数把超深的原始值
 * 挡在递归解析之前，把「栈溢出的异常」变成「这个字段不合法」。
 * 返回值是「探测到的深度」，超过 `limit` 就提前停止（不需要真的数到底）。
 */
export function rawPrototypeDepth(raw: unknown, limit: number = PROTOTYPE_MAX_DEPTH + 1): number {
  let frontier: unknown[] = [raw];
  let depth = 0;
  while (frontier.length > 0 && depth < limit) {
    depth += 1;
    const next: unknown[] = [];
    for (const n of frontier) {
      if (n !== null && typeof n === "object" && !Array.isArray(n)) {
        const children = (n as { children?: unknown }).children;
        if (Array.isArray(children)) for (const c of children) next.push(c);
      }
    }
    frontier = next;
  }
  return depth;
}

export function withinPrototypeLimits(root: PrototypeNode): boolean {
  const m = measurePrototype(root);
  return m.nodes <= PROTOTYPE_MAX_NODES && m.depth <= PROTOTYPE_MAX_DEPTH;
}

/**
 * 迭代 11（design-delta `prototype-navigation`，待人类签核）：页与页之间的**跳转关系**。
 * 挂在屏上而不是节点 props 上——多项原语（list/tabs/bottomnav）的 `items` 要配平行的目标数组，
 * 属性面板没有「按行给目标」这种字段类型；屏级数组则 21 个 `*Props` 一个不动，校验集中一处。
 * - `from`：本页树里的节点 id；`item` 只对多项原语有意义（第几项），单目标原语不带。
 * - `to`：目标页在 `screens` 里的序号（0 起）。按序号不按标签：仓库既有约定就是按位置配对，
 *   按标签会在改名时断；整页重生成时 `links` 随 `screens` 一起重给，序号天然重算。
 */
export const PROTOTYPE_MAX_LINKS = 30;
export const PrototypeLink = z
  .object({ from: PrototypeNodeId, item: z.number().int().min(0).optional(), to: z.number().int().min(0) })
  .strict();
export type PrototypeLink = z.infer<typeof PrototypeLink>;

/** 模型写回用的一页：页标签 + 这一页的树。服务端拆成 `frames[i]` / `prototype[i]`。 */
export const PROTOTYPE_NOTES_MAX = 600;
export const PrototypeScreen = z
  .object({
    frame: Label,
    root: PrototypeNode,
    /** 迭代 8：这一页的交互说明（做什么 / 主要交互 / 状态与边界），进设计文档与说明页；可省略。 */
    notes: z.string().max(PROTOTYPE_NOTES_MAX).optional(),
    /** 迭代 11：这一页出发的跳转关系；可省略。合法性要看整份 screens，见 `validateLinks`。 */
    links: z.array(PrototypeLink).max(PROTOTYPE_MAX_LINKS).optional(),
  })
  .strict()
  .refine((s) => withinPrototypeLimits(s.root), { message: `prototype screen exceeds ${PROTOTYPE_MAX_NODES} nodes or depth ${PROTOTYPE_MAX_DEPTH}` });
export type PrototypeScreen = z.infer<typeof PrototypeScreen>;

/** 整页重生成：给出即整体替换全部页面。 */
export const DesignPrototypeWriteback = z.array(PrototypeScreen).min(1).max(PROTOTYPE_MAX_SCREENS);
export type DesignPrototypeWriteback = z.infer<typeof DesignPrototypeWriteback>;

/* ─────────────────────────── 迭代 5：属性面板的字段元数据（单源） ─────────────────────────── */

/** 每种原语的 props schema——属性面板元数据的机械门控用它对账（契约测试逐类型比 shape 键）。 */
export const PROTOTYPE_PROPS_SCHEMAS = {
  stack: StackProps, card: CardProps, navbar: NavbarProps, text: TextProps, button: ButtonProps, input: InputProps,
  image: ImageProps, list: ListProps, divider: null, spacer: SpacerProps, tabs: TabsPropsBase, badge: BadgeProps, avatar: AvatarProps,
  bottomnav: BottomNavPropsBase, switch: SwitchProps, checkbox: CheckboxProps, chip: ChipProps, progress: ProgressProps,
  stat: StatProps, hero: HeroProps, grid: GridProps,
} as const satisfies Record<PrototypeNodeType, z.ZodObject<z.ZodRawShape> | null>;

export type PrototypeFieldKind = "text" | "multiline" | "lines" | "bool" | "number" | "enum";

/**
 * 迭代 13（delta §6）—— 字段分两组：**内容**（写什么）与**视觉**（长什么样）。
 *
 * 分组的意义不是排版：属性面板要像 Figma 那样"能调设计"，但**简化**——简化的形态是
 * 把视觉那几档收进一个默认折叠的区，让常用的改文案不被十个下拉淹掉，
 * 同时视觉那些档位随手就能翻出来。
 *
 * ⚠ 视觉字段**一律是 `enum`**，永远不给自由数值（V70 机械门控）。给了 px 输入，
 *   模型和人就会造出 13px / 7px 这种落在设计系统之外的值，而整套原语的一致性
 *   正是靠"只有这几档"维持的。这条不是风格偏好，是这套东西能看起来像一个产品的原因。
 */
export type PrototypeFieldGroup = "content" | "visual";

/**
 * 哪些 key 算视觉。按 key 判而不是逐类型标注：同名的 key 在各类型里是同一件事
 * （`gap` 在 stack 和 grid 里都是间距），逐类型标一遍就是同一事实标 21 次，
 * 漏标一处的表现是"某个类型的间距跑到内容组里去了"。
 */
const VISUAL_FIELD_KEYS: ReadonlySet<string> = new Set([
  "gap", "padding", "align", "direction", "fill", "variant", "tone", "ratio",
  "leading", "size", "radius", "full", "muted", "columns",
]);

export const prototypeFieldGroup = (key: string): PrototypeFieldGroup =>
  VISUAL_FIELD_KEYS.has(key) ? "visual" : "content";

export interface PrototypeField {
  readonly key: string;
  readonly label: string;
  readonly kind: PrototypeFieldKind;
  /** `kind === "enum"` 时的闭集；由对应 `z.enum` 的 `options` 派生，不手抄。 */
  readonly options?: readonly string[];
  /** 迭代 13：内容组 / 视觉组。由 `prototypeFieldGroup(key)` 派生，不逐个手标。 */
  readonly group: PrototypeFieldGroup;
  /**
   * 迭代 13：`kind === "enum"` 但取值在 schema 里是**数字**（目前只有 `grid.columns`：
   * `z.union([z.literal(2), z.literal(3)])`）。
   *
   * 为什么不干脆让它当 `number`：`columns` 本来就是闭集（2 或 3），做成数字输入框
   * 就是给视觉组开了一个"自由数值"的口子——而 V70 那条门挡的正是这个。
   * 为什么不把 schema 改成字符串枚举：那会让已存的原型里的 `columns: 2` 全部失效，
   * 为了一条命名上的整齐去动用户的数据不划算。
   * 所以：**展示上是档位、存储上是数字**，由这个标记把两者接起来，属性面板据它回转。
   */
  readonly numeric?: true;
}

const SCALE_OPTIONS = Scale.options;
const F = (key: string, label: string, kind: PrototypeFieldKind, options?: readonly string[]): PrototypeField =>
  ({ key, label, kind, group: prototypeFieldGroup(key), ...(options !== undefined ? { options } : {}) });

/** 数字取值的档位字段（见 `PrototypeField.numeric`）。 */
const FNum = (key: string, label: string, options: readonly string[]): PrototypeField =>
  ({ ...F(key, label, "enum", options), numeric: true });

/**
 * 属性面板字段表：**每个类型的 key 集合 == 对应 `*Props` 的 shape 键集合**（契约测试锁定），枚举 options 直接
 * 取自 zod `.options`。加/改属性只改 schema 与这里，前端不再另抄一份（Codex P1：第二份事实源）。
 */
export const PROTOTYPE_FIELDS: Record<PrototypeNodeType, readonly PrototypeField[]> = {
  stack: [
    F("direction", "方向", "enum", StackProps.shape.direction.unwrap().options),
    F("gap", "间距", "enum", SCALE_OPTIONS), F("padding", "内边距", "enum", SCALE_OPTIONS),
    F("align", "对齐", "enum", StackProps.shape.align.unwrap().options), F("fill", "填满剩余空间", "bool"),
  ],
  card: [F("title", "标题", "text"), F("radius", "圆角", "enum", Radius.options), F("padding", "内边距", "enum", SCALE_OPTIONS)],
  navbar: [F("title", "标题", "text"), F("left", "左侧", "text"), F("right", "右侧", "text")],
  text: [
    F("content", "文案", "multiline"), F("variant", "样式", "enum", TextProps.shape.variant.unwrap().options),
    F("muted", "弱化", "bool"), F("align", "对齐", "enum", TextProps.shape.align.unwrap().options),
  ],
  button: [
    F("label", "文案", "text"), F("variant", "样式", "enum", ButtonProps.shape.variant.unwrap().options),
    F("full", "通栏", "bool"), F("size", "尺寸", "enum", Size.options), F("radius", "圆角", "enum", Radius.options),
  ],
  input: [F("placeholder", "占位文字", "text"), F("label", "标签", "text"), F("value", "已填内容", "text"), F("multiline", "多行", "bool")],
  image: [F("alt", "说明", "text"), F("ratio", "比例", "enum", ImageProps.shape.ratio.unwrap().options)],
  list: [F("items", "条目（一行一项）", "lines"), F("leading", "前缀", "enum", ListProps.shape.leading.unwrap().options)],
  divider: [],
  spacer: [F("size", "高度", "enum", SCALE_OPTIONS)],
  tabs: [F("items", "标签（一行一项）", "lines"), F("active", "当前项（从 0 起）", "number")],
  badge: [F("label", "文案", "text"), F("tone", "色调", "enum", BadgeProps.shape.tone.unwrap().options)],
  avatar: [F("name", "名字", "text"), F("size", "尺寸", "enum", Size.options)],
  bottomnav: [F("items", "项（一行一项，2–6）", "lines"), F("active", "当前项（从 0 起）", "number")],
  switch: [F("label", "文案", "text"), F("on", "打开", "bool")],
  checkbox: [F("label", "文案", "text"), F("checked", "已选", "bool")],
  chip: [F("label", "文案", "text"), F("selected", "选中", "bool")],
  progress: [F("value", "进度（0–100）", "number"), F("label", "说明", "text")],
  stat: [F("label", "指标名", "text"), F("value", "数值", "text"), F("delta", "变化", "text"), F("tone", "色调", "enum", StatProps.shape.tone.unwrap().options)],
  hero: [F("title", "标题", "text"), F("subtitle", "副标题", "multiline"), F("cta", "按钮文案", "text")],
  grid: [FNum("columns", "列数", ["2", "3"]), F("gap", "间距", "enum", SCALE_OPTIONS)],
};

/* ─────────────────────────── 迭代 1：增量修改（patch） ─────────────────────────── */

export const PROTOTYPE_MAX_PATCH_OPS = 50;

/**
 * 五种 patch 操作。前四种按节点 id 寻址（id 在项目内唯一，所以不带页）：
 *   · `replace`  用 `node` 整体替换 `id` 那棵子树（可以换类型）；新子树里没 id 的节点由服务端补。
 *   · `setProps` 把 `props` **浅合并**进 `id` 节点现有 props（改一句文案不用重写整个节点）；键值 `null` = 删该键。
 *   · `insert`   把 `node` 插进容器 `parentId` 的 `children[index]`（缺省追加到末尾）。
 *   · `remove`   删掉 `id` 那棵子树。根节点不可删（一页至少有根）。
 * 语义是**顺序**执行：后一条能看到前一条的结果；任一条失败 ⇒ 整批不生效（字段级拒绝，同 I-10）。
 */
export const PrototypePatchOp = z.discriminatedUnion("op", [
  /** `node.id` 若给出会被忽略——替换后的根沿用被替换节点的 id（稳定身份）。 */
  z.object({ op: z.literal("replace"), id: PrototypeNodeId, node: PrototypeNode }).strict(),
  /** `props` 里某键为 `null` ⇒ 删掉该键（可选属性回到默认）。 */
  z.object({ op: z.literal("setProps"), id: PrototypeNodeId, props: z.record(z.unknown()) }).strict(),
  z.object({ op: z.literal("insert"), parentId: PrototypeNodeId, index: z.number().int().min(0).optional(), node: PrototypeNode }).strict(),
  z.object({ op: z.literal("remove"), id: PrototypeNodeId }).strict(),
  /**
   * 迭代 11：整体替换某页的跳转关系。**按页序号寻址**（不是节点 id）——links 是屏级的，
   * 不属于任何一个节点。人改（属性面板）与模型改走同一个 op（I-11）；不设 link/unlink 两个
   * op，一个整体替换够用、校验只写一次（design-delta §3）。
   */
  z.object({ op: z.literal("setLinks"), screen: z.number().int().min(0), links: z.array(PrototypeLink).max(PROTOTYPE_MAX_LINKS) }).strict(),
  /**
   * 迭代 12（design-delta `paged-generation-and-doc-export` §2）：增删**页**。
   * 在此之前增页/删页只能整页重给 `prototype`——这正是「一次吐出所有页」最常见的触发原因之一，
   * 而它本可以是一个局部 op。`frame` 与树由同一条 op 一起改，等长不变量由实现保证而不是靠模型自觉。
   * `at` 是插入位置（0..len，len = 追加到末尾）；`root` 可省略 ⇒ 插入一个**还没生成**的空页。
   */
  z.object({ op: z.literal("addScreen"), at: z.number().int().min(0), frame: Label, root: PrototypeNode.optional() }).strict(),
  z.object({ op: z.literal("removeScreen"), screen: z.number().int().min(0) }).strict(),
  /**
   * 迭代 15（delta `canvas-direct-manipulation`）：只改页标签，树与 notes 一个字不动。
   *
   * ⚠ 为什么不用 `removeScreen` + `addScreen` 拼出来：那样会丢掉这一页的 `notes`
   * （`addScreen` 只带 frame/root/links），而且 `shiftLinkTargets` 会先 -1 再 +1，
   * 中间那一步已经把指向本页的跳转改掉了，两步之后不保证还原。改名是**只动一个字段**
   * 的操作，就该是一个只动一个字段的 op。
   */
  z.object({ op: z.literal("renameScreen"), screen: z.number().int().min(0), frame: Label }).strict(),
]);
export type PrototypePatchOp = z.infer<typeof PrototypePatchOp>;
export const DesignPrototypePatch = z.array(PrototypePatchOp).min(1).max(PROTOTYPE_MAX_PATCH_OPS);
export type DesignPrototypePatch = z.infer<typeof DesignPrototypePatch>;

function collectIds(root: PrototypeNode, out: Set<string>): void {
  if (root.id !== undefined) out.add(root.id);
  if (isPrototypeContainer(root)) for (const c of root.children) collectIds(c, out);
}

/** 有 `items` 的多项原语——`PrototypeLink.item` 只对它们有意义。只此一处声明。 */
export const PROTOTYPE_MULTI_ITEM_TYPES = ["list", "tabs", "bottomnav"] as const;
/** navbar 左右两个按钮以 `item: 0 | 1` 区分（左 0、右 1）。 */
export const PROTOTYPE_NAVBAR_ITEMS = 2;

function findNode(root: PrototypeNode, id: string): PrototypeNode | null {
  if (root.id === id) return root;
  if (isPrototypeContainer(root)) for (const c of root.children) { const hit = findNode(c, id); if (hit !== null) return hit; }
  return null;
}

/** 一个节点能承载几个跳转目标：多项原语 = items 数；navbar = 2（左/右）；其余 = 1（不带 item）。 */
export function linkSlotsOf(node: PrototypeNode): number {
  if ((PROTOTYPE_MULTI_ITEM_TYPES as readonly string[]).includes(node.type)) return (node as { props?: { items?: readonly string[] } }).props?.items?.length ?? 0;
  if (node.type === "navbar") return PROTOTYPE_NAVBAR_ITEMS;
  return 1;
}

export type LinkDropReason = "TARGET_OUT_OF_RANGE" | "SELF_LINK" | "FROM_NOT_FOUND" | "ITEM_OUT_OF_RANGE" | "DUPLICATE" | "TOO_MANY";

/**
 * 迭代 11：跳转关系的合法性要看整份 screens，所以在这里而不是 `PrototypeScreen` 的 refine 里判。
 * **逐条丢、不整页拒**（design-delta §2，与 I-10 的粒度不同，是人类要拍板的取舍 ①）：悬空的跳转
 * 不至于让整页作废。返回每页清洗后的 links 与被丢条目的原因（给日志与修复轮用）。幂等。
 */
export function validateLinks(
  screens: readonly { readonly root?: PrototypeNode; readonly links?: readonly PrototypeLink[] }[],
): { readonly links: readonly (readonly PrototypeLink[])[]; readonly dropped: readonly { screen: number; link: PrototypeLink; reason: LinkDropReason }[] } {
  const dropped: { screen: number; link: PrototypeLink; reason: LinkDropReason }[] = [];
  const links = screens.map((s, i) => {
    const seen = new Set<string>();
    const kept: PrototypeLink[] = [];
    for (const l of s.links ?? []) {
      const reason: LinkDropReason | null =
        l.to >= screens.length ? "TARGET_OUT_OF_RANGE"
        : l.to === i ? "SELF_LINK"
        : (() => {
            // 迭代 12：还没生成的页（`root` 缺）没有节点可寻址 ⇒ 从它出发的 link 一律丢。
            // 指**向**它的 link 不受影响：那页迟早会生成，目标序号是合法的。
            const node = s.root === undefined ? null : findNode(s.root, l.from);
            if (node === null) return "FROM_NOT_FOUND";
            const slots = linkSlotsOf(node);
            if (slots > 1 ? (l.item === undefined || l.item >= slots) : l.item !== undefined && l.item !== 0) return "ITEM_OUT_OF_RANGE";
            return null;
          })();
      const key = `${l.from}#${l.item ?? 0}`;
      if (reason !== null) dropped.push({ screen: i, link: l, reason });
      else if (seen.has(key)) dropped.push({ screen: i, link: l, reason: "DUPLICATE" });
      else if (kept.length >= PROTOTYPE_MAX_LINKS) dropped.push({ screen: i, link: l, reason: "TOO_MANY" });
      else { seen.add(key); kept.push(l); }
    }
    return kept;
  });
  return { links, dropped };
}

/**
 * 迭代 12（delta §2）：增删页之后，**所有页**的跳转目标序号整体平移。
 *
 * ⚠ 这是本 delta 最容易被漏掉、也最难看出来的一处：不平移的失败是**静默错位**——
 * 删掉第 2 页之后，原本指向第 3 页的跳转仍写着 `to: 2`，界面上一切正常，点下去去了错的页。
 * 比「链接失效」更糟，因为没有任何东西显示为坏。
 *
 * - `delta === +1`（在 `at` 处插了一页）：`to >= at` 的目标 +1。
 * - `delta === -1`（删掉了第 `at` 页）：`to === at` 的**丢掉**（目标没了）；`to > at` 的 -1。
 */
export function shiftLinkTargets<T extends { readonly links?: readonly PrototypeLink[] }>(
  screens: readonly T[],
  at: number,
  delta: 1 | -1,
): readonly (T & { readonly links: readonly PrototypeLink[] })[] {
  return screens.map((s) => {
    const out: PrototypeLink[] = [];
    for (const l of s.links ?? []) {
      if (delta === 1) out.push(l.to >= at ? { ...l, to: l.to + 1 } : l);
      else if (l.to === at) continue;
      else out.push(l.to > at ? { ...l, to: l.to - 1 } : l);
    }
    return { ...s, links: out };
  });
}

/**
 * 给没有 id 的节点补 id，已有的保留；生成的 id 在整个 `prototype` 内唯一（`n1`、`n2`……跳过已占用的）。
 * 模型整页给出时可能把同一个 id 写在两个节点上——**第二次出现的重新分配**（遍历序，第一次出现的保留），
 * 所以输出恒满足 `prototypeIdsUnique`。幂等：全部有 id 且无重复时原样返回（引用相等）。
 * 落库前必跑一次，这样模型下一轮看到的每个节点都可寻址。
 */
export function ensurePrototypeIds(prototype: readonly PrototypeNode[]): readonly PrototypeNode[] {
  const used = new Set<string>();
  for (const r of prototype) collectIds(r, used);
  const seen = new Set<string>();
  let counter = 0;
  const nextId = (): string => {
    do counter += 1; while (used.has(`n${counter}`));
    const id = `n${counter}`;
    used.add(id);
    return id;
  };
  let changed = false;
  const fill = (n: PrototypeNode): PrototypeNode => {
    let id = n.id;
    if (id === undefined || seen.has(id)) {
      changed = true;
      id = nextId();
    }
    seen.add(id);
    if (isPrototypeContainer(n)) {
      const children = n.children.map(fill);
      return { ...n, id, children };
    }
    return n.id === id ? n : { ...n, id };
  };
  const out = prototype.map(fill);
  return changed ? out : prototype;
}

/** 项目内 id 是否唯一（`ensurePrototypeIds` 之后的落库不变量）。 */
export function prototypeIdsUnique(prototype: readonly PrototypeNode[]): boolean {
  const seen = new Set<string>();
  let dup = false;
  const walk = (n: PrototypeNode): void => {
    if (n.id !== undefined) {
      if (seen.has(n.id)) dup = true;
      seen.add(n.id);
    }
    if (isPrototypeContainer(n)) for (const c of n.children) walk(c);
  };
  for (const r of prototype) walk(r);
  return !dup;
}

/**
 * patch 被拒的**闭集**原因——它会经 HTTP 回到前端（`PROTOTYPE_PATCH_REJECTED` + `patchReason`），
 * 全局异常过滤器只放行闭集里的值，自由文本的 message 只进日志（`all-exceptions.filter.ts` 的纪律）。
 */
export const PrototypePatchRejectReason = z.enum([
  "UNKNOWN_NODE", "DUPLICATE_ID", "ROOT_REMOVE", "NOT_CONTAINER", "INVALID_NODE", "LIMITS", "NO_PROTOTYPE",
  // 迭代 11：`setLinks` 的 `screen` 越界。与 UNKNOWN_NODE 分开——那条说的是"节点没找到"，
  // 这条说的是"页没找到"，屏上给用户的下一步不同。
  "UNKNOWN_SCREEN",
]);
export type PrototypePatchRejectReason = z.infer<typeof PrototypePatchRejectReason>;

export class PrototypePatchError extends Error {
  constructor(readonly opIndex: number, readonly reason: PrototypePatchRejectReason, message: string, readonly nodeId?: string) {
    super(`patch op #${opIndex}: ${message}`);
    this.name = "PrototypePatchError";
  }
}

/**
 * 顺序应用一批 patch，返回**新的**屏数组（不改入参）。每一步的结果都重新过 `PrototypeNode`
 * 契约与整页上限；任何一步不合法抛 `PrototypePatchError`（调用方据此整批拒绝）。
 * 结果里新增的节点由 `ensurePrototypeIds` 补 id。
 *
 * 迭代 11 起入参是**屏**而不是裸树：`setLinks` 改的是屏级的 links，不属于任何节点；且删掉一个
 * 有 link 指向它的节点后，那条 link 必须跟着失效。泛型 `T` 让 `frame`/`notes` 原样穿过去——
 * 这个函数不需要知道它们存在。
 *
 * 收尾统一过一次 `validateLinks`：**逐条丢**悬空的跳转、页面保留（design-delta §2 取舍 ①）。
 * 所以「删了源节点」「patch 后页数变了」这类间接失效不需要调用方自己收拾。
 */
export function applyPrototypePatch<T extends { readonly root?: PrototypeNode; readonly links?: readonly PrototypeLink[] }>(
  screens: readonly T[],
  ops: readonly PrototypePatchOp[],
): readonly (T & { readonly links: readonly PrototypeLink[] })[] {
  let current: readonly T[] = screens;
  ops.forEach((op, i) => {
    if (op.op === "setLinks") {
      if (op.screen >= current.length) {
        throw new PrototypePatchError(i, "UNKNOWN_SCREEN", `no screen at index ${op.screen} (have ${current.length})`);
      }
      current = current.map((s, k) => (k === op.screen ? { ...s, links: op.links } : s));
      return;
    }
    if (op.op === "addScreen") {
      if (op.at > current.length) throw new PrototypePatchError(i, "UNKNOWN_SCREEN", `cannot insert at ${op.at} (have ${current.length})`);
      if (current.length >= PROTOTYPE_MAX_SCREENS) throw new PrototypePatchError(i, "LIMITS", `already at ${PROTOTYPE_MAX_SCREENS} screens`);
      // 新页只有 frame / root / links 三个字段；`T` 的其它可选字段（notes 等）缺省。
      // `T` 不强制声明 `frame`（既有调用方传的是裸树），所以这里断言构造。
      const fresh = { frame: op.frame, ...(op.root === undefined ? {} : { root: op.root }), links: [] } as unknown as T;
      const shifted = shiftLinkTargets(current, op.at, 1);
      const merged = [...shifted.slice(0, op.at), fresh, ...shifted.slice(op.at)];
      // 新页的树是模型/人现给的，节点通常没有 id——不补的话它一落库就**不可寻址**，
      // 下一条 patch 想改这一页里的东西会拿到 UNKNOWN_NODE。补 id 要看**整个项目**
      // （id 跨页唯一），所以在合并之后统一跑一次，而不是只对新页跑。
      const keys = merged.flatMap((s, k) => (s.root === undefined ? [] : [k]));
      const withIds = ensurePrototypeIds(keys.map((k) => merged[k]!.root!));
      const byKey = new Map(keys.map((k, idx) => [k, withIds[idx]!]));
      current = merged.map((s, k) => (byKey.has(k) ? { ...s, root: byKey.get(k)! } : s));
      return;
    }
    if (op.op === "renameScreen") {
      if (op.screen >= current.length) {
        throw new PrototypePatchError(i, "UNKNOWN_SCREEN", `no screen at index ${op.screen} (have ${current.length})`);
      }
      // 只换 frame，其余字段（root / notes / links）原样带过——这正是它存在的理由。
      current = current.map((s, k) => (k === op.screen ? { ...s, frame: op.frame } : s));
      return;
    }
    if (op.op === "removeScreen") {
      if (op.screen >= current.length) throw new PrototypePatchError(i, "UNKNOWN_SCREEN", `no screen at index ${op.screen} (have ${current.length})`);
      if (current.length === 1) throw new PrototypePatchError(i, "LIMITS", "cannot remove the only screen");
      const shifted = shiftLinkTargets(current, op.screen, -1);
      current = [...shifted.slice(0, op.screen), ...shifted.slice(op.screen + 1)];
      return;
    }
    let hit = 0;
    const visit = (n: PrototypeNode): PrototypeNode | null => {
      if (op.op === "setProps" && n.id === op.id) {
        hit += 1;
        // `null` = 删掉这个键（可选属性回到默认）；JSON 里 undefined 会被丢掉，所以删除必须有显式表示。
        const props: Record<string, unknown> = { ...(("props" in n ? n.props : undefined) ?? {}) };
        for (const [k, v] of Object.entries(op.props)) {
          if (v === null) delete props[k];
          else props[k] = v;
        }
        const merged = { ...n, props };
        const parsed = PrototypeNode.safeParse(merged);
        if (!parsed.success) throw new PrototypePatchError(i, "INVALID_NODE", `setProps on ${op.id} yields invalid node: ${parsed.error.issues[0]?.message ?? "invalid"}`, op.id);
        return parsed.data;
      }
      if (op.op === "replace" && n.id === op.id) {
        hit += 1;
        // 被替换节点的 id 是稳定身份：新子树根**一律**沿用它，模型在 node 里写的 id 不算数
        // （同批后续 op 还会按原 id 寻址）。子树内部的 id 照常保留/补齐。
        return { ...op.node, id: n.id };
      }
      if (op.op === "remove" && n.id === op.id) {
        hit += 1;
        return null;
      }
      if (isPrototypeContainer(n)) {
        let children: PrototypeNode[] = [];
        for (const c of n.children) {
          const r = visit(c);
          if (r !== null) children.push(r);
        }
        if (op.op === "insert" && n.id === op.parentId) {
          hit += 1;
          const at = op.index === undefined ? children.length : Math.min(op.index, children.length);
          children = [...children.slice(0, at), op.node, ...children.slice(at)];
        }
        return { ...n, children };
      }
      if (op.op === "insert" && n.id === op.parentId) throw new PrototypePatchError(i, "NOT_CONTAINER", `${op.parentId} is a ${n.type}, not a container`, op.parentId);
      return n;
    };
    // 迭代 12：还没生成的页（`root` 缺）没有树可遍历——跳过它，位置留着。
    const next = new Map<number, PrototypeNode>();
    for (const [k, s] of current.entries()) {
      if (s.root === undefined) continue;
      const r = visit(s.root);
      if (r === null) throw new PrototypePatchError(i, "ROOT_REMOVE", `cannot remove page root ${s.root.id ?? ""}`, s.root.id);
      next.set(k, r);
    }
    const target = op.op === "insert" ? op.parentId : op.id;
    if (hit === 0) throw new PrototypePatchError(i, "UNKNOWN_NODE", `no node with id ${target}`, target);
    if (hit > 1) throw new PrototypePatchError(i, "DUPLICATE_ID", `id ${target} is not unique`, target);
    const keys = [...next.keys()];
    const withIds = ensurePrototypeIds(keys.map((k) => next.get(k)!));
    const byKey = new Map(keys.map((k, idx) => [k, withIds[idx]!]));
    current = current.map((s, k) => (byKey.has(k) ? { ...s, root: byKey.get(k)! } : s));
  });
  for (const [k, s] of current.entries()) {
    if (s.root !== undefined && !withinPrototypeLimits(s.root)) throw new PrototypePatchError(ops.length, "LIMITS", `page ${k + 1} exceeds limits after patch`);
  }
  const roots = current.flatMap((s) => (s.root === undefined ? [] : [s.root]));
  if (!prototypeIdsUnique(roots)) throw new PrototypePatchError(ops.length, "DUPLICATE_ID", "ids not unique after patch");
  const cleaned = validateLinks(current);
  // 返回类型显式带上 links：入参里它是可选的，但**出参一定有**（收尾统一清洗过），
  // 调用方不该再为它写一次 `?? []`。
  return current.map((s, k) => ({ ...s, links: cleaned.links[k]! }));
}

/**
 * 迭代 2：按 id 找节点，返回从页根到它的路径（含自身）与页序号；找不到 ⇒ null。
 * 画布选中态（面包屑）与模型上下文（「用户选中了 …」）共用，不各写一份遍历。
 */
export function findPrototypeNodePath(
  /** issue #3340：`null` = 这一页没画出来，没有树可找，直接跳过。 */
  prototype: readonly (PrototypeNode | null)[],
  id: PrototypeNodeId,
): { readonly frameIndex: number; readonly path: readonly PrototypeNode[] } | null {
  const walk = (n: PrototypeNode, trail: PrototypeNode[]): PrototypeNode[] | null => {
    const here = [...trail, n];
    if (n.id === id) return here;
    if (isPrototypeContainer(n)) {
      for (const c of n.children) {
        const r = walk(c, here);
        if (r !== null) return r;
      }
    }
    return null;
  };
  for (const [frameIndex, root] of prototype.entries()) {
    if (root === null) continue;
    const path = walk(root, []);
    if (path !== null) return { frameIndex, path };
  }
  return null;
}

/** 一个节点的短标签（面包屑 / 焦点 chip / 给模型的描述），与设计文档的 `describeNode` 分工：这里只要一眼认出。 */
export function prototypeNodeLabel(n: PrototypeNode): string {
  switch (n.type) {
    case "text": return `文本「${n.props.content.slice(0, 20)}」`;
    case "button": return `按钮「${n.props.label}」`;
    case "navbar": return `导航栏「${n.props.title}」`;
    case "card": return n.props?.title !== undefined ? `卡片「${n.props.title}」` : "卡片";
    case "input": return `输入框「${n.props.label ?? n.props.placeholder ?? ""}」`;
    case "badge": return `标记「${n.props.label}」`;
    case "image": return `图片「${n.props.alt}」`;
    case "list": return `列表（${n.props.items.length} 项）`;
    case "tabs": return `标签页（${n.props.items.join("/")}）`;
    case "avatar": return `头像「${n.props.name}」`;
    case "stack": return n.props?.direction === "row" ? "横向布局" : "纵向布局";
    case "divider": return "分隔线";
    case "spacer": return "留白";
    case "bottomnav": return `底部导航（${n.props.items.join("/")}）`;
    case "switch": return `开关「${n.props.label}」`;
    case "checkbox": return `复选「${n.props.label}」`;
    case "chip": return `筛选「${n.props.label}」`;
    case "progress": return `进度 ${n.props.value}%`;
    case "stat": return `指标「${n.props.label}」`;
    case "hero": return `头图「${n.props.title}」`;
    case "grid": return `网格（${n.props?.columns ?? 2} 列）`;
  }
}

/* ─────────────────────────── 迭代 7：常见格式错误自动纠偏 ─────────────────────────── */

/** 只有这些「类型.键」是数字：`stat.value` / `input.value` 是字符串，全局按键名转会把合法节点转坏（Codex P1）。 */
const NUMERIC_PROPS: Record<string, readonly string[]> = { progress: ["value"], tabs: ["active"], bottomnav: ["active"], grid: ["columns"] };

/**
 * 在过契约**之前**对模型给的原始树做几种机械纠偏——都是「意思对了、格式差一点」的错，
 * 让契约拒掉再让模型重来一轮太贵：
 *   · `type` 大小写/首尾空白；
 *   · 容器（stack/card/grid）漏了 `children` ⇒ 补 `[]`；叶子多了 `children` ⇒ 删；
 *   · `divider` 带了空 `props` ⇒ 删；
 *   · `value` / `active` / `columns` 写成数字字符串 ⇒ 转数字。
 * **不**删未知 props 键、**不**猜缺失的必填项——那些是真错，交给契约与修复轮。
 * 输入不是对象 ⇒ 原样返回；迭代式处理，深度由调用方先用 `rawPrototypeDepth` 挡。
 */
export function coercePrototypeRaw(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const n = { ...(raw as Record<string, unknown>) };
  if (typeof n.type === "string") n.type = n.type.trim().toLowerCase();
  const isContainer = (PROTOTYPE_CONTAINER_TYPES as readonly string[]).includes(String(n.type));
  if (isContainer) {
    n.children = Array.isArray(n.children) ? n.children.map(coercePrototypeRaw) : [];
  } else if ("children" in n) {
    delete n.children;
  }
  if (n.type === "divider" && "props" in n) delete n.props;
  if (n.props !== null && typeof n.props === "object" && !Array.isArray(n.props)) {
    const props = { ...(n.props as Record<string, unknown>) };
    for (const k of NUMERIC_PROPS[String(n.type)] ?? []) {
      const v = props[k];
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) props[k] = Number(v);
    }
    n.props = props;
  }
  return n;
}

/** 给模型看的 patch 说明——同 `PROTOTYPE_SCHEMA_GUIDE`，只此一份。 */
export const PROTOTYPE_PATCH_GUIDE =
  "局部修改用 writeback.patch（数组，按顺序执行，≤ " + PROTOTYPE_MAX_PATCH_OPS + " 条），按节点 id 寻址（当前原型里每个节点都有 id）：" +
  '{"op":"setProps","id":"n3","props":{...只给要改的键}}；{"op":"replace","id":"n3","node":{完整节点}}；' +
  '{"op":"insert","parentId":"n1","index":0,"node":{...}}（index 缺省追加末尾）；{"op":"remove","id":"n7"}。' +
  // 迭代 15：**页级 op 从迭代 12 起就在契约里，这段说明却从没提过它们**，而下面那句
  // 原本写的是「新页面 ⇒ 用 prototype 整页给出」——等于教模型为了加一页把所有页重画一遍，
  // 正是「单页超输出预算」那条根因的推手。加页/删页/改页名各有便宜的 op，必须让模型知道。
  '按**页**改：{"op":"addScreen","at":2,"frame":"设置","node 可选 root":{...}}（at=插入位置，0..页数）；' +
  '{"op":"removeScreen","screen":2}；{"op":"renameScreen","screen":0,"frame":"新名字"}。' +
  "指向这些页的跳转会由服务端自动跟着偏移，你不用重算 links。" +
  // 同一个洞的第二例：`setLinks` 从迭代 11 起就在契约里，这段说明同样没提过——
  // 模型只会在整页写回时给 links，想单独改一条跳转就只能整页重画。这条门一并抓到了它。
  '只改跳转：{"op":"setLinks","screen":0,"links":[{"from":"节点 id","to":目标页序号}]}（整页替换这一页的跳转表）。' +
  "只改一处文案/加一个按钮/删一块 ⇒ 用 patch；**加一页也用 patch 的 addScreen，不要为此重画所有页**；" +
  "只有整页重排、用户明确要求重画时才用 prototype 整页给出。二者不要同时给。";

/**
 * 给模型看的原语说明——**唯一**一份，`DESIGN_CHAT_SYSTEM_PROMPT` 拼它，不另抄。
 * 与上面各 `*Props` 同步维护；契约测试 `design-prototype.test.ts` 检查每个类型名都出现在这段文字里。
 */
export const PROTOTYPE_SCHEMA_GUIDE =
  "节点形如 {\"type\":..., \"props\":{...}, \"children\":[...]}（只有 stack/card/grid 有 children）。类型与 props：" +
  "stack{direction:row|column, gap/padding:none|sm|md|lg, align:start|center|end|between, fill:bool}；" +
  "card{title?, radius:none|sm|md|lg|full, padding:none|sm|md|lg}；navbar{title, left?, right?}；text{content, variant:title|subtitle|body|caption|label, muted?, align:start|center|end}；" +
  "button{label, variant:primary|secondary|ghost|danger, full?, size:sm|md|lg, radius:none|sm|md|lg|full}；input{placeholder?, label?, value?, multiline?}；" +
  "image{alt, ratio:square|video|wide|portrait}；list{items:[..], leading:none|dot|check|avatar}；divider{}；" +
  "spacer{size:none|sm|md|lg}；tabs{items:[..], active?}；badge{label, tone:neutral|info|success|warning|danger}；avatar{name, size:sm|md|lg}；" +
  "bottomnav{items:[2–6 项], active?}（放页面最底部）；switch{label, on?}；checkbox{label, checked?}；chip{label, selected?}（常放 row stack 里）；" +
  "progress{value:0–100, label?}；stat{label, value, delta?, tone:neutral|success|danger}（KPI 卡）；hero{title, subtitle?, cta?}（头图区）；" +
  "grid{columns:2|3, gap:none|sm|md|lg}（有 children 的网格容器，放 stat/card 等）。" +
  `每页根节点通常是 stack(column)。每页 ≤ ${PROTOTYPE_MAX_NODES} 节点、深度 ≤ ${PROTOTYPE_MAX_DEPTH}，不要给出这里没有的 type 或 props。` +
  `每页可带 notes（≤ ${PROTOTYPE_NOTES_MAX} 字）：这页做什么、主要交互、空态/加载/错误怎么处理——给工程看的交互说明，会进设计文档。` +
  // 迭代 11：不教模型连线，"可点击原型"就只剩人手一条条连——那正是人类要的相反面。
  `每页还可带 links（≤ ${PROTOTYPE_MAX_LINKS} 条）：这页点了之后去哪。形如 {"from":"节点 id","to":目标页序号}；` +
  "多项原语（list/tabs/bottomnav）和 navbar 的左右按钮要多给一个 item（第几项，0 起；navbar 左 0 右 1）。" +
  "to 是**页序号**（0 起，按你给出的页顺序），不是页标签。" +
  "想连线就**自己给那个节点写 id**——id 允许你写，不写的由服务端补，那样你就指不到它。" +
  "指向不存在的页、自己指自己、指向本页没有的节点：那一条会被丢掉，其余照常生效，不影响这一页。";
