"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import type { PrototypeVersionSummary } from "@/lib/live-design-workbench";
import { isAidtModuleEnabled } from "../lib/aidt-module-config";
import { aidtPrototypeVersionLabel, loadAidtPrototypeDesigns, loadAidtPrototypeVersions, resolveAidtPrototypeVersion, type AidtPrototypeDesignList, type AidtPrototypeReadContext, type AidtPrototypeVersionReference } from "../lib/aidt-prototype-versions";

export type AidtPrototypeVersionPickerProps = {
  projectId: string;
  value?: AidtPrototypeVersionReference | null;
  onChange: (reference: AidtPrototypeVersionReference | null) => void;
  readOnly?: boolean;
  label?: string;
  removeLabel?: string;
  description?: string;
  /** Host intent revision: manual text/question edits must invalidate pending reads even when value stays null. */
  selectionScope?: string;
};
type Result<T> = { items: T; failed?: false } | { failed: true; items?: never };

/** Native Design data only; leaves persistence and question-snapshot confirmation to its host. */
export function AidtPrototypeVersionPicker(props: AidtPrototypeVersionPickerProps) {
  const session = useOptionalSession()?.session;
  if (!isAidtModuleEnabled()) return null;
  if (!session?.currentOrgId || !session.userId || !session.sessionToken) return <p role="status" className="text-12 text-muted-foreground">登录并选择组织后，才能读取已关联的原型版本。</p>;
  const scope = JSON.stringify([props.projectId, session.currentOrgId, session.userId, session.sessionToken, !!props.readOnly, props.selectionScope ?? ""]);
  return <EnabledPicker key={scope} {...props} context={{ projectId: props.projectId, userId: session.userId, sessionToken: session.sessionToken }} />;
}

function EnabledPicker({ context, value, onChange, readOnly = false, label, removeLabel = "移除版本引用", description }: AidtPrototypeVersionPickerProps & { context: AidtPrototypeReadContext }) {
  const [open, setOpen] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [designs, setDesigns] = React.useState<Result<AidtPrototypeDesignList> | null>(null);
  const [designId, setDesignId] = React.useState<string | null>(null);
  const [versions, setVersions] = React.useState<{ key: string; result: Result<readonly PrototypeVersionSummary[]> } | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [selectionFailed, setSelectionFailed] = React.useState(false);
  const selection = React.useRef<AbortController | null>(null);
  const valueIdentity = JSON.stringify([value?.designId ?? null, value?.versionId ?? null]);
  const valueLifecycle = React.useRef({ identity: valueIdentity, generation: 0 });
  if (valueLifecycle.current.identity !== valueIdentity) valueLifecycle.current = { identity: valueIdentity, generation: valueLifecycle.current.generation + 1 };
  const valueGeneration = valueLifecycle.current.generation;
  const notify = React.useRef(onChange); notify.current = onChange;
  const versionKey = JSON.stringify([designId, retry]);
  const versionResult = versions?.key === versionKey ? versions.result : null;
  const { projectId, userId, sessionToken } = context;

  React.useEffect(() => {
    if (!open || readOnly) return;
    const controller = new AbortController();
    setDesigns(null);
    void loadAidtPrototypeDesigns({ projectId, userId, sessionToken, signal: controller.signal })
      .then((items) => { if (!controller.signal.aborted) setDesigns({ items }); })
      .catch(() => { if (!controller.signal.aborted) setDesigns({ failed: true }); });
    return () => controller.abort();
  }, [open, retry, readOnly, projectId, userId, sessionToken]);

  React.useEffect(() => {
    if (!open || !designId || readOnly) return;
    const controller = new AbortController();
    void loadAidtPrototypeVersions({ projectId, userId, sessionToken, signal: controller.signal }, designId)
      .then((items) => { if (!controller.signal.aborted) setVersions({ key: versionKey, result: { items } }); })
      .catch(() => { if (!controller.signal.aborted) setVersions({ key: versionKey, result: { failed: true } }); });
    return () => controller.abort();
  }, [open, designId, versionKey, readOnly, projectId, userId, sessionToken]);

  React.useEffect(() => () => { selection.current?.abort(); }, [open, designId, retry]);
  React.useEffect(() => {
    selection.current?.abort(); selection.current = null; setPending(null); setSelectionFailed(false);
  }, [valueIdentity]);

  function cancelSelection() {
    selection.current?.abort(); selection.current = null;
    setPending(null); setSelectionFailed(false);
  }
  function select(versionId: string) {
    if (readOnly || !open || !designId || pending) return;
    const controller = new AbortController(); selection.current = controller;
    setPending(versionId); setSelectionFailed(false);
    void resolveAidtPrototypeVersion({ projectId, userId, sessionToken, signal: controller.signal }, designId, versionId)
      .then((reference) => {
        if (controller.signal.aborted || selection.current !== controller || valueLifecycle.current.generation !== valueGeneration) return;
        notify.current(reference); setOpen(false);
      }).catch(() => { if (!controller.signal.aborted) setSelectionFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setPending(null); });
  }
  function toggle() {
    cancelSelection();
    setDesignId(null); setVersions(null); setOpen((wasOpen) => !wasOpen);
  }
  function refresh() {
    cancelSelection();
    setDesignId(null); setVersions(null); setRetry((count) => count + 1);
  }
  function remove() {
    if (readOnly) return;
    cancelSelection(); notify.current(null);
  }

  return <section className="space-y-2" aria-label={label ? `${label}引用` : "真实原型版本引用"} data-testid="aidt-prototype-version-picker">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={readOnly} aria-expanded={open} onClick={toggle}>{open ? label ? `收起${label}` : "收起原型版本" : label ? `选择${label}` : "选择真实原型版本"}</Button>
      {value && <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={remove}>{removeLabel}</Button>}
    </div>
    {value && <p className="break-words text-12" data-testid="aidt-prototype-recorded-reference">已记录：{aidtPrototypeVersionLabel(value)}<span className="block text-muted-foreground">已生成 {value.generatedFrameCount}/{value.frameCount} 页；Design ID：{value.designId}；版本 ID：{value.versionId}。历史记录不代表当前仍有访问权限。</span></p>}
    {readOnly && <p role="status" className="text-12 text-muted-foreground">当前只读，不能更改原型版本引用。</p>}
    <p className="text-12 text-muted-foreground">{description ?? "只选择本项目已关联、当前由你拥有的 Design 历史版本。选择仅更新本步引用；保存与带入第6步问题卡需分别确认。原有文字版本说明仍保留。"}</p>
    {open && !readOnly && <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-12 text-muted-foreground">版本读取使用真实 Design API；不会在这里生成、恢复或修改原型。模型来源、页面数量与版本摘要都不代表质量或研究证据已验证。</p>
      {!designs ? <p role="status" data-testid="loading" className="text-12">正在读取已关联的设计…</p>
        : designs.failed ? <div role="alert" data-testid="err-prototype-designs" className="space-y-2 text-12"><p>设计列表读取失败，不能据此判断没有关联设计。</p><Button type="button" size="sm" variant="outline" onClick={refresh}>重试设计列表</Button></div>
        : <>
          <Button type="button" size="sm" variant="ghost" onClick={refresh}>刷新关联设计</Button>
          {!!designs.items.unavailableCount && <p role="status" className="text-12 text-muted-foreground">另有 {designs.items.unavailableCount} 个关联设计不在当前 owner 列表中，此处不提供选择。关联本身不授予编辑或访问权限。</p>}
          {!designs.items.items.length ? <p role="status" data-testid="empty" className="text-12 text-muted-foreground">当前没有可选择的已关联 owner 设计。可先在项目资料中关联你拥有的 Design，再刷新。</p>
            : <div className="flex flex-wrap gap-2" aria-label="已关联的设计">{designs.items.items.map((design) => <Button type="button" key={design.id} size="sm" variant={design.id === designId ? "secondary" : "outline"} disabled={!!pending} aria-pressed={design.id === designId} onClick={() => { setSelectionFailed(false); setDesignId(design.id); }}>{design.name}</Button>)}</div>}
        </>}
      {designId && designs && !designs.failed && <div className="space-y-2" aria-label="原型版本列表">
        {!versionResult ? <p role="status" data-testid="loading" className="text-12">正在读取版本历史…</p>
          : versionResult.failed ? <div role="alert" data-testid="err-prototype-versions" className="space-y-2 text-12"><p>版本历史读取失败，未把失败当成没有版本。</p><Button type="button" size="sm" variant="outline" onClick={refresh}>重试版本历史</Button></div>
          : !versionResult.items.length ? <p role="status" data-testid="empty" className="text-12 text-muted-foreground">这个设计还没有已保存的原型版本。请在原生 Design Workbench 中完成原型修改，再刷新。</p>
          : versionResult.items.map((version) => <Button type="button" key={version.id} variant="outline" className="h-auto w-full justify-start whitespace-normal py-3 text-left" disabled={!!pending} onClick={() => select(version.id)}>
            <span className="min-w-0 space-y-1"><span className="block text-13">{pending === version.id ? "正在核对实际快照…" : `选择 v${version.seq}`}：{version.summary || "无版本摘要"}</span><span className="block break-words text-12 text-muted-foreground">计划 {version.frames.length} 页，实际内容待核对；{version.createdAt}；来源：{version.source}；版本 ID：{version.id}</span></span>
          </Button>)}
      </div>}
      {selectionFailed && <p role="alert" data-testid="err-prototype-selection" className="text-12 text-destructive">无法确认这个版本：可能已不可访问、已解除关联，或还没有生成页面。原引用仍保留；可重试选择或刷新列表。</p>}
    </div>}
  </section>;
}
