"use client";
/**
 * 迭代 5 —— 属性面板：选中节点后直接改文案/属性，或删掉它。
 *
 * 每种原语一张字段表（`FIELDS`），按契约 `*Props` 手写对应；提交时只把**改了的键**打成一条
 * `setProps` patch（浅合并，服务端重验）——走的是与模型写回完全同一条 `applyPrototypePatch` 路径。
 * 失败（400 `PROTOTYPE_PATCH_REJECTED`）把服务端的 detail 原样显示，不吞。
 * 列表类字段（list.items / tabs.items）用多行文本，一行一项。
 */
import * as React from "react";
import { duplicateOps, moveOps } from "@/lib/prototype-node-actions";
import { Loader2, Trash2, Check, SlidersHorizontal, ChevronRight, Copy, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
import { patchPrototype, prototypeNodeLabel, linkSlotsOf, type DesignProject, type PrototypeLink, type PrototypeNode, type PrototypePatchOp } from "@/lib/live-design-workbench";

import { designPrototype } from "@repo/contracts";
import { InspectorImageField } from "./inspector-image-field";

/** 字段表来自契约（单源，契约测试锁定「每类型 key 集合 == props shape 键集合」）；这里只负责渲染。 */
const FIELDS = designPrototype.PROTOTYPE_FIELDS;
type Field = designPrototype.PrototypeField;

/** 服务端闭集 `patchReason` → 给人看的话。 */
const REJECT_TEXT: Record<designPrototype.PrototypePatchRejectReason, string> = {
  UNKNOWN_NODE: "这个节点已经不存在了（可能刚被模型改掉），重新选一个。",
  DUPLICATE_ID: "节点 id 重复，画布数据需要重新生成一次。",
  ROOT_REMOVE: "页面的根节点不能删。",
  NOT_CONTAINER: "目标不是容器，放不进子节点。",
  INVALID_NODE: "改完的属性不符合这种节点的规则，检查一下取值。",
  LIMITS: "这一页节点太多或嵌套太深了。",
  UNKNOWN_SCREEN: "这一页已经不存在了，画布可能刚被整页重画。刷新一下再试。",
  NO_PROTOTYPE: "还没有原型，先让模型画一版。",
};

type Draft = Record<string, string | boolean | number | undefined>;

function propsOf(node: PrototypeNode): Record<string, unknown> {
  return ("props" in node && node.props !== undefined ? node.props : {}) as Record<string, unknown>;
}

/**
 * 对标 R3（#3933）：表格数据与数字串的文本形态——一行一条，格子用 `|` 隔开；数字一行一个或逗号隔开。
 * 选文本形态而不是一个小表格编辑器：原型阶段改的是「样例数据长什么样」，一个多行输入框够用，
 * 也能直接从表格软件里粘过来（制表符同样当分隔）。
 */
const ROW_SEP = /\s*[|\t]\s*/;
export function rowsToText(v: unknown): string {
  return Array.isArray(v) ? (v as unknown[]).map((r) => (Array.isArray(r) ? r.map(String).join(" | ") : "")).join("\n") : "";
}
export function textToRows(t: string): string[][] {
  return t.split("\n").map((l) => l.trim()).filter((l) => l !== "").map((l) => l.split(ROW_SEP).map((c) => c.trim()));
}
export function numbersToText(v: unknown): string {
  return Array.isArray(v) ? (v as unknown[]).map(String).join("\n") : "";
}
/** 读不成数的片段丢掉（写错一个不该让整组数据作废——同契约「不要求等长」的取向）。 */
export function textToNumbers(t: string): number[] {
  return t.split(/[\s,，、]+/).filter((x) => x !== "").map(Number).filter((x) => Number.isFinite(x));
}

function toDraft(node: PrototypeNode): Draft {
  const p = propsOf(node);
  const d: Draft = {};
  for (const f of FIELDS[node.type]) {
    // 深度 S10：图不走草稿——选了就生效（`setImage`）。放进草稿的话，同一节点刷新时草稿里那份旧 src
    // 会被 diff 成「删掉它」，下一次「应用」就把刚上传的图静悄悄删了。
    if (f.kind === "image") continue;
    const v = p[f.key];
    if (f.kind === "lines") d[f.key] = Array.isArray(v) ? (v as string[]).join("\n") : "";
    else if (f.kind === "rows") d[f.key] = rowsToText(v);
    else if (f.kind === "numbers") d[f.key] = numbersToText(v);
    else if (f.kind === "bool") d[f.key] = v === true;
    else if (f.kind === "number") d[f.key] = typeof v === "number" ? v : undefined;
    // 迭代 13：`numeric` 的档位字段存的是数字（`grid.columns`）——原样带上，
    // 下拉靠 `String(...)` 显示。当成普通 enum 走 else 分支会把它读成 ""，
    // 表现是"明明是 3 列，面板里显示（默认）"。
    else if (f.numeric === true) d[f.key] = typeof v === "number" ? v : "";
    else d[f.key] = typeof v === "string" ? v : "";
  }
  return d;
}

/** 草稿 → 只含改动键的 props；空字符串 / 「（默认）」⇒ `null`（服务端 setProps 里 null = 删该键；`undefined` 会被 JSON 丢掉）。 */
function diff(node: PrototypeNode, draft: Draft): Record<string, unknown> {
  const before = toDraft(node);
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[node.type]) {
    if (f.kind === "image") continue; // 见 `toDraft`
    const a = before[f.key];
    const b = draft[f.key];
    if (a === b) continue;
    if (f.kind === "lines") out[f.key] = String(b ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    else if (f.kind === "rows") out[f.key] = textToRows(String(b ?? ""));
    else if (f.kind === "numbers") out[f.key] = textToNumbers(String(b ?? ""));
    else if (f.kind === "bool") out[f.key] = b === true;
    else if (f.kind === "number") out[f.key] = b === undefined ? null : b;
    else out[f.key] = b === "" ? null : b;
  }
  return out;
}

/**
 * 迭代 28：`patchReason` 之外的失败原来退回 `err.reasonCode ?? \`http_${err.status}\``——
 * 也就是在属性面板里把 `NOT_PROJECT_OWNER` / `http_403` 原样端给用户。改动本身已经在
 * 迭代 27 于对话那一侧修过一次，这里不再抄第二份人话表，直接走同一个 `describeFailure`。
 */
function reason(err: unknown): string {
  if (err instanceof ApiError) {
    const raw = err.raw as { patchReason?: unknown } | null | undefined;
    const parsed = designPrototype.PrototypePatchRejectReason.safeParse(raw?.patchReason);
    if (parsed.success) return REJECT_TEXT[parsed.data];
  }
  return describeFailure(err);
}

/** 契约 `patchPrototype.in.summary` ≤ 200：标签本身最长 200，拼上前缀必须截。 */
const summaryOf = (prefix: string, node: PrototypeNode): string => `${prefix}${prototypeNodeLabel(node)}`.slice(0, 200);

export function PrototypeInspector({
  projectId, node, path, onSaved, onDeleted, frames = [], frameIndex = 0, links = [], onSetLinks,
  prototype = [], onNodeOps,
}: {
  projectId: string;
  /**
   * 迭代 15：整页的树 + 动作入口。复制/上移/下移的 op 由 `lib/prototype-node-actions`
   * 算，执行交给父组件的 `onNodeOps`——与图层面板、键盘快捷键**同一条路**，
   * 三处不各写一遍。这里只负责按"走不走得动"禁用按钮。
   */
  prototype?: readonly (PrototypeNode | null)[];
  onNodeOps?: (ops: readonly designPrototype.PrototypePatchOp[] | null, summary: string) => void | Promise<void>;
  node: PrototypeNode;
  /** 从页根到该节点的路径（含自身），用作面包屑。 */
  path: readonly PrototypeNode[];
  onSaved: (project: DesignProject) => void;
  onDeleted: (project: DesignProject) => void;
  /**
   * 迭代 11（design-delta `prototype-navigation`，待签核）：「点击后跳转到」。
   * `links` 是**本页**的跳转表；改动交给 `onSetLinks(本页新的完整 links)`——对应 delta §3 的
   * `setLinks` op（整体替换一页的 links）。父组件真发请求，与模型走同一条写回路径（I-11）；
   * 这里只负责把失败如实显示出来，不吞。
   */
  frames?: readonly string[];
  frameIndex?: number;
  links?: readonly PrototypeLink[];
  onSetLinks?: (links: readonly PrototypeLink[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(node));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** 刚刚自动应用了上一个节点的改动——说一句，别让它是一件悄悄发生的事。 */
  const [autoApplied, setAutoApplied] = React.useState<string | null>(null);

  /**
   * 迭代 39（UIUX 第 19 轮）——**改了不按「应用」，一点别的东西就全没了**。
   *
   * 这一屏写着「按『应用』才画到画布上」，但它没说的是：在按之前点画布上另一个元素，
   * 这个 effect 会把草稿整个重置。用户改完一段文案、顺手去点下一个要改的东西——
   * 那段文案在两次点击之间消失，屏上不出一个字。这是本屏最高频的一次丢失。
   *
   * 取舍：**切走之前自动应用**，而不是弹一个框拦住他。理由是这一步有撤销（画布上方那个），
   * 而「拦住」会把最常见的一条路（改一个、再改下一个）变成每次多按一下。
   * 自动应用完在新节点上说一句「已自动应用」，不做静默的事。
   */
  /** `onSaved` 每次渲染都是新函数，用 ref 承接，免得下面那个 effect 跟着重挂。 */
  const onSavedRef = React.useRef(onSaved);
  onSavedRef.current = onSaved;
  /**
   * 上一次渲染时「选中的是谁、草稿是什么」。**不能**在 effect 的清理函数里读当前 ref
   * ——清理跑在新一轮 commit 里，那时 ref 已经指向新节点了；这里记的是上一轮的快照。
   */
  const snapRef = React.useRef<{ node: PrototypeNode; draft: Draft } | null>(null);

  React.useEffect(() => {
    const prev = snapRef.current;
    /*
     * ⚠ 2026-09-23 本地真栈实测（`scripts/local-session/design-loop-session.mjs` S08）抓到：
     * 这个 effect 依赖的是 `node` **对象**，而服务端每次写回都返回一整份新项目——
     * 当前选中的节点 id 没变，对象却是新的，于是 effect 又跑一遍，把刚设上的
     * 「已经帮你应用了」当场清掉。自动应用因此变回了静默的——正是 R19 说不许的那件事。
     * 单测没抓到，是因为 mock 回的是**同一个**项目对象，节点身份从来不变。
     *
     * 所以分两种：
     *   · 换了节点（id 变了）⇒ 重置草稿、清提示、自动应用上一个节点；
     *   · 同一个节点、对象换新（服务端刷新）⇒ **不清提示**；草稿只在用户没改过时跟着刷新
     *     ——否则上一个节点的写回一回来，他在这个节点上刚打的字就被覆盖掉了。
     */
    const switched = prev === null || prev.node.id !== node.id;
    if (!switched) {
      if (Object.keys(diff(prev.node, prev.draft)).length === 0) setDraft(toDraft(node));
      return;
    }
    setDraft(toDraft(node));
    setError(null);
    setAutoApplied(null);
    if (prev === null) return;
    const pid = prev.node.id;
    const changed = diff(prev.node, prev.draft);
    if (pid === undefined || Object.keys(changed).length === 0) return;
    void (async () => {
      try {
        const out = await patchPrototype(projectId, [{ op: "setProps", id: pid, props: changed }], summaryOf("改了", prev.node));
        onSavedRef.current(out.project);
        setAutoApplied(prototypeNodeLabel(prev.node));
      } catch {
        // 自动应用失败不抢屏：用户此刻在另一个节点上，只说一句「没保住」。
        setError(`上一个节点（${prototypeNodeLabel(prev.node)}）的改动没能保存，回去再改一次。`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);

  /** 每次渲染之后刷新快照——上面那个 effect 靠它认出「切走之前是什么样」。 */
  React.useEffect(() => {
    snapRef.current = { node, draft };
  });


  const changes = diff(node, draft);
  const dirty = Object.keys(changes).length > 0;
  const fields = FIELDS[node.type];
  /**
   * 迭代 13（delta §6）——「像 Figma，但**简化**」的形态：内容组默认展开（改文案是最常做的事），
   * 视觉组默认折叠（十个下拉一次全摊开，常用的那一个就被淹掉了）。
   * 折叠状态跟着**节点类型**走而不是跟着节点：连着调三个按钮的圆角时，
   * 不该每选一个就重新展开一次。
   */
  const [visualOpen, setVisualOpen] = React.useState(false);
  const contentFields = fields.filter((f) => f.group === "content");
  const visualFields = fields.filter((f) => f.group === "visual");
  const id = node.id;

  const apply = async () => {
    if (id === undefined || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const ops: PrototypePatchOp[] = [{ op: "setProps", id, props: changes }];
      const out = await patchPrototype(projectId, ops, summaryOf("改了", node));
      onSaved(out.project);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(false);
    }
  };
  /** 深度 S10：换图 / 移除图——选了就生效，不进草稿（见 `InspectorImageField`）。`null` = 删这个键。 */
  const setImage = async (src: string | null) => {
    if (id === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const out = await patchPrototype(projectId, [{ op: "setProps", id, props: { src } }], summaryOf(src === null ? "移除了图片" : "换上了图片", node));
      onSaved(out.project);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (id === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const out = await patchPrototype(projectId, [{ op: "remove", id }], summaryOf("删掉了", node));
      onDeleted(out.project);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(false);
    }
  };

  // 迭代 11：这个节点有几个可点位（单目标 1 / navbar 2 / 多项原语 = items 数），各自一个目标下拉。
  const slots = linkSlotsOf(node);
  const slotLabel = (i: number): string =>
    slots === 1 ? "点击后跳转到"
    : node.type === "navbar" ? (i === 0 ? "左侧按钮 → " : "右侧按钮 → ")
    : `「${(node as { props?: { items?: readonly string[] } }).props?.items?.[i] ?? i + 1}」 → `;
  const targetOf = (slot: number): number | "" => links.find((l) => l.from === id && (l.item ?? 0) === slot)?.to ?? "";
  const setTarget = (slot: number, raw: string) => {
    if (id === undefined || onSetLinks === undefined) return;
    const rest = links.filter((l) => !(l.from === id && (l.item ?? 0) === slot));
    if (raw === "") { onSetLinks(rest); return; }
    onSetLinks([...rest, slots > 1 ? { from: id, item: slot, to: Number(raw) } : { from: id, to: Number(raw) }]);
  };

  const fieldId = (k: string) => `proto-field-${k}`;
  const control = "h-8 w-full rounded-control border border-input bg-background px-2 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  /**
   * 一个字段一种控件。内容组与视觉组**共用这一个**渲染器——两边各写一遍的话，
   * 新增一种 kind 就要改两处，而漏改的那一处会静悄悄地渲染成空白。
   */
  const renderField = (f: (typeof fields)[number]) => (
        <div key={f.key} className={cn("flex gap-1", f.kind === "bool" ? "flex-row items-center justify-between" : "flex-col")}>
          <label htmlFor={fieldId(f.key)} className="text-10 font-medium text-muted-foreground">{f.label}</label>
          {/* 单行框里按回车就是「改好了」——原来回车什么也不发生，人只能去找那个按钮。 */}
          {f.kind === "text" && <Input id={fieldId(f.key)} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void apply(); } }} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {/* `lines` 是「一行一项」——这件事此前只写在代码注释里，框里一个字都没说。 */}
          {(f.kind === "multiline" || f.kind === "lines" || f.kind === "rows" || f.kind === "numbers") && <Textarea id={fieldId(f.key)} rows={f.kind === "multiline" ? 3 : f.kind === "rows" ? 6 : 4} placeholder={f.kind === "lines" ? "一行一项" : f.kind === "rows" ? "一行一条，格子用 | 隔开" : f.kind === "numbers" ? "一行一个数" : undefined} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {f.kind === "number" && <Input id={fieldId(f.key)} type="number" min={0} value={draft[f.key] === undefined ? "" : String(draft[f.key])} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {f.kind === "image" && <InspectorImageField id={fieldId(f.key)} src={typeof propsOf(node)[f.key] === "string" ? String(propsOf(node)[f.key]) : undefined} busy={busy} onChange={setImage} />}
          {f.kind === "bool" && <input id={fieldId(f.key)} type="checkbox" checked={draft[f.key] === true} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} disabled={busy} className="h-3.5 w-3.5 accent-primary" data-testid={`design-inspector-${f.key}`} />}
          {f.kind === "enum" && (
            <select
              id={fieldId(f.key)}
              value={String(draft[f.key] ?? "")}
              // ⚠ `numeric` 的档位字段（`grid.columns`）在 schema 里是数字：这里回转，
              //   否则会把 "2" 这个字符串发给服务端，被 `.strict()` 的 props schema 判拒。
              // ⚠ 清空必须留 `""`（`diff` 把它翻成 `null` = 删该键）；写 `undefined` 会被
              //   JSON 丢掉，于是"清掉这个属性"变成一次什么都没发生的请求——静默失效。
              //   `numeric` 的档位字段（`grid.columns`）在 schema 里是数字，非空时回转。
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === "" ? "" : f.numeric === true ? Number(e.target.value) : e.target.value })}
              disabled={busy}
              className={control}
              data-testid={`design-inspector-${f.key}`}
            >
              <option value="">（默认）</option>
              {/* 迭代 28：显示中文档位，`value` 仍是 schema 的英文字面量——改的是标签，不是取值。 */}
              {(f.options ?? []).map((o) => <option key={o} value={o}>{designPrototype.prototypeOptionLabel(node.type, f.key, o)}</option>)}
            </select>
          )}
        </div>
  );

  return (
    <section className="flex flex-col gap-2 border-b border-border p-3" data-testid="design-inspector">
      <div className="flex items-center gap-1.5 text-12 font-medium">
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {/* 文本节点的标签可以有二十多个字：不截就把右边那格类型挤出面板。 */}
        <span className="min-w-0 truncate" data-testid="design-inspector-title">{prototypeNodeLabel(node)}</span>
        {/* 迭代 28：节点 id 是内部标识，原来直接占着标题栏右半边。留在 title 里供排查用，不再摆在脸上。 */}
        {/* 迭代 39：这一格原来印的是 `bottomnav` / `chip` 这种内部类型名——对着屏幕的人不是写代码的人。 */}
        <span className="ml-auto text-10 text-muted-foreground" title={id} data-testid="design-inspector-node-id">{designPrototype.PROTOTYPE_NODE_TYPE_LABEL[node.type]}</span>
      </div>
      <p className="truncate text-10 text-muted-foreground" data-testid="design-inspector-path">{path.map(prototypeNodeLabel).join(" › ")}</p>
      {fields.length === 0 && <p className="text-11 text-muted-foreground">这种节点没有可改的属性。</p>}
      {contentFields.map(renderField)}

      {visualFields.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setVisualOpen((v) => !v)}
            aria-expanded={visualOpen}
            className="flex items-center gap-1 text-10 font-medium text-muted-foreground transition-colors duration-fast hover:text-background-foreground"
            data-testid="design-inspector-visual-toggle"
          >
            <ChevronRight aria-hidden className={cn("h-3 w-3 transition-transform duration-fast", visualOpen && "rotate-90")} />
            外观（{visualFields.length}）
          </button>
          {visualOpen && (
            <div className="flex flex-col gap-2" data-testid="design-inspector-visual">
              {visualFields.map(renderField)}
            </div>
          )}
        </div>
      )}
      {onSetLinks !== undefined && id !== undefined && slots > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2" data-testid="design-inspector-links">
          <p className="text-10 font-medium text-muted-foreground">点了之后跳到哪一页</p>
          {/* 只有一页时那个下拉里只有「无」，原来不解释——人会以为是坏了。 */}
          {frames.length < 2 && (
            <p className="text-10 text-muted-foreground" data-testid="design-inspector-link-need-pages">
              这个设计只有一页，还没有别的页可以跳。让 AI 再画一页，这里就能选了。
            </p>
          )}
          {Array.from({ length: slots }, (_, slot) => (
            <label key={slot} className="flex items-center gap-1.5 text-11">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{slotLabel(slot)}</span>
              <select value={targetOf(slot)} onChange={(e) => setTarget(slot, e.target.value)} disabled={busy} className={cn(control, "w-32 shrink-0")} data-testid={`design-inspector-link-${slot}`}>
                <option value="">无</option>
                {frames.map((f, i) => i !== frameIndex && <option key={i} value={i}>{i + 1} · {f}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      {error !== null && <p className="text-11 text-destructive" role="alert" data-testid="design-inspector-error">{error}</p>}
      {/*
        迭代 28：改完输入框什么都不会发生——要按「应用」。原来界面上没有任何一处说这件事，
        普通人改完文案就走了，回头发现画布没变。有未保存改动时明说。
      */}
      {autoApplied !== null && (
        <p className="text-10 text-muted-foreground" role="status" data-testid="design-inspector-auto-applied">
          上一个节点（{autoApplied}）的改动已经帮你应用了；不想要的话用画布上方的「撤销」。
        </p>
      )}
      {dirty && (
        <p className="flex flex-wrap items-center gap-1 text-10 text-muted-foreground" data-testid="design-inspector-dirty">
          <span>改了 {Object.keys(changes).length} 处，按「应用」才画到画布上。</span>
          {/* 改错了想全部回到原样，原来只能一个字段一个字段自己改回去。 */}
          <button
            type="button"
            onClick={() => { setDraft(toDraft(node)); setError(null); }}
            disabled={busy}
            data-testid="design-inspector-revert"
            className="underline underline-offset-2 transition-colors duration-fast hover:text-background-foreground"
          >
            还原这几处
          </button>
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={() => void apply()} disabled={busy || !dirty || id === undefined} data-testid="design-inspector-apply">
          {busy ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <Check aria-hidden className="h-3 w-3" />} 应用
        </Button>
        {/* 迭代 15：复制 / 上移 / 下移。到头了按钮禁用，而不是发一个什么都不做的请求。 */}
        {id !== undefined && path.length > 1 && onNodeOps !== undefined && (
          <>
            {/* 灰掉的图标按钮最难猜：三个都把「为什么不能按」写进 title 和读屏名字。 */}
            <Button variant="ghost" size="icon" className="h-6 w-6"
              title={duplicateOps(prototype, id) === null ? "这个节点复制不了（它上面没有可以放副本的容器）" : "复制这个节点（⌘D）"}
              aria-label={duplicateOps(prototype, id) === null ? "这个节点复制不了（它上面没有可以放副本的容器）" : "复制这个节点"}
              onClick={() => void onNodeOps(duplicateOps(prototype, id), "复制这个节点")}
              disabled={busy || duplicateOps(prototype, id) === null} data-testid="design-inspector-duplicate">
              <Copy aria-hidden className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6"
              title={moveOps(prototype, id, -1) === null ? "已经是同一层里的第一个了" : "上移一格"}
              aria-label={moveOps(prototype, id, -1) === null ? "已经是同一层里的第一个了" : "上移一格"}
              onClick={() => void onNodeOps(moveOps(prototype, id, -1), "上移这个节点")}
              disabled={busy || moveOps(prototype, id, -1) === null} data-testid="design-inspector-move-up">
              <ArrowUp aria-hidden className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6"
              title={moveOps(prototype, id, 1) === null ? "已经是同一层里的最后一个了" : "下移一格"}
              aria-label={moveOps(prototype, id, 1) === null ? "已经是同一层里的最后一个了" : "下移一格"}
              onClick={() => void onNodeOps(moveOps(prototype, id, 1), "下移这个节点")}
              disabled={busy || moveOps(prototype, id, 1) === null} data-testid="design-inspector-move-down">
              <ArrowDown aria-hidden className="h-3 w-3" />
            </Button>
          </>
        )}
        {path.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy || id === undefined} className="ml-auto text-destructive" title="删错了可以用画布上方的「撤销」退回去" data-testid="design-inspector-remove">
            <Trash2 aria-hidden className="h-3 w-3" /> 删除
          </Button>
        )}
      </div>
    </section>
  );
}
