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
]);
export type PrototypeNodeType = z.infer<typeof PrototypeNodeType>;

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
const TabsProps = z.object({ items: Items, active: z.number().int().min(0).optional() }).strict();
const BadgeProps = z.object({ label: Label, tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional() }).strict();
const AvatarProps = z.object({ name: Label }).strict();

/** 叶子节点：无 `children`。 */
const Leaf = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navbar"), props: NavbarProps }).strict(),
  z.object({ type: z.literal("text"), props: TextProps }).strict(),
  z.object({ type: z.literal("button"), props: ButtonProps }).strict(),
  z.object({ type: z.literal("input"), props: InputProps }).strict(),
  z.object({ type: z.literal("image"), props: ImageProps }).strict(),
  z.object({ type: z.literal("list"), props: ListProps }).strict(),
  z.object({ type: z.literal("divider") }).strict(),
  z.object({ type: z.literal("spacer"), props: SpacerProps.optional() }).strict(),
  z.object({ type: z.literal("tabs"), props: TabsProps }).strict(),
  z.object({ type: z.literal("badge"), props: BadgeProps }).strict(),
  z.object({ type: z.literal("avatar"), props: AvatarProps }).strict(),
]);

export type PrototypeNode =
  | z.infer<typeof Leaf>
  | { readonly type: "stack"; readonly props?: z.infer<typeof StackProps>; readonly children: readonly PrototypeNode[] }
  | { readonly type: "card"; readonly props?: z.infer<typeof CardProps>; readonly children: readonly PrototypeNode[] };

/**
 * 递归节点。容器（`stack`/`card`）必有 `children`（可空数组），叶子没有。
 * 深度/节点数上限在 `PrototypeScreen` 上整页判，不在这里逐节点判（zod 递归里拿不到深度）。
 */
export const PrototypeNode: z.ZodType<PrototypeNode> = z.lazy(() =>
  z.union([
    Leaf,
    z.object({ type: z.literal("stack"), props: StackProps.optional(), children: z.array(PrototypeNode).max(PROTOTYPE_MAX_NODES) }).strict(),
    z.object({ type: z.literal("card"), props: CardProps.optional(), children: z.array(PrototypeNode).max(PROTOTYPE_MAX_NODES) }).strict(),
  ]),
);

/** 度量一棵树：节点总数与最大深度（根 = 深度 1）。渲染层与文档导出也用它，不各自再写一份遍历。 */
export function measurePrototype(root: PrototypeNode): { readonly nodes: number; readonly depth: number } {
  let nodes = 0;
  let depth = 0;
  const walk = (n: PrototypeNode, d: number): void => {
    nodes += 1;
    if (d > depth) depth = d;
    if (n.type === "stack" || n.type === "card") for (const c of n.children) walk(c, d + 1);
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

/**
 * 给模型看的原语说明——**唯一**一份，`DESIGN_CHAT_SYSTEM_PROMPT` 拼它，不另抄。
 * 与上面各 `*Props` 同步维护；契约测试 `design-prototype.test.ts` 检查每个类型名都出现在这段文字里。
 */
export const PROTOTYPE_SCHEMA_GUIDE =
  "节点形如 {\"type\":..., \"props\":{...}, \"children\":[...]}（只有 stack/card 有 children）。类型与 props：" +
  "stack{direction:row|column, gap/padding:none|sm|md|lg, align:start|center|end|between, fill:bool}；" +
  "card{title?}；navbar{title, left?, right?}；text{content, variant:title|subtitle|body|caption|label, muted?, align?}；" +
  "button{label, variant:primary|secondary|ghost|danger, full?}；input{placeholder?, label?, value?, multiline?}；" +
  "image{alt, ratio:square|video|wide|portrait}；list{items:[..], leading:none|dot|check|avatar}；divider{}；" +
  "spacer{size?}；tabs{items:[..], active?}；badge{label, tone:neutral|info|success|warning|danger}；avatar{name}。" +
  `每页根节点通常是 stack(column)。每页 ≤ ${PROTOTYPE_MAX_NODES} 节点、深度 ≤ ${PROTOTYPE_MAX_DEPTH}，不要给出这里没有的 type 或 props。`;
