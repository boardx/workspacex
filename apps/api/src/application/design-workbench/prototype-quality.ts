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

/** 预算的硬顶。页数再多也不超过它——这是「用户愿意等多久」的上限，不是质量上限。 */
export const PROTOTYPE_QUALITY_RETRY_CAP = 6;

/**
 * 迭代 16（#3773 R1-④）——**按页数给预算**，而不是全局固定 3 次。
 *
 * 固定 3 次的实际表现是：前三页各差一点，预算就见底，第 4 页往后**无论多烂都不重问**，
 * 而骨架轮本来就把最核心的页排在前面——于是预算全花在了本来就最好的几页上，
 * 越往后越差。用户看到的正是「后面几页明显敷衍」。
 *
 * 现在：每页各有一次机会（`pages` 次），封顶 `PROTOTYPE_QUALITY_RETRY_CAP`。
 * 3–6 页的常见项目因此**每一页都能被重问一次**，而 20 页的极端项目仍然只多花 6 次调用。
 */
export const qualityRetryBudget = (pages: number): number =>
  Math.min(Math.max(pages, PROTOTYPE_QUALITY_MAX_RETRIES), PROTOTYPE_QUALITY_RETRY_CAP);

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
  /**
   * 迭代 16（#3773 R1-①）：**整页一个 `text` 节点都没有时判 0.3，不是满分**。
   *
   * 原来这里 `variants.size === 0 ⇒ score 1`——「没有文字」被当成「没有层次问题」，
   * 于是最该扣分的那种页（全是控件、一句真实文案都没有）在层次这条上拿满分。
   * 这正是本仓那条「空集不许判绿」：没有文字不是没有问题，是问题更大。
   */
  if (variants.size === 0) {
    return {
      metric: "hierarchy",
      score: 0.3,
      hint: "这一页没有任何文字节点——只有控件没有说明，用户不知道这页是干什么的。补上标题（variant:\"title\"）和必要的说明文字。",
    };
  }
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

/**
 * M6 主操作（迭代 16，#3773 R1-②）：`DESIGN_PRINCIPLES` 第 ① 条写着「每页只有一个主操作」，
 * 而此前**没有任何一处在量它**——写在提示词里、没有门控的规范，就是本仓那条「没有脚本的
 * 规范条目视为未落地」。一页排着三个 primary 按钮，是「一眼看出是生成的」头号特征。
 *
 * 0 个也扣：没有主操作的页多半是漏了去处（用户走到这里就走不动了）。只有**纯展示页**
 * （没有任何 button）才豁免——那种页的主操作可能在 bottomnav 上。
 */
function primaryFocus(nodes: readonly designPrototype.PrototypeNode[]): QualityDeduction {
  const buttons = nodes.filter((n) => n.type === "button");
  if (buttons.length === 0) return { metric: "primaryFocus", score: 1, hint: "" };
  const primaries = buttons.filter((n) => ((n.props as { variant?: string }).variant ?? "primary") === "primary");
  if (primaries.length === 1) return { metric: "primaryFocus", score: 1, hint: "" };
  if (primaries.length === 0) {
    return {
      metric: "primaryFocus",
      score: 0.5,
      hint: "这一页有按钮但没有一个是主操作（variant:\"primary\"）——挑出这页最想让用户做的那一件事，把它设成 primary。",
    };
  }
  return {
    metric: "primaryFocus",
    score: Math.max(0, 1 - (primaries.length - 1) * 0.4),
    hint: `这一页有 ${String(primaries.length)} 个 primary 按钮，视觉重点被摊平了。只留最想让用户做的那一个，其余改成 secondary 或 ghost。`,
  };
}

/**
 * M7 占位文案（迭代 16，#3773 R1-③）：提示词里写了两遍「不要用占位符文字」，同样没有门控。
 *
 * ⚠ 判据刻意保守——只认**明显不是真实产品文案**的那几种形态（Lorem、`标题1`、`xxx`、
 *   `示例文本`、`待定`、`TODO`）。宁可漏判也不要误判：真实文案里出现「示例」二字是常有的事，
 *   误判会让一页好页被打回重画，比漏判贵。
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /lorem ipsum/i,
  /^(标题|副标题|正文|文本|内容|按钮|描述|说明)\s*[0-9一二三四五六七八九十]*$/,
  /^(item|title|text|label|button|placeholder|content)\s*[0-9]*$/i,
  /^[xX]{3,}$/,
  /^(待定|待补充|占位|示例文本|示例内容|todo|tbd)$/i,
];

function placeholderCopy(nodes: readonly designPrototype.PrototypeNode[]): QualityDeduction {
  const strings: string[] = [];
  for (const n of nodes) {
    // `divider` 没有 props 键，联合类型上取不到——统一当记录看。
    const props = ((n as { props?: unknown }).props ?? {}) as Record<string, unknown>;
    for (const key of ["content", "label", "title", "subtitle", "alt", "placeholder", "cta", "value", "name"]) {
      const v = props[key];
      if (typeof v === "string" && v.trim() !== "") strings.push(v.trim());
    }
    const items = props.items;
    if (Array.isArray(items)) for (const it of items) if (typeof it === "string" && it.trim() !== "") strings.push(it.trim());
  }
  const hits = strings.filter((v) => PLACEHOLDER_PATTERNS.some((re) => re.test(v)));
  if (hits.length === 0) return { metric: "placeholderCopy", score: 1, hint: "" };
  return {
    metric: "placeholderCopy",
    score: Math.max(0, 1 - hits.length * 0.34),
    hint: `有 ${String(hits.length)} 处占位文案（如「${hits[0]!.slice(0, 20)}」）。换成这个产品里真的会出现的话——原型的价值就在于让人看见真实内容。`,
  };
}

/**
 * M8 死路（迭代 16，#3773 R6）：这一页的**主操作没有去处**。
 *
 * `DESIGN_PRINCIPLES` 第 ⑦ 条写着「每页的主操作都要有去处，底部导航每一项都连到它那一页，
 * 别留死按钮」——和 ① 一样，写在提示词里、没有任何门控。表现就是用户点进预览、
 * 按遍所有按钮都没反应，「可点击原型」这件事只在文档里成立。
 *
 * ⚠ 只在**整个项目多于一页**时判：单页项目没有地方可去，那不是死路。
 * ⚠ 只判主操作与底部导航，不判每一个按钮：一个「取消」按钮没有连线是正常的。
 */
function deadEnds(
  nodes: readonly designPrototype.PrototypeNode[],
  links: readonly designPrototype.PrototypeLink[] | undefined,
  screenCount: number,
): QualityDeduction {
  if (screenCount <= 1) return { metric: "deadEnds", score: 1, hint: "" };
  const linked = new Set((links ?? []).map((l) => l.from));
  const misses: string[] = [];
  const primary = nodes.find(
    (n): n is Extract<designPrototype.PrototypeNode, { type: "button" }> =>
      n.type === "button" && (n.props.variant ?? "primary") === "primary",
  );
  if (primary !== undefined && (primary.id === undefined || !linked.has(primary.id))) {
    misses.push(`主操作「${primary.props.label}」`);
  }
  const nav = nodes.find((n) => n.type === "bottomnav");
  if (nav !== undefined && (nav.id === undefined || !linked.has(nav.id))) misses.push("底部导航");
  if (misses.length === 0) return { metric: "deadEnds", score: 1, hint: "" };
  return {
    metric: "deadEnds",
    score: Math.max(0, 1 - misses.length * 0.5),
    hint:
      `${misses.join("、")}点下去没有去处——预览时它就是个死按钮。用 links 把它连到对应的页` +
      "（想连线就**自己给那个节点写 id**，不写的由服务端补，那样你就指不到它）。",
  };
}

const WEIGHTS: Readonly<Record<string, number>> = {
  substance: 0.2, hierarchy: 0.15, emptyContainers: 0.12, affordance: 0.12, duplicateCopy: 0.07,
  // 迭代 16：新加的三条——它们量的是「像不像人做的」「点不点得动」，
  // 与前五条量的「有没有内容」同等重要。
  primaryFocus: 0.13, placeholderCopy: 0.11, deadEnds: 0.1,
};

/**
 * 给一页打分（0–100）并产出可操作反馈。
 *
 * ⚠ 空集防线：树遍历不出任何节点（不该发生）⇒ **判 0**，不因为「没发现问题」而判绿。
 */
export function scorePrototypeScreen(
  root: designPrototype.PrototypeNode,
  /**
   * 迭代 16（#3773 R6）：这一页的跳转表与整个项目的页数——判「主操作有没有去处」要它们。
   *
   * 省略 ⇒ 按**单页项目**看待，M8 不扣分。这是刻意的保守：调用方拿不到跳转表时
   * （比如只想给一棵孤立的树打分）不该凭空判它有死路。
   */
  context?: { readonly links?: readonly designPrototype.PrototypeLink[]; readonly screenCount?: number },
): QualityReport {
  const nodes: designPrototype.PrototypeNode[] = [];
  walk(root, (n) => nodes.push(n));
  if (nodes.length === 0) {
    return { total: 0, parts: [], feedback: "这一页是空的——拒绝下判断。" };
  }
  const parts = [
    substance(nodes), hierarchy(nodes), emptyContainers(nodes), affordance(nodes), duplicateCopy(nodes),
    primaryFocus(nodes), placeholderCopy(nodes),
    deadEnds(nodes, context?.links, context?.screenCount ?? 1),
  ];
  const total = Math.round(parts.reduce((sum, p) => sum + p.score * (WEIGHTS[p.metric] ?? 0), 0) * 100);
  const hints = parts.filter((p) => p.hint !== "").map((p) => `· ${p.hint}`);
  return {
    total,
    parts,
    feedback: total >= PROTOTYPE_QUALITY_THRESHOLD || hints.length === 0 ? "" : hints.join("\n"),
  };
}
