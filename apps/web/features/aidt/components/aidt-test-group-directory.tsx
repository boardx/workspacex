"use client";

import { Pencil, Trash2 } from "lucide-react";

import { useAidtCreateTags } from "./aidt-card-create-fields";
import * as React from "react";
import { AidtCardFilters, AidtCardHeader, AidtCardStatus, AidtEntityCard, AidtNewEntityCardButton } from "./aidt-entity-card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOptionalSession } from "@/components/session/session-provider";
import { createAidtTestGroup, isAidtTestGroupConfirmed, readAidtTestGroups, updateAidtTestGroup, type AidtTestGroup } from "../lib/aidt-test-groups";
import { AidtTestPrototypeSource, readAidtTestPrototypeStage, type AidtReadPrototypeEntity } from "./aidt-test-prototype-source";
import { resolveAidtPrototypeVersion } from "../lib/aidt-prototype-versions";
import { aidtHref } from "../lib/project-aidt";
import { isAidtPrototypeHandoffConfirmed } from "../lib/aidt-prototype-handoff";
import { createAidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import { AIDT_TEST_RESEARCH_LABELS, AidtTestResearchPath, aidtTestResearchPath } from "../lib/aidt-test-research";
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
  const tags = useAidtCreateTags(draft);
  const [name, setName] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string }>();
  const [removing, setRemoving] = React.useState<string>();
  const [chosenEntity, setChosenEntity] = React.useState("");
  const [researchPath, setResearchPath] = React.useState<"" | "offline" | "survey" | "virtual">("");
  const [sourceChecked, setSourceChecked] = React.useState(false);
  const [preview, setPreview] = React.useState<{ source: string; group: AidtTestGroup }>();
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
  const sourceKey = JSON.stringify([id, exactRevision]);
  const candidates = prototypeEntities.filter(item => !item.archived);
  const limit = Object.keys(draft.fields).length >= (draft.fields.questionSnapshot || draft.fields.version?.trim() ? 100 : 98);
  const canCreate = Boolean(!readOnly && !checking && !limit && name.trim() && researchPath && sourceChecked && exactRevision && exactRevision > 0 && exactRevision < 2147483647 &&
    (!id || readPrototypeEntity) && (!candidates.length || id));

  async function previewSource() {
    if (checking || request.current || !exactRevision || candidates.length && !id) return;
    const controller = new AbortController(); request.current = controller;
    setChecking(true); setError("");
    try {
      const stage = exactRevision === previousPrototypeRevision ? previousPrototype : await readAidtTestPrototypeStage(projectId, exactRevision, sessionToken, controller.signal);
      const source = stage && (id ? readPrototypeEntity?.(stage, id) : stage);
      const bound = source && (!id || isAidtPrototypeHandoffConfirmed(source)) && createAidtQuestionSnapshot(source, exactRevision);
      const group = bound && bound.ok && createAidtTestGroup(bound.snapshot, crypto.randomUUID(), id);
      if (!group) throw new Error("SOURCE_REQUIRED");
      if (!controller.signal.aborted) setPreview({ source: sourceKey, group });
    } catch { if (!controller.signal.aborted) setError("无法核对所选正式原型版本。原选择保留，请检查来源后重试。"); }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setChecking(false); }
  }

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
      if (!source || (id && !isAidtPrototypeHandoffConfirmed(source))) throw new Error("source");
      const binding = createAidtQuestionSnapshot(source, exactRevision);
      const group = binding.ok ? createAidtTestGroup(binding.snapshot, creationId.current ??= crypto.randomUUID(), id) : null;
      if (!group || !binding.ok) throw new Error("binding");
      await resolveAidtPrototypeVersion({ projectId, sessionToken, userId, signal: controller.signal }, group.designId, group.versionId, "linked-reader");
      if (controller.signal.aborted) return;
      const change = (current: AidtUiStageDraft) => {
        const created = updateAidtTestGroup(current, { ...group, name: name.trim(), method: researchPath === "survey" ? "survey" : "interview", researchPath: researchPath || undefined,
          ...(researchPath === "virtual" ? { evidenceGap: "仅有虚拟用户模拟反馈，尚未开展真实用户验证。" } : {}) });
        if (created === current) return current;
        const next = tags.apply(created, group.id);
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
      if (!existing) return current;
      const next = updateAidtTestGroup(current, { ...existing, ...patch });
      return "name" in patch ? tags.apply(next, id) : next;
    });
  }
  const removalName = available.find(group => group.id === removing)?.name;
  const creationFields = <>
      {!!candidates.length && !prototypeEntity && <label className="block text-12">所用原型
        <select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={chosenEntity} onChange={event => { setChosenEntity(event.currentTarget.value); setSourceChecked(false); }}><option value="">请选择已确认的原型记录</option>{candidates.map(entity => {
          const source = previousPrototype && readPrototypeEntity?.(previousPrototype, entity.id);
          const result = source && createAidtQuestionSnapshot(source, exactRevision);
          return <option key={entity.id} value={entity.id}>{entity.title}{result && result.ok ? ` · 版本 ${result.snapshot.prototypeVersionId}` : ""}</option>;
        })}</select>
      </label>}
      <Button type="button" size="sm" variant="outline" disabled={checking || !exactRevision || Boolean(candidates.length && !id)} onClick={() => void previewSource()}>{checking ? "核对原型版本…" : "预览所选原型版本"}</Button>
      {preview?.source === sourceKey && <AidtTestPrototypeSource key={sourceKey} group={preview.group} context={{ projectId, sessionToken, userId }} readPrototypeEntity={readPrototypeEntity} showQuestion initiallyOpen />}
      <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={sourceChecked} onChange={event => setSourceChecked(event.currentTarget.checked)} />确认使用所选原型的已保存版本开展本轮研究</label>
      <label className="block space-y-1 text-12">研究路径<select className="w-full rounded-control border border-border bg-background p-2" value={researchPath} onChange={event => {
        const next = AidtTestResearchPath.safeParse(event.currentTarget.value); setResearchPath(next.success ? next.data : "");
      }}><option value="">请选择研究路径</option>{Object.entries(AIDT_TEST_RESEARCH_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="block space-y-1 text-12">测试名称<Input value={name} maxLength={80} onChange={event => setName(event.currentTarget.value)} /></label>
      {error && <p role="alert" className="text-12">{error}</p>}
  </>;

  return <section className="space-y-4" aria-label="本组测试" data-testid="aidt-test-group-directory">
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">测试列表</h2>
      {automaticSave && !readOnly && <AidtNewEntityCardButton disabled={checking || limit} onClick={() => { setName(""); setError(""); setChosenEntity(""); setResearchPath(""); setSourceChecked(false); tags.reset(); creationId.current = null; setCreateOpen(true); }} />}
    </header>
    <AidtCardFilters />
    {!available.length && <p className="text-13 text-muted-foreground">选一个已确认的原型，创建测试。</p>}
    <ul aria-label="测试卡片" className="grid gap-4 sm:grid-cols-2">
      {available.map(group => {
        const saved = savedById.get(group.id);
        const confirmed = Boolean(saved && !saved.archived && isAidtTestGroupConfirmed(saved));
        return <AidtEntityCard key={group.id} entityId={group.id}
          action={savedIds.has(group.id) ? <Button size="sm" variant="primary" asChild><Link href={openHref(group.id)} aria-label={`打开测试 ${group.name || "测试组"}`}>打开测试</Link></Button> : <Button type="button" size="sm" disabled>保存后打开对话</Button>}
          management={!readOnly && <>
            <Button type="button" size="sm" variant="outline" onClick={() => { tags.reset(group.id); setEditing({ id: group.id, name: group.name }); }}><Pencil aria-hidden className="size-4" />改名与标签</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setRemoving(group.id)} aria-label="删除卡片"><Trash2 aria-hidden className="size-4" /></Button>
          </>}>
          <AidtCardHeader label="测试"><AidtCardStatus confirmed={confirmed}>{confirmed ? "已确认" : "待确认"}</AidtCardStatus></AidtCardHeader>
          <h2 className="break-words text-16 font-semibold">{group.name || "测试组"}</h2>
          <p className="text-12 text-muted-foreground">{AIDT_TEST_RESEARCH_LABELS[aidtTestResearchPath(group)]} · 第 5 步 V{group.stage5Revision} · 原型版本 {group.versionId}</p>
        </AidtEntityCard>;
      })}
    </ul>
    {editing && !readOnly && <Dialog open onOpenChange={open => { if (!open) setEditing(undefined); }}><DialogContent>
      <DialogTitle>编辑测试卡</DialogTitle><DialogDescription>更改显示名称。</DialogDescription>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (editing.name.trim()) { changeCard(editing.id, { name: editing.name.trim() }); setEditing(undefined); } }}>
        <label className="block space-y-1 text-13">测试名称<Input value={editing.name} maxLength={80} onChange={event => setEditing({ ...editing, name: event.currentTarget.value })} /></label>
        {tags.field}
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
    {!readOnly && <div className={automaticSave ? undefined : "space-y-3 border-t border-border pt-3"}>
      {automaticSave ? <>
        <Dialog open={createOpen} onOpenChange={open => { if (!checking) setCreateOpen(open); }}>
          <DialogContent className="max-w-3xl">
            <DialogTitle>新建测试卡片</DialogTitle>
            <DialogDescription>选择本轮测试使用的原型。</DialogDescription>
            <form className="min-h-0 space-y-3 overflow-y-auto" onSubmit={event => { event.preventDefault(); void create(); }}>
              {creationFields}
              {tags.field}
              {(prototypeEntity || !candidates.length) && <p className="text-13">来源原型 · {candidates.find(item => item.id === id)?.title || "本轮原型"} · 第 5 步 V{exactRevision}</p>}
              {error && <p role="alert">{error}</p>}
              <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={checking} onClick={() => setCreateOpen(false)}>取消</Button><Button type="submit" disabled={!canCreate}>{checking ? "核对版本…" : "创建测试卡片"}</Button></div>
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
