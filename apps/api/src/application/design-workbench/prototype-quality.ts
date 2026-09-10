import { designPrototype } from "@repo/contracts";

/**
 * 单页原型的**结构自审**——运行期那一半的质量门（issue #3340）。
 *
 * ## 它和「截图审计门」不是同一个分数，别混
 *
 * `.harness/rubrics/prototype-screenshot-audit.md` 那道门量的是**真浏览器里的 DOM 几何**
 * （占比 / 密度 / 裁切 / 字号档数 / 对齐轴），跑在 CI 上、审固定夹具、卡我交付。
 * 这里量的是**树的结构**，跑在服务端生成过程中、审用户刚生成的那一页。
 * 服务端没有浏览器，量不了几何；把两者说成同一个分数就是本仓那条「同一事实两处」的
 * 反面——它们是**两种不同的事实**，各有各的量程，所以命名、阈值、报法都分开。
 *
 * ## 为什么需要它
 *
 * 用户实测（#3340）：「界面质量很差，感觉没有迭代就提交了，流程没有完整执行」。
 * 属实——生成路径里**唯一**的重试是「截断了 ⇒ 要求模型画简单一点」，方向是**更简陋**，
 * 不是更好。也就是说这条链路上从来没有任何一处在问「画出来的东西够不够像个界面」。
 *
 * ## 每条扣分都必须能被模型照着改
 *
 * 「看起来不专业」对模型没有可操作性。所以每条指标都给出**具体缺什么**（少了几个节点、
 * 只有一档字号、有几个空容器……），重试时把这句话原样发回去。给不出可操作反馈的指标
 * 不如不要——那样的重试只是碰运气。
 */

export interface QualityDeduction {
  readonly metric: string;
  /** 0–1，1 = 这条满分。 */
  readonly score: number;
  /** 给模型看的话：缺什么、该怎么补。满分时为空串。 */
  readonly hint: string;
}

export interface QualityReport {
  readonly total: number;
  readonly parts: readonly QualityDeduction[];
  /** 未达标时给模型的整段反馈；达标时为空串。 */
  readonly feedback: string;
}

/** 达标线。低于它才重试——重试有成本（多一次模型调用），不为了 1 分去花。 */
export const PROTOTYPE_QUALITY_THRESHOLD = 70;

/**
 * 一轮生成里最多重试几页。
 *
 * 不设上限的话，8 页项目最坏要 1 + 8 + 8 = 17 次模型调用，用户要等的时间翻倍——
 * 「质量更好」不该以「等到怀疑系统挂了」为代价。超预算的页如实记日志，不静默。
 */
export const PROTOTYPE_QUALITY_MAX_RETRIES = 3;

const INTERACTIVE = new Set(["button", "input", "tabs", "bottomnav", "switch", "checkbox", "chip", "list"]);
const CONTAINER = new Set(["stack", "card", "grid"]);

function walk(node: designPrototype.PrototypeNode, visit: (n: designPrototype.PrototypeNode) => void): void {
  visit(node);
  if (designPrototype.isPrototypeContainer(node)) for (const c of node.children) walk(c, visit);
}

/** M1 内容量：一页只有几个节点，渲染出来就是一张几乎空的板子。 */
function substance(nodes: readonly designPrototype.PrototypeNode[]): QualityDeduction {
  const n = nodes.length;
  if (n >= 12) return { metric: "substance", score: 1, hint: "" };
  if (n >= 8) return { metric: "substance", score: 0.7, hint: `这一页只有 ${String(n)} 个元素，偏空。` };
  return {
    metric: "substance",
    score: Math.max(0, n / 12),
    hint: `这一页只有 ${String(n)} 个元素——渲染出来几乎是空的。补足真实内容：标题、正文、可操作的控件，不要只放一两个占位。`,
  };
}

/** M2 层次：`text.variant` 只有一档 ⇒ 标题正文一样大，用户点名过的毛病。 */
function hierarchy(nodes: readonly designPrototype.PrototypeNode[]): QualityDeduction {
  const variants = new Set(
    nodes.filter((n) => n.type === "text").map((n) => (n.props as { variant?: string }).variant ?? "body"),
  );
  if (variants.size === 0) return { metric: "hierarchy", score: 1, hint: "" };
  if (variants.size >= 3) return { metric: "hierarchy", score: 1, hint: "" };
  if (variants.size === 2) return { metric: "hierarchy", score: 0.75, hint: "字号只有两档，层次偏弱。" };
  return {
    metric: "hierarchy",
    score: 0.3,
    hint: "全页文字只有一档字号，标题和正文一样大、没有层次。给标题用 variant:\"title\"、辅助文字用 \"caption\"。",
  };
}

/** M3 空容器：stack/card/grid 里一个孩子都没有 ⇒ 屏上一块空白。 */
function emptyContainers(nodes: readonly designPrototype.PrototypeNode[]): QualityDeduction {
  const empty = nodes.filter((n) => CONTAINER.has(n.type) && designPrototype.isPrototypeContainer(n) && n.children.length === 0);
  if (empty.length === 0) return { metric: "emptyContainers", score: 1, hint: "" };
  return {
    metric: "emptyContainers",
    score: Math.max(0, 1 - empty.length * 0.34),
    hint: `有 ${String(empty.length)} 个容器是空的，渲染出来是空白块。要么填上内容，要么删掉。`,
  };
}

/** M4 可操作性：一个可交互控件都没有的「界面」是海报，不是界面。 */
function affordance(nodes: readonly designPrototype.PrototypeNode[]): QualityDeduction {
  const hit = nodes.some((n) => INTERACTIVE.has(n.type));
  if (hit) return { metric: "affordance", score: 1, hint: "" };
  return {
    metric: "affordance",
    score: 0,
    hint: "这一页没有任何可操作的控件（按钮 / 输入框 / 列表 / 标签页 / 底部导航）——那是一张海报，不是一个界面。",
  };
}

/** M5 重复文案：同一句话反复出现 ⇒ 填充物，不是设计。 */
function duplicateCopy(nodes: readonly designPrototype.PrototypeNode[]): QualityDeduction {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.type !== "text") continue;
    const c = (n.props as { content?: string }).content?.trim() ?? "";
    if (c.length >= 2) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst === undefined || worst[1] < 3) return { metric: "duplicateCopy", score: 1, hint: "" };
  return {
    metric: "duplicateCopy",
    score: Math.max(0, 1 - (worst[1] - 2) * 0.25),
    hint: `「${worst[0].slice(0, 20)}」重复出现了 ${String(worst[1])} 次，像填充物。换成这一页真实会出现的文案。`,
  };
}

const WEIGHTS: Readonly<Record<string, number>> = {
  substance: 0.3, hierarchy: 0.2, emptyContainers: 0.2, affordance: 0.2, duplicateCopy: 0.1,
};

/**
 * 给一页打分（0–100）并产出可操作反馈。
 *
 * ⚠ 空集防线：树遍历不出任何节点（不该发生）⇒ **判 0**，不因为「没发现问题」而判绿。
 */
export function scorePrototypeScreen(root: designPrototype.PrototypeNode): QualityReport {
  const nodes: designPrototype.PrototypeNode[] = [];
  walk(root, (n) => nodes.push(n));
  if (nodes.length === 0) {
    return { total: 0, parts: [], feedback: "这一页是空的——拒绝下判断。" };
  }
  const parts = [substance(nodes), hierarchy(nodes), emptyContainers(nodes), affordance(nodes), duplicateCopy(nodes)];
  const total = Math.round(parts.reduce((sum, p) => sum + p.score * (WEIGHTS[p.metric] ?? 0), 0) * 100);
  const hints = parts.filter((p) => p.hint !== "").map((p) => `· ${p.hint}`);
  return {
    total,
    parts,
    feedback: total >= PROTOTYPE_QUALITY_THRESHOLD || hints.length === 0 ? "" : hints.join("\n"),
  };
}
