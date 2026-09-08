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
import { Loader2, Trash2, Check, SlidersHorizontal, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { patchPrototype, prototypeNodeLabel, linkSlotsOf, type DesignProject, type PrototypeLink, type PrototypeNode, type PrototypePatchOp } from "@/lib/live-design-workbench";

import { designPrototype } from "@repo/contracts";

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

function toDraft(node: PrototypeNode): Draft {
  const p = propsOf(node);
  const d: Draft = {};
  for (const f of FIELDS[node.type]) {
    const v = p[f.key];
    if (f.kind === "lines") d[f.key] = Array.isArray(v) ? (v as string[]).join("\n") : "";
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
    const a = before[f.key];
    const b = draft[f.key];
    if (a === b) continue;
    if (f.kind === "lines") out[f.key] = String(b ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    else if (f.kind === "bool") out[f.key] = b === true;
    else if (f.kind === "number") out[f.key] = b === undefined ? null : b;
    else out[f.key] = b === "" ? null : b;
  }
  return out;
}

function reason(err: unknown): string {
  if (err instanceof ApiError) {
    const raw = err.raw as { patchReason?: unknown } | null | undefined;
    const parsed = designPrototype.PrototypePatchRejectReason.safeParse(raw?.patchReason);
    if (parsed.success) return REJECT_TEXT[parsed.data];
    return err.reasonCode ?? `http_${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** 契约 `patchPrototype.in.summary` ≤ 200：标签本身最长 200，拼上前缀必须截。 */
const summaryOf = (prefix: string, node: PrototypeNode): string => `${prefix}${prototypeNodeLabel(node)}`.slice(0, 200);

export function PrototypeInspector({
  projectId, node, path, onSaved, onDeleted, frames = [], frameIndex = 0, links = [], onSetLinks,
}: {
  projectId: string;
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
  React.useEffect(() => { setDraft(toDraft(node)); setError(null); }, [node]);

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
          {f.kind === "text" && <Input id={fieldId(f.key)} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {(f.kind === "multiline" || f.kind === "lines") && <Textarea id={fieldId(f.key)} rows={f.kind === "lines" ? 4 : 3} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {f.kind === "number" && <Input id={fieldId(f.key)} type="number" min={0} value={draft[f.key] === undefined ? "" : String(draft[f.key])} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
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
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>
  );

  return (
    <section className="flex flex-col gap-2 border-b border-border p-3" data-testid="design-inspector">
      <div className="flex items-center gap-1.5 text-12 font-medium">
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" /> {prototypeNodeLabel(node)}
        <span className="ml-auto font-mono text-10 text-muted-foreground">{id}</span>
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
            className="flex items-center gap-1 text-10 font-medium uppercase tracking-wide text-muted-foreground transition-colors duration-fast hover:text-background-foreground"
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
          <p className="text-10 font-medium uppercase tracking-wide text-muted-foreground">跳转</p>
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
      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={() => void apply()} disabled={busy || !dirty || id === undefined} data-testid="design-inspector-apply">
          {busy ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <Check aria-hidden className="h-3 w-3" />} 应用
        </Button>
        {path.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy || id === undefined} className="ml-auto text-destructive" data-testid="design-inspector-remove">
            <Trash2 aria-hidden className="h-3 w-3" /> 删除
          </Button>
        )}
      </div>
    </section>
  );
}
