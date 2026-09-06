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
import { Loader2, Trash2, Check, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { patchPrototype, prototypeNodeLabel, type DesignProject, type PrototypeNode, type PrototypePatchOp } from "@/lib/live-design-workbench";

type Field =
  | { key: string; label: string; kind: "text" }
  | { key: string; label: string; kind: "multiline" }
  | { key: string; label: string; kind: "lines" }
  | { key: string; label: string; kind: "bool" }
  | { key: string; label: string; kind: "number" }
  | { key: string; label: string; kind: "enum"; options: readonly string[] };

const SCALE = ["none", "sm", "md", "lg"] as const;
/** 与契约 `design-prototype.ts` 各 `*Props` 一一对应；加原语时这里也要加一行，否则面板只显示「这种节点没有可改的属性」。 */
const FIELDS: Record<PrototypeNode["type"], readonly Field[]> = {
  stack: [
    { key: "direction", label: "方向", kind: "enum", options: ["column", "row"] },
    { key: "gap", label: "间距", kind: "enum", options: SCALE },
    { key: "padding", label: "内边距", kind: "enum", options: SCALE },
    { key: "align", label: "对齐", kind: "enum", options: ["start", "center", "end", "between"] },
    { key: "fill", label: "填满剩余空间", kind: "bool" },
  ],
  card: [{ key: "title", label: "标题", kind: "text" }],
  navbar: [{ key: "title", label: "标题", kind: "text" }, { key: "left", label: "左侧", kind: "text" }, { key: "right", label: "右侧", kind: "text" }],
  text: [
    { key: "content", label: "文案", kind: "multiline" },
    { key: "variant", label: "样式", kind: "enum", options: ["title", "subtitle", "body", "caption", "label"] },
    { key: "muted", label: "弱化", kind: "bool" },
    { key: "align", label: "对齐", kind: "enum", options: ["start", "center", "end"] },
  ],
  button: [
    { key: "label", label: "文案", kind: "text" },
    { key: "variant", label: "样式", kind: "enum", options: ["primary", "secondary", "ghost", "danger"] },
    { key: "full", label: "通栏", kind: "bool" },
  ],
  input: [
    { key: "label", label: "标签", kind: "text" },
    { key: "placeholder", label: "占位文字", kind: "text" },
    { key: "value", label: "已填内容", kind: "text" },
    { key: "multiline", label: "多行", kind: "bool" },
  ],
  image: [{ key: "alt", label: "说明", kind: "text" }, { key: "ratio", label: "比例", kind: "enum", options: ["square", "video", "wide", "portrait"] }],
  list: [{ key: "items", label: "条目（一行一项）", kind: "lines" }, { key: "leading", label: "前缀", kind: "enum", options: ["none", "dot", "check", "avatar"] }],
  divider: [],
  spacer: [{ key: "size", label: "高度", kind: "enum", options: SCALE }],
  tabs: [{ key: "items", label: "标签（一行一项）", kind: "lines" }, { key: "active", label: "当前项（从 0 起）", kind: "number" }],
  badge: [{ key: "label", label: "文案", kind: "text" }, { key: "tone", label: "色调", kind: "enum", options: ["neutral", "info", "success", "warning", "danger"] }],
  avatar: [{ key: "name", label: "名字", kind: "text" }],
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
    else d[f.key] = typeof v === "string" ? v : "";
  }
  return d;
}

/** 草稿 → 只含改动键的 props；空字符串表示「清掉这个可选键」（契约里可选键不接受空串）。 */
function diff(node: PrototypeNode, draft: Draft): Record<string, unknown> {
  const before = toDraft(node);
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[node.type]) {
    const a = before[f.key];
    const b = draft[f.key];
    if (a === b) continue;
    if (f.kind === "lines") out[f.key] = String(b ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    else if (f.kind === "bool") out[f.key] = b === true;
    else if (f.kind === "number") out[f.key] = b;
    else out[f.key] = b === "" ? undefined : b;
  }
  return out;
}

function reason(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = (err.raw as { detail?: unknown } | null | undefined)?.detail;
    return typeof detail === "string" ? detail : err.reasonCode ?? `http_${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function PrototypeInspector({
  projectId, node, path, onSaved, onDeleted,
}: {
  projectId: string;
  node: PrototypeNode;
  /** 从页根到该节点的路径（含自身），用作面包屑。 */
  path: readonly PrototypeNode[];
  onSaved: (project: DesignProject) => void;
  onDeleted: (project: DesignProject) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(node));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setDraft(toDraft(node)); setError(null); }, [node]);

  const changes = diff(node, draft);
  const dirty = Object.keys(changes).length > 0;
  const fields = FIELDS[node.type];
  const id = node.id;

  const apply = async () => {
    if (id === undefined || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const ops: PrototypePatchOp[] = [{ op: "setProps", id, props: changes }];
      const out = await patchPrototype(projectId, ops, `改了${prototypeNodeLabel(node)}`);
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
      const out = await patchPrototype(projectId, [{ op: "remove", id }], `删掉了${prototypeNodeLabel(node)}`);
      onDeleted(out.project);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(false);
    }
  };

  const fieldId = (k: string) => `proto-field-${k}`;
  const control = "h-8 w-full rounded-control border border-input bg-background px-2 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section className="flex flex-col gap-2 border-b border-border p-3" data-testid="design-inspector">
      <div className="flex items-center gap-1.5 text-12 font-medium">
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" /> {prototypeNodeLabel(node)}
        <span className="ml-auto font-mono text-10 text-muted-foreground">{id}</span>
      </div>
      <p className="truncate text-10 text-muted-foreground" data-testid="design-inspector-path">{path.map(prototypeNodeLabel).join(" › ")}</p>
      {fields.length === 0 && <p className="text-11 text-muted-foreground">这种节点没有可改的属性。</p>}
      {fields.map((f) => (
        <div key={f.key} className={cn("flex gap-1", f.kind === "bool" ? "flex-row items-center justify-between" : "flex-col")}>
          <label htmlFor={fieldId(f.key)} className="text-10 font-medium text-muted-foreground">{f.label}</label>
          {f.kind === "text" && <Input id={fieldId(f.key)} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {(f.kind === "multiline" || f.kind === "lines") && <Textarea id={fieldId(f.key)} rows={f.kind === "lines" ? 4 : 3} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {f.kind === "number" && <Input id={fieldId(f.key)} type="number" min={0} value={draft[f.key] === undefined ? "" : String(draft[f.key])} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })} disabled={busy} data-testid={`design-inspector-${f.key}`} />}
          {f.kind === "bool" && <input id={fieldId(f.key)} type="checkbox" checked={draft[f.key] === true} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} disabled={busy} className="h-3.5 w-3.5 accent-primary" data-testid={`design-inspector-${f.key}`} />}
          {f.kind === "enum" && (
            <select id={fieldId(f.key)} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} disabled={busy} className={control} data-testid={`design-inspector-${f.key}`}>
              <option value="">（默认）</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>
      ))}
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
