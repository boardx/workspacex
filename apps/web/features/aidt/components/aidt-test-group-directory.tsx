"use client";

import * as React from "react";
import { AidtEntityCard, AidtNewEntityCardButton } from "./aidt-entity-card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOptionalSession } from "@/components/session/session-provider";
import { createAidtTestGroup, isAidtTestGroupConfirmed, readAidtTestGroups, updateAidtTestGroup } from "../lib/aidt-test-groups";
import { readAidtTestPrototypeStage, type AidtReadPrototypeEntity } from "./aidt-test-prototype-source";
import { resolveAidtPrototypeVersion } from "../lib/aidt-prototype-versions";
import { aidtHref } from "../lib/project-aidt";
import { createAidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";


type Props = {
  projectId: string;
  draft: AidtUiStageDraft;
  savedDraft?: AidtUiStageDraft;
  previousPrototype?: AidtUiStageDraft;
  previousPrototypeRevision?: number;
  prototypeRevision?: string | null;
  prototypeEntity?: string | null;
  prototypeEntities?: readonly { id: string; title: string; archived?: boolean }[];
  readPrototypeEntity?: AidtReadPrototypeEntity;
  readOnly: boolean;
  onCreate?: (id: string, change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
  canSave: boolean;
  automaticSave?: boolean;
  save: () => Promise<void>;
  update: (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
};

export function AidtTestGroupDirectory(props: Props) {
  const session = useOptionalSession()?.session;
  if (!session?.sessionToken || !session.userId || !session.currentOrgId) return <p role="status">登录后查看本组测试。</p>;
  const key = JSON.stringify([props.projectId, session.currentOrgId, session.userId, session.sessionToken, props.readOnly, props.prototypeRevision, props.prototypeEntity]);
  return <TestGroupDirectory key={key} {...props} sessionToken={session.sessionToken} userId={session.userId} />;
}

function TestGroupDirectory({ projectId, draft, savedDraft, previousPrototype, previousPrototypeRevision, prototypeRevision, prototypeEntity, prototypeEntities = [], readPrototypeEntity, readOnly, canSave, save, automaticSave, update, onCreate, sessionToken, userId }: Props & { sessionToken: string; userId: string }) {
  const [name, setName] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string }>();
  const [removing, setRemoving] = React.useState<string>();
  const [chosenEntity, setChosenEntity] = React.useState("");
  const [requestId, setRequestId] = React.useState<string>();
  const [error, setError] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const creationId = React.useRef<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);

  const groups = readAidtTestGroups(draft.fields);
  const savedGroups = readAidtTestGroups(savedDraft?.fields ?? {});
  const savedIds = new Set(savedGroups.filter(item => !item.archived).map(item => item.id));
  const savedById = new Map(savedGroups.map(group => [group.id, group]));
  const available = groups.filter(group => !group.archived);
  const archived = groups.filter(group => group.archived);
  const exactRevision = prototypeRevision == null ? previousPrototypeRevision : /^\d{1,10}$/.test(prototypeRevision) ? Number(prototypeRevision) : undefined;
  const id = prototypeEntity ?? (chosenEntity || undefined);
  const candidates = prototypeEntities.filter(item => !item.archived);
  const limit = Object.keys(draft.fields).length >= (draft.fields.questionSnapshot || draft.fields.version?.trim() ? 100 : 98);
  const canCreate = Boolean(!readOnly && !checking && !limit && name.trim() && exactRevision && exactRevision > 0 && exactRevision < 2147483647 &&
    (!id || readPrototypeEntity) && (!candidates.length || id));

  async function create() {
    if (!canCreate || !exactRevision || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setError("");
    try {
      let stage5 = exactRevision === previousPrototypeRevision ? previousPrototype : undefined;
      if (!stage5) {
        stage5 = await readAidtTestPrototypeStage(projectId, exactRevision, sessionToken, controller.signal);
      }
      const source = stage5 && (id ? readPrototypeEntity?.(stage5, id) : stage5);
      if (!source) throw new Error("source");
      const binding = createAidtQuestionSnapshot(source, exactRevision);
      const group = binding.ok ? createAidtTestGroup(binding.snapshot, creationId.current ??= crypto.randomUUID(), id) : null;
      if (!group || !binding.ok) throw new Error("binding");
      await resolveAidtPrototypeVersion({ projectId, sessionToken, userId, signal: controller.signal }, group.designId, group.versionId);
      if (controller.signal.aborted) return;
      const change = (current: AidtUiStageDraft) => {
        const next = updateAidtTestGroup(current, { ...group, name: name.trim() });
        if (next === current || current.fields.questionSnapshot || current.fields.version?.trim()) return next;
        return { ...next, fields: { ...next.fields, version: binding.snapshot.prototypeRef, questionSnapshot: binding.serialized } };
      };
      if (onCreate) {
        if (!await onCreate(group.id, change)) { setError("测试未能保存。请重试创建。"); return; }
      } else { update(change); setRequestId(group.id); }
      creationId.current = null;
      setName("");
      setCreateOpen(false);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const detail = failure instanceof Error ? failure.message : "";
      setError(detail === "source" || detail === "binding"
        ? "此版本没有同时确认的问题卡与实际 Design 原型。请回第 5 步核对后重试。"
        : "无法核对原型或它的历史版本。请检查访问权限与项目关联后重试。");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  function openHref(entity: string) {
    return `${aidtHref(projectId, 6)}&entity=${encodeURIComponent(entity)}`;
  }
  function changeCard(id: string, patch: { name: string } | { archived: boolean }) {
    if (readOnly) return;
    update(current => {
      const existing = readAidtTestGroups(current.fields).find(item => item.id === id);
      return existing ? updateAidtTestGroup(current, { ...existing, ...patch }) : current;
    });
  }
  const removalName = available.find(group => group.id === removing)?.name;
  const creationFields = <>
      {!!candidates.length && !prototypeEntity && <label className="block text-12">所用原型
        <select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={chosenEntity} onChange={event => setChosenEntity(event.currentTarget.value)}><option value="">请选择</option>{candidates.map(entity => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select>
      </label>}
      <label className="block space-y-1 text-12">测试名称<Input value={name} maxLength={80} onChange={event => setName(event.currentTarget.value)} /></label>
      {error && <p role="alert" className="text-12">{error}</p>}
  </>;

  return <section className="space-y-4" aria-label="本组测试" data-testid="aidt-test-group-directory">
    {!available.length && <p className="text-13 text-muted-foreground">选一个已确认的原型，创建测试。</p>}
    <ul aria-label="测试卡片" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {available.map(group => {
        const saved = savedById.get(group.id);
        const confirmed = Boolean(saved && !saved.archived && isAidtTestGroupConfirmed(saved));
        return <AidtEntityCard key={group.id} entityId={group.id} className="gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="break-words text-16 font-semibold">{group.name || "测试组"}</h2>
            <span className={confirmed ? "shrink-0 rounded-full bg-primary/10 px-2 py-1 text-11 text-primary" : "shrink-0 rounded-full bg-muted px-2 py-1 text-11 text-muted-foreground"}>{confirmed ? "已确认" : "待确认"}</span>
          </div>
          <p className="text-12 text-muted-foreground">{group.method === "survey" ? "问卷" : "访谈"} · 原型 V{group.stage5Revision}</p>
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {savedIds.has(group.id)
              ? <Button size="sm" variant="secondary" asChild><Link href={openHref(group.id)} aria-label={`打开测试 ${group.name || "测试组"}`}>打开测试</Link></Button>
              : <span className="text-12 text-muted-foreground">保存后打开对话</span>}
            {!readOnly && <>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing({ id: group.id, name: group.name })}>编辑</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(group.id)}>删除</Button>
            </>}
          </div>
        </AidtEntityCard>;
      })}
    </ul>
    {editing && !readOnly && <Dialog open onOpenChange={open => { if (!open) setEditing(undefined); }}><DialogContent>
      <DialogTitle>编辑测试卡</DialogTitle><DialogDescription>更改显示名称。</DialogDescription>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (editing.name.trim()) { changeCard(editing.id, { name: editing.name.trim() }); setEditing(undefined); } }}>
        <label className="block space-y-1 text-13">测试名称<Input value={editing.name} maxLength={80} onChange={event => setEditing({ ...editing, name: event.currentTarget.value })} /></label>
        <Button type="submit" variant="primary" disabled={!editing.name.trim()}>保存修改</Button>
      </form>
    </DialogContent></Dialog>}
    {removing && !readOnly && <Dialog open onOpenChange={open => { if (!open) setRemoving(undefined); }}><DialogContent>
      <DialogTitle>删除测试卡？</DialogTitle><DialogDescription>{removalName || "测试组"}将移至已移除，历史引用保留。</DialogDescription>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setRemoving(undefined)}>取消</Button>
        <Button type="button" variant="destructive" onClick={() => { changeCard(removing, { archived: true }); setRemoving(undefined); }}>确认删除</Button>
      </div>
    </DialogContent></Dialog>}
    {archived.length > 0 && <details className="text-12"><summary>已移除（{archived.length}）</summary>
      <ul className="mt-2 space-y-2">{archived.map(group => <li key={group.id}>{group.name || "测试组"}{!readOnly && <Button type="button" size="xs" variant="ghost" onClick={() => changeCard(group.id, { archived: false })}>恢复</Button>}</li>)}</ul>
    </details>}
    {!readOnly && <div className="space-y-3 border-t border-border pt-3">
      {automaticSave ? <>
        <AidtNewEntityCardButton disabled={checking || limit} onClick={() => setCreateOpen(true)} />
        <Dialog open={createOpen} onOpenChange={open => { if (!checking) setCreateOpen(open); }}>
          <DialogContent>
            <DialogTitle>新建测试卡片</DialogTitle>
            <DialogDescription>选择本轮测试使用的原型。</DialogDescription>
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); void create(); }}>
              {creationFields}
              <Button type="submit" disabled={!canCreate}>{checking ? "核对版本…" : "创建测试卡片"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </> : <>{creationFields}<div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!canCreate} onClick={() => void create()}>{checking ? "核对版本…" : "新建测试草稿"}</Button>
        <Button type="button" size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>保存测试列表</Button>
      </div></>}
      {requestId && savedIds.has(requestId) && <Link href={openHref(requestId)} className="text-12 text-primary underline">打开刚保存的测试</Link>}
      {limit && <p role="status" className="text-12">测试记录已达上限。</p>}
    </div>}
  </section>;
}
