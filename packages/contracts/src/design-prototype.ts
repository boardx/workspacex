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
const CardProps = z.object({ title: Label.optional() }).strict();
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
const AvatarProps = z.object({ name: Label }).strict();
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

/** 模型写回用的一页：页标签 + 这一页的树。服务端拆成 `frames[i]` / `prototype[i]`。 */
export const PrototypeScreen = z
  .object({ frame: Label, root: PrototypeNode })
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
export interface PrototypeField {
  readonly key: string;
  readonly label: string;
  readonly kind: PrototypeFieldKind;
  /** `kind === "enum"` 时的闭集；由对应 `z.enum` 的 `options` 派生，不手抄。 */
  readonly options?: readonly string[];
}

const SCALE_OPTIONS = Scale.options;
const F = (key: string, label: string, kind: PrototypeFieldKind, options?: readonly string[]): PrototypeField => ({ key, label, kind, ...(options !== undefined ? { options } : {}) });

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
  card: [F("title", "标题", "text")],
  navbar: [F("title", "标题", "text"), F("left", "左侧", "text"), F("right", "右侧", "text")],
  text: [
    F("content", "文案", "multiline"), F("variant", "样式", "enum", TextProps.shape.variant.unwrap().options),
    F("muted", "弱化", "bool"), F("align", "对齐", "enum", TextProps.shape.align.unwrap().options),
  ],
  button: [F("label", "文案", "text"), F("variant", "样式", "enum", ButtonProps.shape.variant.unwrap().options), F("full", "通栏", "bool")],
  input: [F("placeholder", "占位文字", "text"), F("label", "标签", "text"), F("value", "已填内容", "text"), F("multiline", "多行", "bool")],
  image: [F("alt", "说明", "text"), F("ratio", "比例", "enum", ImageProps.shape.ratio.unwrap().options)],
  list: [F("items", "条目（一行一项）", "lines"), F("leading", "前缀", "enum", ListProps.shape.leading.unwrap().options)],
  divider: [],
  spacer: [F("size", "高度", "enum", SCALE_OPTIONS)],
  tabs: [F("items", "标签（一行一项）", "lines"), F("active", "当前项（从 0 起）", "number")],
  badge: [F("label", "文案", "text"), F("tone", "色调", "enum", BadgeProps.shape.tone.unwrap().options)],
  avatar: [F("name", "名字", "text")],
  bottomnav: [F("items", "项（一行一项，2–6）", "lines"), F("active", "当前项（从 0 起）", "number")],
  switch: [F("label", "文案", "text"), F("on", "打开", "bool")],
  checkbox: [F("label", "文案", "text"), F("checked", "已选", "bool")],
  chip: [F("label", "文案", "text"), F("selected", "选中", "bool")],
  progress: [F("value", "进度（0–100）", "number"), F("label", "说明", "text")],
  stat: [F("label", "指标名", "text"), F("value", "数值", "text"), F("delta", "变化", "text"), F("tone", "色调", "enum", StatProps.shape.tone.unwrap().options)],
  hero: [F("title", "标题", "text"), F("subtitle", "副标题", "multiline"), F("cta", "按钮文案", "text")],
  grid: [F("columns", "列数（2 或 3）", "number"), F("gap", "间距", "enum", SCALE_OPTIONS)],
};

/* ─────────────────────────── 迭代 1：增量修改（patch） ─────────────────────────── */

export const PROTOTYPE_MAX_PATCH_OPS = 50;

/**
 * 四种 patch 操作，全部按节点 id 寻址（id 在项目内唯一，所以不带页）：
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
]);
export type PrototypePatchOp = z.infer<typeof PrototypePatchOp>;
export const DesignPrototypePatch = z.array(PrototypePatchOp).min(1).max(PROTOTYPE_MAX_PATCH_OPS);
export type DesignPrototypePatch = z.infer<typeof DesignPrototypePatch>;

function collectIds(root: PrototypeNode, out: Set<string>): void {
  if (root.id !== undefined) out.add(root.id);
  if (isPrototypeContainer(root)) for (const c of root.children) collectIds(c, out);
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
]);
export type PrototypePatchRejectReason = z.infer<typeof PrototypePatchRejectReason>;

export class PrototypePatchError extends Error {
  constructor(readonly opIndex: number, readonly reason: PrototypePatchRejectReason, message: string, readonly nodeId?: string) {
    super(`patch op #${opIndex}: ${message}`);
    this.name = "PrototypePatchError";
  }
}

/**
 * 顺序应用一批 patch，返回**新的** `prototype`（不改入参）。每一步的结果都重新过 `PrototypeNode`
 * 契约与整页上限；任何一步不合法抛 `PrototypePatchError`（调用方据此整批拒绝）。
 * 结果里新增的节点由 `ensurePrototypeIds` 补 id。
 */
export function applyPrototypePatch(prototype: readonly PrototypeNode[], ops: readonly PrototypePatchOp[]): readonly PrototypeNode[] {
  let current: readonly PrototypeNode[] = prototype;
  ops.forEach((op, i) => {
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
    const next: PrototypeNode[] = [];
    for (const root of current) {
      const r = visit(root);
      if (r === null) throw new PrototypePatchError(i, "ROOT_REMOVE", `cannot remove page root ${root.id ?? ""}`, root.id);
      next.push(r);
    }
    const target = op.op === "insert" ? op.parentId : op.id;
    if (hit === 0) throw new PrototypePatchError(i, "UNKNOWN_NODE", `no node with id ${target}`, target);
    if (hit > 1) throw new PrototypePatchError(i, "DUPLICATE_ID", `id ${target} is not unique`, target);
    current = ensurePrototypeIds(next);
  });
  for (const [k, root] of current.entries()) {
    if (!withinPrototypeLimits(root)) throw new PrototypePatchError(ops.length, "LIMITS", `page ${k + 1} exceeds limits after patch`);
  }
  if (!prototypeIdsUnique(current)) throw new PrototypePatchError(ops.length, "DUPLICATE_ID", "ids not unique after patch");
  return current;
}

/**
 * 迭代 2：按 id 找节点，返回从页根到它的路径（含自身）与页序号；找不到 ⇒ null。
 * 画布选中态（面包屑）与模型上下文（「用户选中了 …」）共用，不各写一份遍历。
 */
export function findPrototypeNodePath(
  prototype: readonly PrototypeNode[],
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

const NUMERIC_KEYS = new Set(["value", "active", "columns"]);

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
    for (const k of NUMERIC_KEYS) {
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
  "只改一处文案/加一个按钮/删一块 ⇒ 用 patch；新页面、整页重排、用户要求重画 ⇒ 用 prototype 整页给出。二者不要同时给。";

/**
 * 给模型看的原语说明——**唯一**一份，`DESIGN_CHAT_SYSTEM_PROMPT` 拼它，不另抄。
 * 与上面各 `*Props` 同步维护；契约测试 `design-prototype.test.ts` 检查每个类型名都出现在这段文字里。
 */
export const PROTOTYPE_SCHEMA_GUIDE =
  "节点形如 {\"type\":..., \"props\":{...}, \"children\":[...]}（只有 stack/card/grid 有 children）。类型与 props：" +
  "stack{direction:row|column, gap/padding:none|sm|md|lg, align:start|center|end|between, fill:bool}；" +
  "card{title?}；navbar{title, left?, right?}；text{content, variant:title|subtitle|body|caption|label, muted?, align?}；" +
  "button{label, variant:primary|secondary|ghost|danger, full?}；input{placeholder?, label?, value?, multiline?}；" +
  "image{alt, ratio:square|video|wide|portrait}；list{items:[..], leading:none|dot|check|avatar}；divider{}；" +
  "spacer{size?}；tabs{items:[..], active?}；badge{label, tone:neutral|info|success|warning|danger}；avatar{name}；" +
  "bottomnav{items:[2–6 项], active?}（放页面最底部）；switch{label, on?}；checkbox{label, checked?}；chip{label, selected?}（常放 row stack 里）；" +
  "progress{value:0–100, label?}；stat{label, value, delta?, tone:neutral|success|danger}（KPI 卡）；hero{title, subtitle?, cta?}（头图区）；" +
  "grid{columns:2|3, gap?}（有 children 的网格容器，放 stat/card 等）。" +
  `每页根节点通常是 stack(column)。每页 ≤ ${PROTOTYPE_MAX_NODES} 节点、深度 ≤ ${PROTOTYPE_MAX_DEPTH}，不要给出这里没有的 type 或 props。`;
