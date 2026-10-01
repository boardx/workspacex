/**
 * 分页生成的单页输出，在过契约**之前**做的保守修正（issue #4321）。
 *
 * ## 为什么要有它
 *
 * 真实模型实测（qwen3.8-max，20 次生成）：规划的页只画出约一半，另一半在画布上是空白的
 * 「还没有原型」。取证（录下每次补全原文、事后逐节点对契约）拒因几乎全是**机械小错**：
 *   · 叶子节点带 `children: []`——68 次，**全部是空数组**；
 *   · JSON 多一个右括号（结尾已完整，计数多一个 `}`）——9 次；
 *   · 可选字符串给了空串（`navbar.right: ""`）、`divider` 带空 `props: {}`、`id` 写进 props；
 *   · `radio.selected` 写成了选项文字而不是序号。
 * 严格契约下一处小错整页丢掉，用户看到的是一片空。
 *
 * ## 纪律：只做**不丢信息**的修正
 *
 * 每一条修正都必须满足「修完表达的东西和模型写的一样」：
 *   · 空数组 / 空对象 / 空串删掉——它们本来就什么都没说；
 *   · `props.id` 提到节点上——同一个值换个位置；
 *   · `radio.selected` 文字 → 它在 options 里的序号——**只在文字精确匹配某一项时**。
 * 不猜语义：非空的叶子 children、不在闭集里的图标名 / tone、缺必填字段，一律**不碰**，
 * 交给调用方带着契约报错重问一次（见 `design-chat-model.ts` 的 `drawOneScreen`）。
 * 修不了就让它红——静默「修」成另一个意思比丢页更糟。
 */
import { designPrototype } from "@repo/contracts";
import type { ZodIssue } from "zod";

/**
 * 括号配平：跳过多余的闭括号、在末尾补齐缺的闭括号（字符串里的括号不算）。
 *
 * 只在 `JSON.parse` 失败时才被调用，调用方拿它的结果再 parse 一次；解析仍失败就照旧失败。
 * ⚠ 不用来「救」真正的截断：截断时字符串或值断在半截，补括号救不回来，也不该假装救回来——
 *   provider 报了 `truncated` 的输出不会走到这里（调用方先判截断）。
 */
export function balanceJsonBrackets(text: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out.push(ch); continue; }
    if (ch === "{" || ch === "[") { stack.push(ch === "{" ? "}" : "]"); out.push(ch); continue; }
    if (ch === "}" || ch === "]") {
      if (stack.at(-1) === ch) { stack.pop(); out.push(ch); }
      // 不匹配 / 多余的闭括号：丢掉。
      continue;
    }
    out.push(ch);
  }
  return out.join("") + stack.reverse().join("");
}

/** 从模型输出里取出 JSON 对象；直接解析失败时配平括号再试一次。都失败 ⇒ 抛。 */
export function parseScreenJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in model output");
  const end = text.lastIndexOf("}");
  if (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* 落到配平 */ }
  }
  return JSON.parse(balanceJsonBrackets(text.slice(start, end > start ? end + 1 : undefined)));
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const CONTAINERS = new Set<string>(designPrototype.PROTOTYPE_CONTAINER_TYPES);

function normalizeNode(node: unknown, fixes: string[], path: string): unknown {
  if (!isRec(node)) return node;
  const n: Rec = { ...node };
  const type = String(n.type);

  if (!CONTAINERS.has(type) && Array.isArray(n.children) && n.children.length === 0) {
    delete n.children;
    fixes.push(`${path}: 删掉叶子 ${type} 的空 children`);
  }

  if (isRec(n.props)) {
    const props: Rec = { ...n.props };
    if (typeof props.id === "string" && props.id !== "") {
      if (n.id === undefined) n.id = props.id;
      delete props.id;
      fixes.push(`${path}: props.id 提到节点上`);
    }
    for (const [k, v] of Object.entries(props)) {
      if (v === "") { delete props[k]; fixes.push(`${path}: 删掉空串 ${type}.${k}`); }
    }
    // 只有图标没有字的按钮（白板 / 编辑器工具栏的常见写法）：用图标的中文名补上文字——图标是闭集、含义确定。
    if (type === "button" && (props.label === undefined || props.label === "") && typeof props.icon === "string") {
      const parsed = designPrototype.PrototypeIcon.safeParse(props.icon);
      // 名字取契约里图标的中文名（属性面板选图标时显示的同一张表，单一事实源）。
      if (parsed.success) { props.label = designPrototype.prototypeOptionLabel("button", "icon", parsed.data); fixes.push(`${path}: 纯图标按钮补文字「${String(props.label)}」`); }
    }
    if (type === "radio" && typeof props.selected === "string" && Array.isArray(props.options)) {
      const idx = props.options.indexOf(props.selected);
      if (idx !== -1) { props.selected = idx; fixes.push(`${path}: radio.selected 文字 → 序号 ${idx}`); }
    }
    if (Object.keys(props).length === 0 && designPrototype.PROTOTYPE_PROPS_SCHEMAS[type as designPrototype.PrototypeNodeType] === null) {
      delete n.props;
      fixes.push(`${path}: 删掉 ${type} 的空 props`);
    } else {
      n.props = props;
    }
  }

  if (Array.isArray(n.children)) n.children = n.children.map((c, i) => normalizeNode(c, fixes, `${path}.${i}`));
  return n;
}

/** 对单页候选（`{frame, root, notes?, links?}`）做保守修正。返回新对象与修了什么（给日志）。 */
export function normalizeScreenCandidate(screen: Rec): { readonly screen: Rec; readonly fixes: readonly string[] } {
  const fixes: string[] = [];
  const out: Rec = { ...screen };
  if (out.root !== undefined) out.root = normalizeNode(out.root, fixes, "root");
  if (out.notes === "") { delete out.notes; fixes.push("删掉空串 notes"); }
  return { screen: out, fixes };
}

/** 闭集越界时不把整张可选清单抄回去（图标清单几十项，系统提示里已经有了），只说收到了什么。 */
function issueText(x: ZodIssue): string {
  if (x.code === "invalid_enum_value") return `「${String(x.received)}」不在可选值里，换成清单里有的`;
  if (x.code === "invalid_type" && x.received === "undefined") return "缺这个必填字段（不能是空串）";
  return x.message;
}

/**
 * 契约报错 → 给模型看的几行话（重问时原样发回），也进日志。
 *
 * 联合类型（`PrototypeNode`）整体不匹配时 zod 只报 `root: Invalid input`，模型拿到这句话
 * 改不了任何东西——所以逐节点按类型再校验一遍 props，报出**哪个节点的哪个字段**错了。
 */
export function describeScreenIssues(screen: Rec, limit = 6): string[] {
  const lines: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (!isRec(node) || lines.length >= limit) return;
    const type = String(node.type);
    const schema = designPrototype.PROTOTYPE_PROPS_SCHEMAS[type as designPrototype.PrototypeNodeType];
    if (schema === undefined) lines.push(`${path}：没有「${type}」这种类型`);
    else if (schema === null && node.props !== undefined) lines.push(`${path}（${type}）：这种类型不带 props`);
    else if (schema !== null && node.props !== undefined) {
      const r = schema.safeParse(node.props);
      if (!r.success) for (const x of r.error.issues.slice(0, 2)) lines.push(`${path}（${type}）.${x.path.join(".")}：${issueText(x)}`);
    }
    if (!CONTAINERS.has(type) && node.children !== undefined) lines.push(`${path}（${type}）：只有 ${[...CONTAINERS].join("/")} 能有 children`);
    if (Array.isArray(node.children)) node.children.forEach((c, i) => walk(c, `${path}.${i}`));
  };
  walk(screen.root, "root");
  if (lines.length === 0) {
    const r = designPrototype.PrototypeScreen.safeParse(screen);
    if (!r.success) for (const x of r.error.issues.slice(0, limit)) lines.push(`${x.path.join(".") || "(页)"}：${issueText(x)}`);
  }
  return lines.slice(0, limit);
}
